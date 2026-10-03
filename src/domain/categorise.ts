export type TxnKind = 'normal' | 'transfer' | 'investment' | 'interest';

export interface Rule {
  id: string;
  pattern: string;
  isRegex: boolean;
  category: string;
  kind?: TxnKind;
  priority: number;
}

/** Built-in categories a transaction can be filed under. */
export const DEFAULT_CATEGORIES: string[] = [
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
  'Other',
];

/** Merchant category codes found in UPI narrations; `0000` is person-to-person, so no category. */
export const MCC_CATEGORIES: Record<string, string | null> = {
  '5411': 'Groceries',
  '5812': 'Food delivery',
  '5814': 'Food delivery',
  '4900': 'Utilities',
  '4814': 'Utilities',
  '4112': 'Transport',
  '5541': 'Fuel',
  '5542': 'Fuel',
  '5912': 'Medical',
  '0000': null,
};

export interface CategoriseTxn {
  description: string;
  amount: number;
}

export interface CategorisedTxn {
  category: string;
  kind: TxnKind;
  ruleId: string | null;
}

export interface RuleTargetTxn {
  id: string;
  description: string;
  amount: number;
  category: string | null;
  categorySource?: 'rule' | 'manual' | 'default' | null;
}

/** Uppercases, collapses whitespace and strips SBI branch suffixes from a narration. */
export function normaliseDescription(desc: string): string {
  return desc
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/\s\d{13} AT \d{5}.*$/, '')
    .replace(/ [A-Z]+, [A-Z]+$/, '')
    .trim();
}

/** The trailing `/dddd` MCC of a `UPIOUT/` narration, or null when there is none. */
export function extractMcc(desc: string): string | null {
  const match = desc.match(/UPIOUT\/.*\/(\d{4})\s*$/i);
  return match ? match[1] : null;
}

function matchesRule(rule: Rule, normalised: string): boolean {
  if (rule.isRegex) {
    try {
      return new RegExp(rule.pattern, 'i').test(normalised);
    } catch {
      return false;
    }
  }
  return normalised.includes(rule.pattern.toUpperCase());
}

/**
 * Files a transaction: user rules by descending priority first, then the built-in kind rules
 * (interest, investment debits, salary credits), then the MCC, then Other/normal.
 */
export function categorise(txn: CategoriseTxn, rules: Rule[] = []): CategorisedTxn {
  const desc = normaliseDescription(txn.description);
  const ordered = [...rules].sort((a, b) => b.priority - a.priority);
  for (const rule of ordered) {
    if (matchesRule(rule, desc)) {
      return { category: rule.category, kind: rule.kind ?? 'normal', ruleId: rule.id };
    }
  }

  if (/SBINT:|:INT\.PD:|INT\.PD/i.test(desc)) {
    return { category: 'Interest', kind: 'interest', ruleId: null };
  }
  if (txn.amount < 0 && /INDIAN CLEARING|BSE STAR|MUTUAL FUND|PPF/i.test(desc)) {
    return { category: 'Investments', kind: 'investment', ruleId: null };
  }
  if (txn.amount > 0 && /SALARY/i.test(desc)) {
    return { category: 'Salary', kind: 'normal', ruleId: null };
  }

  const mcc = extractMcc(desc);
  if (mcc !== null) {
    const category = MCC_CATEGORIES[mcc];
    if (category) return { category, kind: 'normal', ruleId: null };
  }
  return { category: 'Other', kind: 'normal', ruleId: null };
}

/** IDs of the rows that `rule` matches and that are not manually categorised. */
export function applyRuleToAll(txns: RuleTargetTxn[], rule: Rule): string[] {
  return txns
    .filter(
      (txn) =>
        (txn.category === null || txn.categorySource !== 'manual') &&
        matchesRule(rule, normaliseDescription(txn.description)),
    )
    .map((txn) => txn.id);
}
