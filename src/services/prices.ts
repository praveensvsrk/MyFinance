import { equitySymbol, getSetting, putPrice, setSetting } from '../db/repos';
import type { FinanceDb, MfFolioRow } from '../db/schema';
import type { IsoDate } from '../parsers/types';
import { refreshProvisionalUnits } from './provisional';

/**
 * Daily price refresh (§2): the employer stock (once an E*TRADE import has named it) from Finnhub, USD→INR from Frankfurter with an
 * open.er-api.com fallback, and MF NAVs from mfapi.in, stored in `prices` keyed
 * by `[symbol+date]`. Every network call goes through the injected `fetch` so
 * tests can fake the whole refresh.
 */

/** Inside this window a refresh is skipped unless `force` is set. */
const REFRESH_WINDOW_MS = 20 * 60 * 60 * 1000;

const finnhubQuoteUrl = (symbol: string): string =>
  `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=`;
const FRANKFURTER_LATEST_URL = 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=INR';
const ER_API_LATEST_URL = 'https://open.er-api.com/v6/latest/USD';
const MFAPI_SEARCH_URL = 'https://api.mfapi.in/mf/search?q=';
const MFAPI_META_URL = 'https://api.mfapi.in/mf/';

/** Settings owned by this service. */
const FINNHUB_KEY_SETTING = 'finnhubKey';
const LAST_REFRESH_SETTING = 'lastPriceRefresh';
const PRICE_FAILURES_SETTING = 'priceFailures';

export interface PriceRefreshOptions {
  /** Injected `fetch` for testability. */
  fetch: typeof fetch;
  /** Clock override; defaults to the current time. */
  now?: Date;
  /** Refresh even when the previous refresh is inside the 20 h window. */
  force?: boolean;
}

export interface PriceFailure {
  symbol: string;
  reason: string;
}

export interface PriceRefreshResult {
  updated: string[];
  failed: PriceFailure[];
}

/** `GET`s a URL and parses JSON; any network, HTTP or parse error returns `null`. */
async function getJson<T>(doFetch: typeof fetch, url: string): Promise<T | null> {
  try {
    const response = await doFetch(url);
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Unix seconds → ISO date in UTC. */
function isoFromUnixSeconds(seconds: number): IsoDate {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

/** mfapi.in `dd-mm-yyyy` → ISO `YYYY-MM-DD`. */
function isoFromDdMmYyyy(value: string): IsoDate | null {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

/** Scheme codes from an mfapi.in search response, which is an array or `{data: [...]}`. */
function candidateCodes(raw: unknown): number[] {
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : raw !== null && typeof raw === 'object' && Array.isArray((raw as { data?: unknown }).data)
      ? (raw as { data: unknown[] }).data
      : [];
  const codes = new Set<number>();
  for (const entry of list) {
    const value =
      typeof entry === 'number'
        ? entry
        : entry !== null && typeof entry === 'object'
          ? ((entry as { schemeCode?: unknown }).schemeCode ?? (entry as { code?: unknown }).code)
          : undefined;
    const code = typeof value === 'string' ? Number(value) : value;
    if (isFiniteNumber(code)) codes.add(code);
  }
  return [...codes];
}

/**
 * Search queries to try for a CAS scheme name, most specific first. CAS names carry text mfapi.in's
 * names do not (`(formerly …)`, `Dir` for `Direct Plan`, a trailing option), so the parentheticals
 * are never searched; the second query also drops the plan/option suffix.
 */
export function searchQueries(schemeName: string): string[] {
  const name = schemeName.replace(/\s+/g, ' ').trim();
  const withoutNotes = name.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  const base = withoutNotes.split(/\s+-\s+(?:Direct|Dir|Regular)\b/i)[0].trim();
  return [...new Set([withoutNotes, base].filter((query) => query !== ''))];
}

/**
 * Finds the AMFI scheme code for a scheme name and CAS ISIN: searches mfapi.in (see
 * {@link searchQueries}), inspects up to 20 candidates of each search and returns the code whose
 * growth or dividend-reinvestment ISIN matches. Without an ISIN match it never guesses between
 * plans: a lone candidate is accepted only when nothing contradicts it (no ISIN published, or no
 * ISIN to check against), several such candidates give `'ambiguous'`, and `null` means there is no
 * usable candidate (no search results, or every candidate carries a different ISIN).
 */
export async function resolveAmfiCode(
  doFetch: typeof fetch,
  schemeName: string,
  isin: string,
): Promise<number | 'ambiguous' | null> {
  let outcome: 'ambiguous' | null = null;
  for (const query of searchQueries(schemeName)) {
    const resolved = await resolveFromSearch(doFetch, query, isin);
    if (typeof resolved === 'number') return resolved;
    if (resolved === 'ambiguous') outcome = 'ambiguous';
  }
  return outcome;
}

async function resolveFromSearch(
  doFetch: typeof fetch,
  query: string,
  isin: string,
): Promise<number | 'ambiguous' | null> {
  const search = await getJson<unknown>(doFetch, `${MFAPI_SEARCH_URL}${encodeURIComponent(query)}`);
  const codes = candidateCodes(search).slice(0, 20);
  if (codes.length === 0) return null;

  const matches: number[] = [];
  const unverifiable: number[] = [];
  for (const code of codes) {
    const detail = await getJson<{
      meta?: { isin_growth?: unknown; isin_div_reinvestment?: unknown };
    }>(doFetch, `${MFAPI_META_URL}${code}/latest`);
    const meta = detail?.meta;
    const published = [meta?.isin_growth, meta?.isin_div_reinvestment].filter(
      (value): value is string => typeof value === 'string' && value !== '',
    );
    if (isin !== '' && published.includes(isin)) matches.push(code);
    else if (isin === '' || published.length === 0) unverifiable.push(code);
  }
  if (matches.length > 0) return matches.length === 1 ? matches[0] : 'ambiguous';
  if (unverifiable.length === 0) return null;
  return unverifiable.length === 1 ? unverifiable[0] : 'ambiguous';
}

/** Refreshes the employer stock, USDINR and every folio's NAV, respecting the 20 h window. */
export async function refreshPrices(
  db: FinanceDb,
  options: PriceRefreshOptions,
): Promise<PriceRefreshResult> {
  const doFetch = options.fetch;
  const now = options.now ?? new Date();
  const force = options.force ?? false;

  if (!force) {
    const last = await getSetting<string | null>(db, LAST_REFRESH_SETTING, null);
    const lastMs = typeof last === 'string' ? Date.parse(last) : Number.NaN;
    if (Number.isFinite(lastMs) && now.getTime() - lastMs < REFRESH_WINDOW_MS) {
      return { updated: [], failed: [] };
    }
  }

  const updated: string[] = [];
  const failed: PriceFailure[] = [];
  const addUpdated = (symbol: string): void => {
    if (!updated.includes(symbol)) updated.push(symbol);
  };

  // Employer stock: Finnhub quote, price in USD cents at the trade date. The ticker comes from the
  // imported E*TRADE files, so before any import there is nothing to quote and nothing to report.
  const symbol = await equitySymbol(db);
  const finnhubKey = await getSetting(db, FINNHUB_KEY_SETTING, '');
  if (symbol === '') {
    // Nothing imported yet.
  } else if (typeof finnhubKey !== 'string' || finnhubKey.trim() === '') {
    failed.push({ symbol, reason: 'no-key' });
  } else {
    const quote = await getJson<{ c?: unknown; t?: unknown }>(
      doFetch,
      `${finnhubQuoteUrl(symbol)}${encodeURIComponent(finnhubKey)}`,
    );
    const priceUsd = quote?.c;
    const tradedAt = quote?.t;
    if (!isFiniteNumber(priceUsd) || priceUsd <= 0 || !isFiniteNumber(tradedAt) || tradedAt <= 0) {
      failed.push({ symbol, reason: 'fetch-failed' });
    } else {
      await putPrice(db, {
        symbol,
        date: isoFromUnixSeconds(tradedAt),
        value: Math.round(priceUsd * 100),
        source: 'api',
      });
      addUpdated(symbol);
    }
  }

  // USDINR: Frankfurter, falling back to er-api when it fails.
  const frankfurter = await getJson<{ date?: unknown; rates?: { INR?: unknown } }>(
    doFetch,
    FRANKFURTER_LATEST_URL,
  );
  const frankfurterRate = frankfurter?.rates?.INR;
  const frankfurterDate = frankfurter?.date;
  if (
    isFiniteNumber(frankfurterRate) &&
    typeof frankfurterDate === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(frankfurterDate)
  ) {
    await putPrice(db, {
      symbol: 'USDINR',
      date: frankfurterDate,
      value: Math.round(frankfurterRate * 10_000),
      source: 'api',
    });
    addUpdated('USDINR');
  } else {
    const fallback = await getJson<{ rates?: { INR?: unknown }; time_last_update_unix?: unknown }>(
      doFetch,
      ER_API_LATEST_URL,
    );
    const rate = fallback?.rates?.INR;
    const updatedAt = fallback?.time_last_update_unix;
    if (!isFiniteNumber(rate) || !isFiniteNumber(updatedAt) || updatedAt <= 0) {
      failed.push({ symbol: 'USDINR', reason: 'fetch-failed' });
    } else {
      await putPrice(db, {
        symbol: 'USDINR',
        date: isoFromUnixSeconds(updatedAt),
        value: Math.round(rate * 10_000),
        source: 'api',
      });
      addUpdated('USDINR');
    }
  }

  // MF NAVs, resolving AMFI codes for folios that do not carry one yet.
  for (const folio of await db.mfFolios.toArray()) {
    await refreshFolio(db, doFetch, folio, addUpdated, failed);
  }

  // Best effort: fill the acquisition rates the equity mapper could not look up.
  await backfillMissingLotRates(db, doFetch);

  // New NAVs may now value provisionals that had none, or only one from before their debit.
  await refreshProvisionalUnits(db);

  // An attempt that stored nothing (e.g. offline) must not block a retry for the whole window.
  if (updated.length > 0) await setSetting(db, LAST_REFRESH_SETTING, now.toISOString());
  await setSetting(db, PRICE_FAILURES_SETTING, [...new Set(failed.map((failure) => failure.symbol))]);
  return { updated, failed };
}

/** Resolves and persists a folio's AMFI code if needed, then stores its latest NAV. */
async function refreshFolio(
  db: FinanceDb,
  doFetch: typeof fetch,
  folio: MfFolioRow,
  addUpdated: (symbol: string) => void,
  failed: PriceFailure[],
): Promise<void> {
  let code = isFiniteNumber(folio.amfiCode) ? folio.amfiCode : null;
  if (code === null) {
    const resolved = await resolveAmfiCode(doFetch, folio.scheme, folio.isin);
    if (typeof resolved !== 'number') {
      failed.push({
        symbol: `MF:${folio.isin === '' ? folio.id : folio.isin}`,
        reason: resolved === 'ambiguous' ? 'ambiguous' : 'no-code',
      });
      return;
    }
    code = resolved;
    await db.mfFolios.put({ ...folio, amfiCode: code });
  }

  const symbol = `MF:${code}`;
  const latest = await getJson<{ data?: { date?: unknown; nav?: unknown }[] }>(
    doFetch,
    `${MFAPI_META_URL}${code}/latest`,
  );
  const point = latest?.data?.[0];
  const date = point && typeof point.date === 'string' ? isoFromDdMmYyyy(point.date) : null;
  const nav = point?.nav;
  const value = typeof nav === 'string' || typeof nav === 'number' ? Number(nav) : Number.NaN;
  if (date === null || !Number.isFinite(value)) {
    failed.push({ symbol, reason: 'fetch-failed' });
    return;
  }
  await putPrice(db, { symbol, date, value: Math.round(value * 10_000), source: 'api' });
  addUpdated(symbol);
}

/** Fetches and stores the USDINR rate, backfilling lots acquired on `date`. */
async function backfillLotsOn(db: FinanceDb, date: IsoDate, rate: number): Promise<void> {
  const lots = await db.equityLots
    .filter((lot) => lot.acquiredDate === date && (lot.usdInrOnAcquire ?? null) === null)
    .toArray();
  if (lots.length === 0) return;
  await db.equityLots.bulkPut(lots.map((lot) => ({ ...lot, usdInrOnAcquire: rate })));
}

/** Best-effort backfill of every lot whose acquisition rate has not been looked up yet. */
async function backfillMissingLotRates(db: FinanceDb, doFetch: typeof fetch): Promise<void> {
  const lots = await db.equityLots.filter((lot) => (lot.usdInrOnAcquire ?? null) === null).toArray();
  for (const date of [...new Set(lots.map((lot) => lot.acquiredDate))]) {
    try {
      await usdInrOn(db, doFetch, date);
    } catch {
      // Leave the lot rate null; the next refresh retries.
    }
  }
}

/**
 * The USDINR rate ×10⁴ for an ISO date: from `prices` when present, otherwise
 * fetched from Frankfurter and stored under the requested date. Lots acquired on
 * that date with a null `usdInrOnAcquire` are backfilled.
 */
export async function usdInrOn(
  db: FinanceDb,
  doFetch: typeof fetch,
  date: IsoDate,
): Promise<number | null> {
  const stored = await db.prices.get(['USDINR', date]);
  let rate: number;
  if (stored && isFiniteNumber(stored.value)) {
    rate = stored.value;
  } else {
    const response = await getJson<{ rates?: { INR?: unknown } }>(
      doFetch,
      `https://api.frankfurter.dev/v1/${date}?base=USD&symbols=INR`,
    );
    const value = response?.rates?.INR;
    if (!isFiniteNumber(value)) return null;
    rate = Math.round(value * 10_000);
    await putPrice(db, { symbol: 'USDINR', date, value: rate, source: 'api' });
  }
  await backfillLotsOn(db, date, rate);
  return rate;
}
