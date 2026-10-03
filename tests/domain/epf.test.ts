import { describe, expect, it } from 'vitest';
import { epfBalanceAt, linkTransfers, passbookToEntries, type EpfEntry } from '../../src/domain/epf';
import type { EpfAmounts, EpfPassbook, EpfRow } from '../../src/parsers/types';

function amounts(ee: number, er: number, eps = 0): EpfAmounts {
  return { ee, er, eps };
}

function row(
  wageMonth: string,
  kind: EpfRow['kind'],
  creditDate: string,
  ee: number,
  er: number,
  extra: Partial<EpfRow> = {},
): EpfRow {
  return {
    wageMonth,
    creditDate,
    kind,
    particulars: '',
    epfWages: 0,
    epsWages: 0,
    amounts: { ee, er, eps: 0 },
    ...extra,
  };
}

function passbook(
  fyStart: number,
  opening: EpfAmounts,
  rows: EpfRow[],
  interest: EpfAmounts | null = null,
): EpfPassbook {
  return {
    source: 'epf',
    memberId: 'MEMBER',
    establishmentId: 'EST',
    establishmentName: 'Example Pvt Ltd',
    fyStart,
    opening,
    rows,
    interest,
    closing: { ee: 0, er: 0, eps: 0 },
    totalContributions: { ee: 0, er: 0, eps: 0 },
    validation: { ok: true, checks: [], notes: [] },
  };
}

describe('passbookToEntries', () => {
  it('emits the opening, one entry per row and the interest entry', () => {
    const p = passbook(
      2024,
      amounts(100000, 20000, 5000),
      [
        row('2024-04', 'contribution', '2024-05-15', 30000, 12000, { fromMemberId: 'M001' }),
        row('2024-05', 'withdrawal', '2024-06-10', -10000, 0),
      ],
      amounts(4000, 800, 1000),
    );
    const entries = passbookToEntries('acc', p);
    expect(entries).toHaveLength(4);
    expect(entries[0]).toMatchObject({
      accountId: 'acc',
      fy: 2024,
      kind: 'opening',
      creditDate: '2024-04-01',
      ee: 100000,
      er: 20000,
      eps: 5000,
    });
    expect(entries[1]).toMatchObject({
      kind: 'contribution',
      wageMonth: '2024-04',
      creditDate: '2024-05-15',
      ee: 30000,
      er: 12000,
      linkedMemberId: 'M001',
    });
    expect(entries[2]).toMatchObject({ kind: 'withdrawal', creditDate: '2024-06-10', ee: -10000, er: 0 });
    expect(entries[3]).toMatchObject({
      kind: 'interest',
      creditDate: '2025-03-31',
      ee: 4000,
      er: 800,
      eps: 1000,
    });
  });

  it('omits the interest entry when the passbook has none', () => {
    const entries = passbookToEntries('acc', passbook(2025, amounts(1, 2, 3), []));
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe('opening');
  });
});

describe('epfBalanceAt', () => {
  const entries: EpfEntry[] = [
    ...passbookToEntries(
      'a',
      passbook(
        2025,
        amounts(1000, 100, 50),
        [
          row('2025-04', 'contribution', '2025-05-10', 2000, 200),
          row('2025-05', 'transferIn', '2025-06-05', 5000, 500),
        ],
        amounts(30, 3, 1),
      ),
    ),
    ...passbookToEntries(
      'a',
      passbook(2026, amounts(9000, 900, 100), [row('2026-04', 'contribution', '2026-05-10', 1000, 100)]),
    ),
  ];

  it('returns zero before the first opening entry', () => {
    expect(epfBalanceAt(entries, '2025-03-31')).toEqual({ ee: 0, er: 0, eps: 0, total: 0 });
  });

  it('takes the latest FY opening on or before the date as the base', () => {
    expect(epfBalanceAt(entries, '2025-04-15')).toEqual({ ee: 1000, er: 100, eps: 50, total: 1100 });
  });

  it('adds only the rows credited on or before the date', () => {
    expect(epfBalanceAt(entries, '2025-05-10')).toEqual({ ee: 3000, er: 300, eps: 50, total: 3300 });
    expect(epfBalanceAt(entries, '2025-06-04')).toEqual({ ee: 3000, er: 300, eps: 50, total: 3300 });
    expect(epfBalanceAt(entries, '2025-06-05')).toEqual({ ee: 8000, er: 800, eps: 50, total: 8800 });
  });

  it('adds the interest only once its date is reached', () => {
    expect(epfBalanceAt(entries, '2025-06-30')).toEqual({ ee: 8000, er: 800, eps: 50, total: 8800 });
    expect(epfBalanceAt(entries, '2026-03-31')).toEqual({ ee: 8030, er: 803, eps: 51, total: 8833 });
  });

  it('switches to the next FY opening instead of carrying the old rows', () => {
    expect(epfBalanceAt(entries, '2026-04-01')).toEqual({ ee: 9000, er: 900, eps: 100, total: 9900 });
    expect(epfBalanceAt(entries, '2026-05-10')).toEqual({ ee: 10000, er: 1000, eps: 100, total: 11000 });
  });
});

describe('linkTransfers', () => {
  const accounts = [
    { accountId: 'old', memberId: 'M001' },
    { accountId: 'new', memberId: 'M002' },
  ];

  function oldPassbook(): EpfPassbook {
    return passbook(2024, amounts(10000000, 500000), []);
  }

  function newPassbook(fromMemberId: string | undefined): EpfPassbook {
    return passbook(
      2024,
      amounts(0, 0),
      [row('2024-06', 'transferIn', '2024-06-15', 12000000, 0, { fromMemberId })],
    );
  }

  it('closes the old account with a transferOut and infers the missing interest', () => {
    const oldEntries = passbookToEntries('old', oldPassbook());
    const newEntries = passbookToEntries('new', newPassbook('M001'));
    const synthetic = linkTransfers(accounts, [...oldEntries, ...newEntries]);

    const interest = synthetic.find((e) => e.kind === 'interest');
    expect(interest).toMatchObject({
      accountId: 'old',
      kind: 'interest',
      creditDate: '2024-06-14',
      inferred: true,
      eps: 0,
    });
    expect(interest!.ee + interest!.er).toBe(1500000);

    const transferOut = synthetic.find((e) => e.kind === 'transferOut');
    expect(transferOut).toMatchObject({ accountId: 'old', creditDate: '2024-06-15' });
    expect(transferOut!.ee + transferOut!.er).toBe(-12000000);

    const all = [...oldEntries, ...newEntries, ...synthetic];
    expect(epfBalanceAt(all.filter((e) => e.accountId === 'old'), '2024-06-15').total).toBe(0);
    expect(epfBalanceAt(all.filter((e) => e.accountId === 'new'), '2024-06-15').total).toBe(12000000);
  });

  it('handles a transfer on April 1 across the FY boundary', () => {
    const oldEntries = [
      ...passbookToEntries('old', passbook(2024, amounts(1000000, 0), [], amounts(50000, 0))),
      ...passbookToEntries('old', passbook(2025, amounts(1050000, 0), [])),
    ];
    const newEntries = passbookToEntries(
      'new',
      passbook(2025, amounts(0, 0), [
        row('2025-04', 'transferIn', '2025-04-01', 1100000, 0, { fromMemberId: 'M001' }),
      ]),
    );
    const synthetic = linkTransfers(accounts, [...oldEntries, ...newEntries]);
    const interest = synthetic.find((e) => e.kind === 'interest');
    expect(interest!.creditDate).toBe('2025-03-31');
    expect(interest!.ee + interest!.er).toBe(50000);
    const all = [...oldEntries, ...newEntries, ...synthetic];
    expect(epfBalanceAt(all.filter((e) => e.accountId === 'old'), '2025-04-01').total).toBe(0);
  });

  it('splits the inferred interest between EE and ER in proportion to the transfer', () => {
    const oldEntries = passbookToEntries('old', oldPassbook());
    const newEntries = passbookToEntries(
      'new',
      passbook(2024, amounts(0, 0), [row('2024-06', 'transferIn', '2024-06-15', 10000000, 2000000, { fromMemberId: 'M001' })]),
    );
    const interest = linkTransfers(accounts, [...oldEntries, ...newEntries]).find(
      (e) => e.kind === 'interest',
    );
    expect(interest!.ee).toBe(1250000);
    expect(interest!.er).toBe(250000);
    expect(interest!.ee + interest!.er).toBe(1500000);
  });

  it('adds no interest when the transfer does not exceed the old balance', () => {
    const oldEntries = passbookToEntries('old', passbook(2024, amounts(30000000, 0), []));
    const newEntries = passbookToEntries('new', newPassbook('M001'));
    const synthetic = linkTransfers(accounts, [...oldEntries, ...newEntries]);
    expect(synthetic.map((e) => e.kind)).toEqual(['transferOut']);
    expect(synthetic[0].ee + synthetic[0].er).toBe(-30000000);
  });

  it('makes no synthetic entries for an unknown linkedMemberId', () => {
    const oldEntries = passbookToEntries('old', oldPassbook());
    const newEntries = passbookToEntries('new', newPassbook('M999'));
    expect(linkTransfers(accounts, [...oldEntries, ...newEntries])).toEqual([]);
  });

  it('zeroes an old account whose passbook ends in an earlier FY than the transfer', () => {
    // The old account only has FY2023; the transfer happens in FY2024, which it has no opening for.
    const oldEntries = passbookToEntries('old', passbook(2023, amounts(10000000, 500000), []));
    const newEntries = passbookToEntries('new', newPassbook('M001'));
    const synthetic = linkTransfers(accounts, [...oldEntries, ...newEntries]);
    const all = [...oldEntries, ...newEntries, ...synthetic];

    expect(epfBalanceAt(all.filter((e) => e.accountId === 'old'), '2024-07-01').total).toBe(0);
    // Before the transfer the old account still holds its balance.
    expect(epfBalanceAt(all.filter((e) => e.accountId === 'old'), '2024-06-01').total).toBe(10500000);
  });

  it('adds nothing when run again over its own output', () => {
    const oldEntries = passbookToEntries('old', oldPassbook());
    const newEntries = passbookToEntries('new', newPassbook('M001'));
    const first = linkTransfers(accounts, [...oldEntries, ...newEntries]);
    expect(first.length).toBeGreaterThan(0);
    const second = linkTransfers(accounts, [...oldEntries, ...newEntries, ...first]);
    expect(second).toEqual([]);
  });
});
