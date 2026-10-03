import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FinanceDb, type EquityLotRow, type MfFolioRow } from '../../src/db/schema';
import { getSetting, pricesFor, setSetting } from '../../src/db/repos';
import { refreshPrices, resolveAmfiCode, usdInrOn } from '../../src/services/prices';

let db: FinanceDb;

beforeEach(async () => {
  db = new FinanceDb(`test-prices-${crypto.randomUUID()}`);
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

type Handler = (url: string) => Response | Promise<Response>;

interface FakeFetch {
  fetch: typeof fetch;
  calls: string[];
}

/** A fake `fetch` keyed by URL that records every call, in order. */
function makeFetch(handler: Handler): FakeFetch {
  const calls: string[] = [];
  const impl = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    calls.push(url);
    return handler(url);
  };
  return { fetch: impl as unknown as typeof fetch, calls };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function folio(overrides: Partial<MfFolioRow> & { id: string }): MfFolioRow {
  return {
    folio: 'FOLIO-1',
    amc: 'Test AMC',
    scheme: 'Test Flexi Cap Fund - Direct Plan - Growth',
    isin: 'INF000000001',
    amfiCode: 123456,
    holdingMode: 'soa',
    units: 100_000,
    asOf: '2026-09-30',
    historyComplete: true,
    ...overrides,
  };
}

function lot(id: string, acquiredDate: string, usdInrOnAcquire: number | null): EquityLotRow {
  return {
    id,
    vestId: null,
    esppPurchaseId: null,
    key: `ESPP#${acquiredDate}`,
    acquiredDate,
    netShares: 10,
    remainingShares: 10,
    costPerShareUsdCents: 20_000,
    remainingCostUsdCents: 200_000,
    usdInrOnAcquire,
    source: 'ESPP',
  };
}

/** The three happy-path responses: Finnhub, Frankfurter and one MF NAV. */
function happyHandler(): Handler {
  return (url) => {
    if (url.startsWith('https://finnhub.io/api/v1/quote')) {
      return json({ c: 200, t: Math.floor(Date.UTC(2026, 8, 30, 12) / 1000) });
    }
    if (url.startsWith('https://api.frankfurter.dev/v1/latest')) {
      return json({ date: '2026-10-02', rates: { INR: 85.1234 } });
    }
    if (url === 'https://api.mfapi.in/mf/123456/latest') {
      return json({ data: [{ date: '02-10-2026', nav: '25.0000' }] });
    }
    return new Response('not found', { status: 404 });
  };
}

describe('refreshPrices', () => {
  it('stores ACME, USDINR and each folio NAV on a successful refresh', async () => {
    await setSetting(db, 'finnhubKey', 'test-key');
    await db.mfFolios.add(folio({ id: 'folio-1' }));
    const { fetch, calls } = makeFetch(happyHandler());
    const now = new Date('2026-10-03T06:00:00.000Z');

    const result = await refreshPrices(db, { fetch, now });

    expect(result.failed).toEqual([]);
    expect([...result.updated].sort()).toEqual(['ACME', 'MF:123456', 'USDINR']);
    expect(calls).toHaveLength(3);

    expect(await pricesFor(db, 'ACME')).toEqual([
      { symbol: 'ACME', date: '2026-09-30', value: 20_000, source: 'api' },
    ]);
    expect(await pricesFor(db, 'USDINR')).toEqual([
      { symbol: 'USDINR', date: '2026-10-02', value: 851_234, source: 'api' },
    ]);
    expect(await pricesFor(db, 'MF:123456')).toEqual([
      { symbol: 'MF:123456', date: '2026-10-02', value: 250_000, source: 'api' },
    ]);
    expect(await getSetting(db, 'lastPriceRefresh', null)).toBe(now.toISOString());
    expect(await getSetting(db, 'priceFailures', null)).toEqual([]);
  });

  it('falls back to er-api when Frankfurter fails', async () => {
    const updatedAt = Math.floor(Date.UTC(2026, 9, 2, 12) / 1000);
    const { fetch, calls } = makeFetch((url) => {
      if (url.startsWith('https://finnhub.io/api/v1/quote')) {
        return json({ c: 200, t: updatedAt });
      }
      if (url.startsWith('https://api.frankfurter.dev/v1/latest')) {
        return new Response('upstream error', { status: 500 });
      }
      if (url === 'https://open.er-api.com/v6/latest/USD') {
        return json({
          result: 'success',
          rates: { INR: 85.4 },
          time_last_update_unix: updatedAt,
        });
      }
      return new Response('not found', { status: 404 });
    });
    await setSetting(db, 'finnhubKey', 'test-key');

    const result = await refreshPrices(db, { fetch, now: new Date('2026-10-03T06:00:00.000Z') });

    expect(result.updated).toContain('USDINR');
    expect(result.failed).toEqual([]);
    expect(calls).toContain('https://open.er-api.com/v6/latest/USD');
    expect(await pricesFor(db, 'USDINR')).toEqual([
      { symbol: 'USDINR', date: '2026-10-02', value: 854_000, source: 'api' },
    ]);
  });

  it('reports ACME as failed without a Finnhub key but still refreshes the others', async () => {
    await db.mfFolios.add(folio({ id: 'folio-1' }));
    const { fetch } = makeFetch(happyHandler());

    const result = await refreshPrices(db, { fetch, now: new Date('2026-10-03T06:00:00.000Z') });

    expect(result.failed).toEqual([{ symbol: 'ACME', reason: 'no-key' }]);
    expect([...result.updated].sort()).toEqual(['MF:123456', 'USDINR']);
    expect(await getSetting(db, 'priceFailures', null)).toEqual(['ACME']);
  });

  it('skips the network inside the 20 h window, unless forced', async () => {
    const now = new Date('2026-10-03T06:00:00.000Z');
    await setSetting(
      db,
      'lastPriceRefresh',
      new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString(),
    );
    const { fetch, calls } = makeFetch(happyHandler());

    const skipped = await refreshPrices(db, { fetch, now });
    expect(skipped).toEqual({ updated: [], failed: [] });
    expect(calls).toHaveLength(0);

    await setSetting(db, 'finnhubKey', 'test-key');
    const forced = await refreshPrices(db, { fetch, now, force: true });
    expect(calls.length).toBeGreaterThan(0);
    expect(forced.updated).toContain('USDINR');
  });

  it('resolves and persists an AMFI code for a folio that has none', async () => {
    await setSetting(db, 'finnhubKey', 'test-key');
    await db.mfFolios.add(folio({ id: 'folio-1', amfiCode: null, isin: 'INF000000022' }));
    const { fetch } = makeFetch((url) => {
      if (url.startsWith('https://finnhub.io/api/v1/quote')) {
        return json({ c: 200, t: Math.floor(Date.UTC(2026, 8, 30, 12) / 1000) });
      }
      if (url.startsWith('https://api.frankfurter.dev/v1/latest')) {
        return json({ date: '2026-10-02', rates: { INR: 85.1234 } });
      }
      if (url.startsWith('https://api.mfapi.in/mf/search?q=')) {
        return json([
          { schemeCode: 111, schemeName: 'Test Flexi Cap Fund' },
          { schemeCode: 222, schemeName: 'Test Flexi Cap Fund' },
        ]);
      }
      if (url === 'https://api.mfapi.in/mf/111') {
        return json({ meta: { isin_growth: 'INF000000011' } });
      }
      if (url === 'https://api.mfapi.in/mf/222') {
        return json({ meta: { isin_growth: 'INF000000022' } });
      }
      if (url === 'https://api.mfapi.in/mf/222/latest') {
        return json({ data: [{ date: '02-10-2026', nav: '25.0000' }] });
      }
      return new Response('not found', { status: 404 });
    });

    const result = await refreshPrices(db, { fetch, now: new Date('2026-10-03T06:00:00.000Z') });

    expect(result.updated).toContain('MF:222');
    expect(await db.mfFolios.get('folio-1')).toMatchObject({ amfiCode: 222 });
    expect(await pricesFor(db, 'MF:222')).toEqual([
      { symbol: 'MF:222', date: '2026-10-02', value: 250_000, source: 'api' },
    ]);
  });
});

describe('resolveAmfiCode', () => {
  it('picks the matching candidate among three search results', async () => {
    const { fetch, calls } = makeFetch((url) => {
      if (url.startsWith('https://api.mfapi.in/mf/search?q=')) {
        return json([
          { schemeCode: 111, schemeName: 'Test Flexi Cap Fund' },
          { schemeCode: 222, schemeName: 'Test Flexi Cap Fund' },
          { schemeCode: 333, schemeName: 'Test Flexi Cap Fund' },
        ]);
      }
      if (url === 'https://api.mfapi.in/mf/111') {
        return json({ meta: { isin_growth: 'INF000000011', isin_div_reinvestment: null } });
      }
      if (url === 'https://api.mfapi.in/mf/222') {
        return json({ meta: { isin_growth: null, isin_div_reinvestment: 'INF000000022' } });
      }
      if (url === 'https://api.mfapi.in/mf/333') {
        return json({ meta: { isin_growth: null, isin_div_reinvestment: 'INF000000033' } });
      }
      return new Response('not found', { status: 404 });
    });

    const resolved = await resolveAmfiCode(fetch, 'Test Flexi Cap Fund', 'INF000000022');

    expect(resolved).toBe(222);
    expect(calls[0]).toBe('https://api.mfapi.in/mf/search?q=Test%20Flexi%20Cap%20Fund');
    expect(calls).toContain('https://api.mfapi.in/mf/333');
  });
});

describe('resolveAmfiCode without an ISIN match', () => {
  const searchOf = (codes: number[]) => (url: string) =>
    url.startsWith('https://api.mfapi.in/mf/search?q=')
      ? json(codes.map((schemeCode) => ({ schemeCode, schemeName: 'Fund' })))
      : null;

  it('does not guess a lone candidate that publishes a different ISIN', async () => {
    const { fetch } = makeFetch((url) => {
      const search = searchOf([111])(url);
      if (search) return search;
      if (url === 'https://api.mfapi.in/mf/111') return json({ meta: { isin_growth: 'INF000000011' } });
      return new Response('not found', { status: 404 });
    });
    expect(await resolveAmfiCode(fetch, 'Fund', 'INF000000099')).toBeNull();
  });

  it('accepts a lone candidate that publishes no ISIN to contradict it', async () => {
    const { fetch } = makeFetch((url) => {
      const search = searchOf([111])(url);
      if (search) return search;
      if (url === 'https://api.mfapi.in/mf/111') return json({ meta: {} });
      return new Response('not found', { status: 404 });
    });
    expect(await resolveAmfiCode(fetch, 'Fund', 'INF000000099')).toBe(111);
  });

  it('reports several unverifiable candidates as ambiguous', async () => {
    const { fetch } = makeFetch((url) => {
      const search = searchOf([111, 222])(url);
      if (search) return search;
      return json({ meta: {} });
    });
    expect(await resolveAmfiCode(fetch, 'Fund', 'INF000000099')).toBe('ambiguous');
  });
});

describe('refresh window', () => {
  it('does not start the 20 h window when nothing could be stored', async () => {
    const { fetch } = makeFetch(() => new Response('down', { status: 503 }));
    const now = new Date('2026-10-03T06:00:00.000Z');

    const offline = await refreshPrices(db, { fetch, now });

    expect(offline.updated).toEqual([]);
    expect(await getSetting(db, 'lastPriceRefresh', null)).toBeNull();
    // An immediate retry therefore goes to the network again.
    const retry = makeFetch(happyHandler());
    await setSetting(db, 'finnhubKey', 'test-key');
    const result = await refreshPrices(db, { fetch: retry.fetch, now });
    expect(result.updated).toContain('USDINR');
  });
});

describe('usdInrOn', () => {
  it('uses stored rates, fetches missing dates and backfills lots', async () => {
    await db.prices.put({ symbol: 'USDINR', date: '2026-10-01', value: 850_000, source: 'api' });
    await db.equityLots.bulkAdd([
      lot('lot-1', '2026-10-01', null),
      lot('lot-2', '2026-10-02', null),
      lot('lot-3', '2026-10-01', 840_000),
    ]);
    const { fetch, calls } = makeFetch((url) => {
      if (url === 'https://api.frankfurter.dev/v1/2026-10-02?base=USD&symbols=INR') {
        return json({ date: '2026-10-02', rates: { INR: 85.5 } });
      }
      return new Response('not found', { status: 404 });
    });

    expect(await usdInrOn(db, fetch, '2026-10-01')).toBe(850_000);
    expect(calls).toHaveLength(0);
    expect((await db.equityLots.get('lot-1'))?.usdInrOnAcquire).toBe(850_000);
    expect((await db.equityLots.get('lot-3'))?.usdInrOnAcquire).toBe(840_000);

    expect(await usdInrOn(db, fetch, '2026-10-02')).toBe(855_000);
    expect(calls).toEqual(['https://api.frankfurter.dev/v1/2026-10-02?base=USD&symbols=INR']);
    expect((await db.equityLots.get('lot-2'))?.usdInrOnAcquire).toBe(855_000);
    expect(await pricesFor(db, 'USDINR')).toEqual([
      { symbol: 'USDINR', date: '2026-10-01', value: 850_000, source: 'api' },
      { symbol: 'USDINR', date: '2026-10-02', value: 855_000, source: 'api' },
    ]);

    expect(await usdInrOn(db, fetch, '2026-10-03')).toBeNull();
  });
});
