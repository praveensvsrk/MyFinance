import { describe, expect, it } from 'vitest';
import {
  applyRuleToAll,
  categorise,
  DEFAULT_CATEGORIES,
  extractMcc,
  MCC_CATEGORIES,
  normaliseDescription,
  type Rule,
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

  it('treats MCC 0000 as no category and falls back to Other', () => {
    expect(categorise({ description: 'UPIOUT/123/x@y/note/0000', amount: -100000 }, [])).toEqual({
      category: 'Other',
      kind: 'normal',
      ruleId: null,
    });
  });
});

describe('applyRuleToAll', () => {
  const rule: Rule = { id: 'r1', pattern: 'BROKER', isRegex: false, category: 'Investments', priority: 1 };

  it('returns the ids of matching rows that are not manually categorised', () => {
    const txns = [
      { id: 'a', description: 'BROKER SIP', amount: -1, category: null, categorySource: null },
      { id: 'b', description: 'BROKER SIP', amount: -1, category: 'Groceries', categorySource: 'rule' as const },
      { id: 'c', description: 'BROKER SIP', amount: -1, category: 'Rent', categorySource: 'manual' as const },
      { id: 'd', description: 'SALARY OCT', amount: 1, category: null, categorySource: null },
    ];
    expect(applyRuleToAll(txns, rule)).toEqual(['a', 'b']);
  });
});
