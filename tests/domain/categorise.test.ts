import { describe, expect, it } from 'vitest';
import {
  categorise,
  DEFAULT_CATEGORIES,
  extractMcc,
  MCC_CATEGORIES,
  normaliseDescription,
  previewRule,
  ruleMatches,
  type Rule,
  type RuleTargetTxn,
} from '../../src/domain/categorise';

describe('DEFAULT_CATEGORIES', () => {
  it('lists every built-in category, Transport included', () => {
    expect(DEFAULT_CATEGORIES).toEqual([
      'Salary',
      'Rent',
      'Groceries',
      'Food delivery',
      'Utilities',
      'Fuel',
      'Shopping',
      'Medical',
      'Insurance',
      'Loan EMI',
      'Investments',
      'Interest',
      'Transport',
      'Family',
      'Other',
    ]);
  });
});

describe('MCC_CATEGORIES', () => {
  it('maps the known merchant category codes', () => {
    expect(MCC_CATEGORIES['5411']).toBe('Groceries');
    expect(MCC_CATEGORIES['5812']).toBe('Food delivery');
    expect(MCC_CATEGORIES['5814']).toBe('Food delivery');
    expect(MCC_CATEGORIES['4900']).toBe('Utilities');
    expect(MCC_CATEGORIES['4814']).toBe('Utilities');
    expect(MCC_CATEGORIES['4112']).toBe('Transport');
    expect(MCC_CATEGORIES['5541']).toBe('Fuel');
    expect(MCC_CATEGORIES['5542']).toBe('Fuel');
    expect(MCC_CATEGORIES['5912']).toBe('Medical');
  });

  it('maps 0000 to null (P2P, no category)', () => {
    expect(MCC_CATEGORIES['0000']).toBeNull();
  });
});

describe('normaliseDescription', () => {
  it('uppercases and collapses whitespace', () => {
    expect(normaliseDescription('  broker   payout  ')).toBe('BROKER PAYOUT');
  });

  it('strips an SBI branch suffix with the branch code', () => {
    expect(normaliseDescription('NEFT CR 1234567890123 AT 400001 MUMBAI')).toBe('NEFT CR');
  });

  it('strips a trailing branch, city suffix', () => {
    expect(normaliseDescription('SALARY PAYMENT MUMBAI, MAHARASHTRA')).toBe('SALARY PAYMENT');
  });

  it('strips both suffixes in sequence', () => {
    expect(normaliseDescription('ATM WDL 1234567890123 AT 400001 PUNE, MAHARASHTRA')).toBe('ATM WDL');
  });
});

describe('extractMcc', () => {
  it('reads the trailing MCC of a UPIOUT narration', () => {
    expect(extractMcc('UPIOUT/123/x@y/note/5411')).toBe('5411');
    expect(extractMcc('UPIOUT/456/x@y/note/5812')).toBe('5812');
  });

  it('returns null without a UPIOUT trailing code', () => {
    expect(extractMcc('POS 5411 GROCERY')).toBeNull();
    expect(extractMcc('UPIOUT/123/x@y/note')).toBeNull();
  });
});

describe('categorise', () => {
  const priorityRules: Rule[] = [
    { id: 'low', pattern: 'BROKER', isRegex: false, category: 'Investments', kind: 'investment', priority: 1 },
    { id: 'high', pattern: 'BROKER PAYOUT', isRegex: false, category: 'Rent', priority: 10 },
  ];

  it('lets the higher-priority rule win', () => {
    expect(categorise({ description: 'BROKER PAYOUT OCT', amount: -100000 }, priorityRules)).toEqual({
      category: 'Rent',
      kind: 'normal',
      ruleId: 'high',
    });
  });

  it('falls through to the lower-priority rule when the higher one does not match', () => {
    expect(categorise({ description: 'BROKER SIP', amount: -100000 }, priorityRules)).toEqual({
      category: 'Investments',
      kind: 'investment',
      ruleId: 'low',
    });
  });

  it('supports regex rules and ignores an invalid regex', () => {
    const rules: Rule[] = [
      { id: 're', pattern: '^SBINT:', isRegex: true, category: 'Salary', priority: 5 },
      { id: 'bad', pattern: '(', isRegex: true, category: 'Rent', priority: 1 },
    ];
    expect(categorise({ description: 'SBINT:01-04-2026 to 30-06-2026', amount: 1700 }, rules)).toEqual({
      category: 'Salary',
      kind: 'normal',
      ruleId: 're',
    });
    expect(categorise({ description: 'BROKER MUTUAL FUND', amount: -500000 }, rules).category).toBe(
      'Investments',
    );
  });

  it('classifies SBINT credits as interest', () => {
    expect(categorise({ description: 'SBINT:01-04-2026 to 30-06-2026', amount: 1700 }, [])).toEqual({
      category: 'Interest',
      kind: 'interest',
      ruleId: null,
    });
  });

  it('classifies investment debits', () => {
    expect(categorise({ description: 'BROKER MUTUAL FUND', amount: -500000 }, [])).toEqual({
      category: 'Investments',
      kind: 'investment',
      ruleId: null,
    });
    expect(categorise({ description: 'INDIAN CLEARING CORP', amount: -2200000 }, []).kind).toBe(
      'investment',
    );
  });

  it('classifies salary credits only', () => {
    expect(categorise({ description: 'ACME SALARY OCT', amount: 100000 }, [])).toEqual({
      category: 'Salary',
      kind: 'normal',
      ruleId: null,
    });
    expect(categorise({ description: 'ACME SALARY OCT', amount: -100000 }, []).category).toBe('Other');
  });

  it('uses the MCC category when nothing else matches', () => {
    expect(categorise({ description: 'UPIOUT/123/x@y/note/5812', amount: -100000 }, [])).toEqual({
      category: 'Food delivery',
      kind: 'normal',
      ruleId: null,
    });
    expect(categorise({ description: 'UPIOUT/123/x@y/note/4112', amount: -100000 }, [])).toEqual({
      category: 'Transport',
      kind: 'normal',
      ruleId: null,
    });
  });

  it("files SBI's Transfer to Family label under Family, whatever the casing or line breaks", () => {
    const description =
      'WDL TFR SBIY226182190300986286258/M/ Transfer to Family or 0062347039089 OF Mrs. SOMEONE AT 05094 MOTINAGAR, HYDERABAD';
    expect(categorise({ description, amount: -3_000_000 }, [])).toEqual({
      category: 'Family',
      kind: 'normal',
      ruleId: null,
    });
    expect(categorise({ description: description.toLowerCase(), amount: 3_000_000 }, []).category).toBe('Family');
  });

  it('lets a user rule override the built-in Family rule', () => {
    const rule: Rule = { id: 'r1', pattern: 'TRANSFER TO FAMILY', isRegex: false, category: 'Rent', priority: 1 };
    expect(categorise({ description: 'Transfer to Family or Friends', amount: -100 }, [rule]).category).toBe('Rent');
  });

  it('applies an excluded kind from a matching rule', () => {
    const rules: Rule[] = [
      { id: 'ex', pattern: 'REIMBURSE', isRegex: false, category: 'Shopping', kind: 'excluded', priority: 10 },
    ];
    expect(categorise({ description: 'AMAZON REIMBURSE WORK', amount: -100000 }, rules)).toEqual({
      category: 'Shopping',
      kind: 'excluded',
      ruleId: 'ex',
    });
  });

  it('treats MCC 0000 as no category and falls back to Other', () => {
    expect(categorise({ description: 'UPIOUT/123/x@y/note/0000', amount: -100000 }, [])).toEqual({
      category: 'Other',
      kind: 'normal',
      ruleId: null,
    });
  });
});

const base = { isRegex: false, category: 'Mutual funds', priority: 1 };

describe('ruleMatches', () => {
  const clearing: Rule = { id: 'r', pattern: 'INDIAN CLEARING', ...base, direction: 'debit' };
  const txn = (description: string, amount: number, accountId?: string) => ({ description, amount, accountId });

  it('matches a substring of the normalised narration, case-insensitively', () => {
    expect(ruleMatches(clearing, txn('ach d- indian  clearing corp 123', -100))).toBe(true);
    expect(ruleMatches(clearing, txn('SALARY', -100))).toBe(false);
  });

  it('matches when any of the words is present', () => {
    const rule: Rule = { id: 'r', pattern: 'ZERODHA', orPatterns: ['GROWW', 'KUVERA'], ...base };
    expect(ruleMatches(rule, txn('UPI/GROWW/x', -100))).toBe(true);
    expect(ruleMatches(rule, txn('UPI/KUVERA/x', -100))).toBe(true);
    expect(ruleMatches(rule, txn('UPI/SWIGGY/x', -100))).toBe(false);
  });

  it('ignores blank words instead of matching everything', () => {
    const rule: Rule = { id: 'r', pattern: '', orPatterns: ['  '], ...base, minAmount: 100 };
    expect(ruleMatches(rule, txn('ANYTHING', -50))).toBe(false);
    expect(ruleMatches(rule, txn('ANYTHING', -150))).toBe(true);
  });

  it('honours direction', () => {
    expect(ruleMatches(clearing, txn('INDIAN CLEARING', -100))).toBe(true);
    expect(ruleMatches(clearing, txn('INDIAN CLEARING', 100))).toBe(false);
    const credit: Rule = { ...clearing, direction: 'credit' };
    expect(ruleMatches(credit, txn('INDIAN CLEARING', 100))).toBe(true);
    expect(ruleMatches(credit, txn('INDIAN CLEARING', -100))).toBe(false);
  });

  it('honours the amount range on the absolute amount', () => {
    const rule: Rule = { id: 'r', pattern: 'RENT', ...base, minAmount: 1000, maxAmount: 5000 };
    expect(ruleMatches(rule, txn('RENT', -999))).toBe(false);
    expect(ruleMatches(rule, txn('RENT', -1000))).toBe(true);
    expect(ruleMatches(rule, txn('RENT', 5000))).toBe(true);
    expect(ruleMatches(rule, txn('RENT', -5001))).toBe(false);
  });

  it('honours the account, and fails when the row has none', () => {
    const rule: Rule = { id: 'r', pattern: 'RENT', ...base, accountId: 'sbi-1' };
    expect(ruleMatches(rule, txn('RENT', -1, 'sbi-1'))).toBe(true);
    expect(ruleMatches(rule, txn('RENT', -1, 'fed-2'))).toBe(false);
    expect(ruleMatches(rule, txn('RENT', -1))).toBe(false);
  });

  it('lets an exception word veto the rule', () => {
    const rule: Rule = { id: 'r', pattern: 'INDIAN CLEARING', ...base, exceptPatterns: ['REFUND'] };
    expect(ruleMatches(rule, txn('INDIAN CLEARING REFUND', 100))).toBe(false);
    expect(ruleMatches(rule, txn('INDIAN CLEARING', -100))).toBe(true);
  });

  it('applies regex to words and exceptions, and treats a bad regex as no match', () => {
    const rule: Rule = { id: 'r', pattern: '^UPI.*SWIGGY', ...base, isRegex: true, exceptPatterns: ['INSTAMART'] };
    expect(ruleMatches(rule, txn('UPI/1/SWIGGY/x', -1))).toBe(true);
    expect(ruleMatches(rule, txn('UPI/1/SWIGGY INSTAMART', -1))).toBe(false);
    expect(ruleMatches({ ...rule, pattern: '(' }, txn('UPI/1/SWIGGY', -1))).toBe(false);
  });

  it('never matches a rule with no conditions, or a disabled rule', () => {
    expect(ruleMatches({ id: 'r', pattern: '', ...base, direction: 'debit' }, txn('X', -1))).toBe(false);
    expect(ruleMatches({ ...clearing, enabled: false }, txn('INDIAN CLEARING', -1))).toBe(false);
  });
});

describe('categorise with extended rules', () => {
  it('files a debit under a custom category with the rule kind, and skips disabled rules', () => {
    const rule: Rule = {
      id: 'mf',
      pattern: 'INDIAN CLEARING',
      ...base,
      kind: 'investment',
      direction: 'debit',
    };
    const txn = { description: 'ACH D- INDIAN CLEARING CORP', amount: -500000 };
    expect(categorise(txn, [rule])).toEqual({ category: 'Mutual funds', kind: 'investment', ruleId: 'mf' });
    expect(categorise(txn, [{ ...rule, enabled: false }]).category).toBe('Investments');
    expect(categorise({ ...txn, amount: 500000 }, [rule]).category).toBe('Other');
  });

  it('passes the account through to the account condition', () => {
    const rule: Rule = { id: 'a', pattern: 'ACME HOMES', ...base, category: 'Rent', accountId: 'sbi-1' };
    expect(categorise({ description: 'ACME HOMES', amount: -1, accountId: 'sbi-1' }, [rule]).category).toBe('Rent');
    expect(categorise({ description: 'ACME HOMES', amount: -1, accountId: 'x' }, [rule]).category).toBe('Other');
  });
});

describe('previewRule', () => {
  const rule: Rule = {
    id: 'mf',
    pattern: 'INDIAN CLEARING',
    ...base,
    kind: 'investment',
    direction: 'debit',
    priority: 20,
  };
  const row = (id: string, over: Partial<RuleTargetTxn> = {}): RuleTargetTxn => ({
    id,
    description: 'ACH D- INDIAN CLEARING CORP',
    amount: -100000,
    category: 'Investments',
    categorySource: 'default',
    kind: 'investment',
    ...over,
  });

  it('lists the rows that would change and counts the rest', () => {
    const rows = [
      row('change'),
      row('done', { category: 'Mutual funds', categorySource: 'rule' }),
      row('kind', { category: 'Mutual funds', kind: 'normal' }),
      row('manual', { categorySource: 'manual' }),
      row('credit', { amount: 100000 }),
      row('other', { description: 'SALARY' }),
      row('transfer', { kind: 'transfer' }),
    ];
    const preview = previewRule(rows, rule, [rule]);
    expect(preview.changes.map((r) => r.id)).toEqual(['change', 'kind']);
    expect(preview).toMatchObject({ alreadyCorrect: 1, keptManual: 1, shadowed: 0 });
  });

  it('leaves kind alone when the rule sets none', () => {
    const noKind: Rule = { ...rule, kind: undefined };
    const preview = previewRule([row('a', { category: 'Mutual funds', kind: 'normal' })], noKind, [noKind]);
    expect(preview.changes).toEqual([]);
    expect(preview.alreadyCorrect).toBe(1);
  });

  it('skips rows that a higher-priority enabled rule also matches', () => {
    const above: Rule = { id: 'above', pattern: 'CLEARING', ...base, category: 'Other stuff', priority: 30 };
    const preview = previewRule([row('a')], rule, [rule, above]);
    expect(preview).toMatchObject({ changes: [], shadowed: 1 });
    const off = previewRule([row('a')], rule, [rule, { ...above, enabled: false }]);
    expect(off.changes).toHaveLength(1);
  });

  it('previews a disabled rule as if it were on', () => {
    expect(previewRule([row('a')], { ...rule, enabled: false }, []).changes).toHaveLength(1);
  });
});

describe('categorise by merchant name', () => {
  const sbiUpi = (payee: string, vpa: string): string => `WDL TFR UPI/DR/512345678901/${payee}/YESB/${vpa}/Pay`;
  const filed = (description: string, amount = -50000): string => categorise({ description, amount }).category;

  it('files SBI UPI debits, which carry no MCC, by the merchant name', () => {
    expect(filed(sbiUpi('Swiggy Lim', 'swiggy.stor'))).toBe('Food delivery');
    expect(filed(sbiUpi('BLINKIT', 'blinkit.pay'))).toBe('Groceries');
    expect(filed(sbiUpi('Amazon Ind', 'amazonupi'))).toBe('Shopping');
    expect(filed(sbiUpi('Bharti Air', 'airtel.pay'))).toBe('Utilities');
    expect(filed('ACH D- BESCOM ELECTRICITY 123456789012')).toBe('Utilities');
    expect(filed('POS PURCHASE INDIAN OIL BANGALORE')).toBe('Fuel');
    expect(filed('NEFT DR LIC OF INDIA PREMIUM')).toBe('Insurance');
    expect(filed('UPI/DR/512345678901/PharmEasy/HDFC/pharmeasy/Pay')).toBe('Medical');
  });

  it('prefers the more specific merchant', () => {
    expect(filed(sbiUpi('Swiggy Instamart', 'instamart'))).toBe('Groceries');
    expect(filed(sbiUpi('JIOMART', 'jiomart.pay'))).toBe('Groceries');
    expect(filed(sbiUpi('Reliance Jio', 'jio.recharge'))).toBe('Utilities');
  });

  it('only matches whole words, so a short name inside another word does not count', () => {
    expect(filed(sbiUpi('Coca Cola Store', 'colastore'))).toBe('Other');
    expect(filed(sbiUpi('Parent Hub', 'parenthub'))).toBe('Other');
    expect(filed(sbiUpi('OLA CABS', 'olacabs'))).toBe('Transport');
  });

  it('ignores a merchant name that is only the UPI handle of a person', () => {
    expect(filed('WDL TFR UPI/DR/512345678901/JANE DOE/AIRP/9876543210@airtel/Pay')).toBe('Other');
    expect(filed('UPI/DR/512345678901/JOHN ROE/JIOP/john@jio/Pay')).toBe('Other');
  });

  it('files broker debits as investments but leaves their credits alone', () => {
    expect(categorise({ description: sbiUpi('GROWW INVEST', 'groww.brk'), amount: -500000 })).toEqual({
      category: 'Investments',
      kind: 'investment',
      ruleId: null,
    });
    expect(filed('NEFT CR ZERODHA BROKING LTD PAYOUT', 500000)).toBe('Other');
  });

  it('lets the MCC win over the merchant name', () => {
    expect(filed('UPIOUT/123456789012/AMAZON FRESH/groceries/5411')).toBe('Groceries');
  });

  it('lets a user rule win over the merchant name', () => {
    const rules: Rule[] = [{ id: 'r', pattern: 'AMAZON', isRegex: false, category: 'Gifts', priority: 1 }];
    expect(categorise({ description: sbiUpi('Amazon Ind', 'amazonupi'), amount: -50000 }, rules).category).toBe('Gifts');
  });
});

describe('ruleMatches ignores separators, reference numbers and dates', () => {
  const rule = (pattern: string): Rule => ({ id: 'r', pattern, isRegex: false, category: 'Shopping', priority: 1 });
  const narration = 'WDL TFR UPI/DR/512345678901/ACME TOYS/YESB/acme.toys/661';

  it('matches a pattern written with spaces where the narration has slashes', () => {
    expect(ruleMatches(rule('WDL TFR UPI DR ACME TOYS YESB ACME.TOYS 661'), { description: narration, amount: -1 })).toBe(true);
    expect(ruleMatches(rule('ACME TOYS'), { description: narration, amount: -1 })).toBe(true);
  });

  it('matches the same payee with a different reference number or date', () => {
    const other = 'WDL TFR UPI/DR/598765432109/ACME TOYS/YESB/acme.toys/661';
    expect(ruleMatches(rule('WDL TFR UPI DR ACME TOYS YESB ACME.TOYS 661'), { description: other, amount: -1 })).toBe(true);
    expect(
      ruleMatches(rule('NACH DR ACME LOAN 05-07-2026'), { description: 'NACH DR/ACME LOAN/05-08-2026', amount: -1 }),
    ).toBe(true);
  });

  it('still needs the words themselves', () => {
    expect(ruleMatches(rule('ACME TOYSHOP'), { description: narration, amount: -1 })).toBe(false);
  });
});
