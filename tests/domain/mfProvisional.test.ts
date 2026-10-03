import { describe, expect, it } from 'vitest';
import {
  STAMP_DUTY_RATE,
  confirm,
  estimateUnits,
  isCoveredByCas,
  learnLinks,
  markStale,
  matchLink,
  mfValueAt,
  type Provisional,
  type SipLink,
} from '../../src/domain/mfProvisional';

function link(over: Partial<SipLink> & Pick<SipLink, 'id' | 'schemeKey'>): SipLink {
  return {
    narrationPattern: 'ACH INDIAN CLEARING',
    grossPaise: 2_200_000,
    dayOfMonth: 5,
    accountId: 'sbi-0001',
    source: 'learned',
    ...over,
  };
}

function provisional(over: Partial<Provisional> & Pick<Provisional, 'id'>): Provisional {
  return {
    bankTxnId: 'b1',
    schemeKey: 'S1',
    date: '2026-05-05',
    grossPaise: 2_200_000,
    estUnits: 879956,
    navDate: '2026-05-05',
    status: 'provisional',
    ...over,
  };
}

const debit = (over: Partial<{ id: string; accountId: string; date: string; amount: number; description: string }>) => ({
  id: 'd1',
  accountId: 'sbi-0001',
  date: '2026-05-06',
  amount: -1_000_000,
  description: 'ACH INDIAN CLEARING',
  ...over,
});

describe('estimateUnits', () => {
  it('deducts stamp duty at 0.005% of the gross', () => {
    expect(STAMP_DUTY_RATE).toBe(0.00005);
    expect(Math.round(2_200_000 * STAMP_DUTY_RATE)).toBe(110);
  });

  it('estimates units at the given NAV', () => {
    // round((2200000 − 110) / 25.0000 / 100 × 1000)
    expect(estimateUnits(2_200_000, 250000)).toBe(879956);
  });
});

describe('learnLinks', () => {
  const buy = { schemeKey: 'S1', date: '2026-05-08', gross: 2_200_000 };

  it('learns from a bank debit 0–5 days before the allotment', () => {
    const learned = learnLinks(
      [buy],
      [debit({ id: 'b1', date: '2026-05-05', amount: -2_200_000, description: 'ACH … INDIAN CLEARING' })],
      [],
    );
    expect(learned).toHaveLength(1);
    expect(learned[0]).toMatchObject({
      schemeKey: 'S1',
      narrationPattern: 'ACH … INDIAN CLEARING',
      grossPaise: 2_200_000,
      dayOfMonth: 5,
      accountId: 'sbi-0001',
      source: 'learned',
    });
  });

  it('does not learn from a debit 8 days before the allotment', () => {
    const learned = learnLinks(
      [buy],
      [debit({ id: 'b2', date: '2026-04-30', amount: -2_200_000, description: 'ACH … INDIAN CLEARING' })],
      [],
    );
    expect(learned).toEqual([]);
  });

  it('replaces digit runs of 6 or more with \\d+', () => {
    const learned = learnLinks(
      [buy],
      [debit({ id: 'b3', date: '2026-05-05', amount: -2_200_000, description: 'ACH DR 123456 INDIAN CLEARING' })],
      [],
    );
    expect(learned[0].narrationPattern).toBe('ACH DR \\d+ INDIAN CLEARING');
  });

  it('is idempotent and never overwrites a user link', () => {
    const onTime = debit({ id: 'b4', date: '2026-05-05', amount: -2_200_000 });
    const learned = learnLinks([buy], [onTime], []);
    expect(learnLinks([buy], [onTime], learned)).toEqual(learned);

    const user = link({ id: 'u1', schemeKey: 'S1' });
    user.source = 'user';
    expect(learnLinks([buy], [onTime], [user])).toEqual([]);
  });
});

describe('matchLink', () => {
  it('breaks ties by the smallest day-of-month distance', () => {
    const links = [
      link({ id: 'a', schemeKey: 'A', grossPaise: 1_000_000, dayOfMonth: 5 }),
      link({ id: 'b', schemeKey: 'B', grossPaise: 1_000_000, dayOfMonth: 20 }),
    ];
    expect(matchLink(debit({}), links, {})).toEqual({ schemeKey: 'A' });
  });

  it('returns null when the amount is outside ±0.1%', () => {
    const links = [link({ id: 'a', schemeKey: 'A', grossPaise: 1_000_000 })];
    expect(matchLink(debit({ amount: -1_002_000 }), links, {})).toBeNull();
  });

  it('returns null when the narration pattern does not match', () => {
    const links = [link({ id: 'a', schemeKey: 'A', grossPaise: 1_000_000 })];
    expect(matchLink(debit({ description: 'SOME OTHER DEBIT' }), links, {})).toBeNull();
  });

  it('returns null when the day of month is more than 4 away', () => {
    const links = [
      link({ id: 'a', schemeKey: 'A', grossPaise: 1_000_000, dayOfMonth: 5 }),
      link({ id: 'b', schemeKey: 'B', grossPaise: 1_000_000, dayOfMonth: 20 }),
    ];
    expect(matchLink(debit({ date: '2026-05-12' }), links, {})).toBeNull();
  });

  it('requires the debit to be after the scheme’s last CAS date', () => {
    const links = [link({ id: 'a', schemeKey: 'A', grossPaise: 1_000_000 })];
    expect(matchLink(debit({ date: '2026-05-06' }), links, { A: '2026-05-06' })).toBeNull();
    expect(matchLink(debit({ date: '2026-05-07' }), links, { A: '2026-05-06' })).toEqual({ schemeKey: 'A' });
  });

  it('reports remaining ties as ambiguous', () => {
    const links = [
      link({ id: 'a', schemeKey: 'A', grossPaise: 1_000_000, dayOfMonth: 5 }),
      link({ id: 'b', schemeKey: 'B', grossPaise: 1_000_000, dayOfMonth: 7 }),
    ];
    expect(matchLink(debit({}), links, {})).toEqual({ ambiguous: ['A', 'B'] });
  });

  it('does not treat two links of the same scheme as ambiguous', () => {
    const links = [
      link({ id: 'a', schemeKey: 'A', grossPaise: 1_000_000, dayOfMonth: 5 }),
      link({ id: 'b', schemeKey: 'A', grossPaise: 1_000_000, dayOfMonth: 7 }),
    ];
    expect(matchLink(debit({}), links, {})).toEqual({ schemeKey: 'A' });
  });
});

describe('confirm', () => {
  const casTxn = (id: string, schemeKey: string, date: string, gross: number) => ({ id, schemeKey, date, gross });

  it('confirms when a CAS txn is 0–7 days after the debit', () => {
    const matched = confirm([provisional({ id: 'p1' })], [casTxn('c1', 'S1', '2026-05-08', 2_200_000)]);
    expect(matched[0]).toMatchObject({ status: 'confirmed', confirmedByMfTxnId: 'c1' });
  });

  it('does not confirm when the CAS txn is 9 days after the debit', () => {
    const result = confirm([provisional({ id: 'p1' })], [casTxn('c2', 'S1', '2026-05-14', 2_200_000)]);
    expect(result[0].status).toBe('provisional');
    expect(result[0].confirmedByMfTxnId).toBeUndefined();
  });

  it('requires the same scheme and a gross within ±0.1%', () => {
    expect(confirm([provisional({ id: 'p1' })], [casTxn('c3', 'S2', '2026-05-08', 2_200_000)])[0].status).toBe(
      'provisional',
    );
    expect(confirm([provisional({ id: 'p1' })], [casTxn('c4', 'S1', '2026-05-08', 2_210_000)])[0].status).toBe(
      'provisional',
    );
  });
});

describe('confirm of unassigned provisionals', () => {
  const casTxn = (id: string, schemeKey: string, date: string, gross: number) => ({ id, schemeKey, date, gross });

  it('matches a CAS txn of any scheme and takes that scheme', () => {
    const result = confirm(
      [provisional({ id: 'p1', schemeKey: 'unassigned', estUnits: 0, navDate: null })],
      [casTxn('c1', 'S9', '2026-05-08', 2_200_000)],
    );
    expect(result[0]).toMatchObject({ status: 'confirmed', schemeKey: 'S9', confirmedByMfTxnId: 'c1' });
  });

  it('lets each CAS txn confirm only one provisional', () => {
    const result = confirm(
      [
        provisional({ id: 'p1', schemeKey: 'unassigned' }),
        provisional({ id: 'p2', schemeKey: 'unassigned', bankTxnId: 'b2' }),
      ],
      [casTxn('c1', 'S1', '2026-05-08', 2_200_000)],
    );
    expect(result.map((p) => p.status)).toEqual(['confirmed', 'provisional']);
  });

  it('keeps an assigned provisional to its own scheme', () => {
    const result = confirm([provisional({ id: 'p1', schemeKey: 'S1' })], [casTxn('c1', 'S2', '2026-05-08', 2_200_000)]);
    expect(result[0].status).toBe('provisional');
  });
});

describe('isCoveredByCas', () => {
  it('needs coverage to reach the debit date + 7 days', () => {
    expect(isCoveredByCas('2026-05-01', '2026-05-07')).toBe(false);
    expect(isCoveredByCas('2026-05-01', '2026-05-08')).toBe(true);
    expect(isCoveredByCas('2026-05-01', undefined)).toBe(false);
  });
});

describe('markStale', () => {
  it('is stale 45 days after the debit (46 days in the binding example)', () => {
    const p = provisional({ id: 'p1', date: '2026-01-01' });
    expect(markStale([p], {}, '2026-02-14')[0].status).toBe('provisional');
    expect(markStale([p], {}, '2026-02-15')[0].status).toBe('stale');
    expect(markStale([p], {}, '2026-02-16')[0].status).toBe('stale');
  });

  it('is stale once CAS coverage reaches debit + 7 days', () => {
    const p = provisional({ id: 'p1', date: '2026-05-01' });
    expect(markStale([p], { S1: '2026-05-07' }, '2026-05-02')[0].status).toBe('provisional');
    expect(markStale([p], { S1: '2026-05-08' }, '2026-05-02')[0].status).toBe('stale');
  });

  it('leaves confirmed provisionals confirmed', () => {
    const p = provisional({ id: 'p1', date: '2026-01-01', status: 'confirmed', confirmedByMfTxnId: 'c1' });
    expect(markStale([p], {}, '2026-06-01')[0]).toEqual(p);
  });
});

describe('mfValueAt', () => {
  it('excludes confirmed provisionals and includes unassigned ones at gross', () => {
    const confirmedValue = 2_500_000; // 1,000 units of A at NAV 25.0000
    const unassignedGross = 500_000;
    const staleValue = 61_250; // 24.5 units of A at NAV 25.0000
    const result = mfValueAt({ A: 1_000_000 }, { A: 250000 }, [
      provisional({ id: 'p1', schemeKey: 'A', status: 'confirmed', confirmedByMfTxnId: 'c1' }),
      provisional({ id: 'p2', schemeKey: 'unassigned', grossPaise: unassignedGross, estUnits: 0, navDate: null }),
      provisional({ id: 'p3', schemeKey: 'A', status: 'stale', estUnits: 24500 }),
    ]);
    expect(result.value).toBe(confirmedValue + unassignedGross + staleValue);
    expect(result.provisionalValue).toBe(unassignedGross + staleValue);
    expect(result.provisionalCount).toBe(2);
  });

  it('falls back to gross when an assigned scheme has no NAV yet', () => {
    const result = mfValueAt({}, {}, [
      provisional({ id: 'p1', schemeKey: 'B', grossPaise: 400_000, estUnits: 15000 }),
    ]);
    expect(result).toEqual({ value: 400_000, provisionalValue: 400_000, provisionalCount: 1 });
  });
});
