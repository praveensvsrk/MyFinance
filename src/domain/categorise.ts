export type TxnKind = 'normal' | 'transfer' | 'investment' | 'interest' | 'excluded';

export type RuleDirection = 'debit' | 'credit';

/**
 * A categorisation rule. All conditions must hold: some word in `pattern` / `orPatterns` is in the
 * narration (when any word is given), no `exceptPatterns` word is, the direction, amount range
 * (absolute paise) and account fit. The highest-priority enabled rule that matches wins.
 */
export interface Rule {
  id: string;
  /** First word to look for; blank when the rule has no narration condition. */
  pattern: string;
  isRegex: boolean;
  category: string;
  kind?: TxnKind;
  priority: number;
  name?: string;
  /** Off when `false`; absent means on. */
  enabled?: boolean;
  /** More words; the rule matches when any of `pattern` and these is present. */
  orPatterns?: string[];
  /** Words that stop the rule from matching. */
  exceptPatterns?: string[];
  direction?: RuleDirection;
  minAmount?: number;
  maxAmount?: number;
  accountId?: string;
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
  'Family',
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
  accountId?: string;
}

export interface CategorisedTxn {
  category: string;
  kind: TxnKind;
  ruleId: string | null;
}

export interface RuleTargetTxn extends CategoriseTxn {
  id: string;
  category: string | null;
  categorySource?: 'rule' | 'manual' | 'default' | null;
  kind: TxnKind;
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

function wordMatches(word: string, isRegex: boolean, normalised: string): boolean {
  if (isRegex) {
    try {
      return new RegExp(word, 'i').test(normalised);
    } catch {
      return false;
    }
  }
  return normalised.includes(word.toUpperCase());
}

/** The non-blank words a rule looks for in a narration. */
export function ruleWords(rule: Pick<Rule, 'pattern' | 'orPatterns'>): string[] {
  return [rule.pattern, ...(rule.orPatterns ?? [])].filter((word) => word.trim() !== '');
}

/**
 * True when `txn` meets every condition of `rule`. A disabled rule, and a rule with no word, amount
 * bound or account (a direction alone is too broad), never match. An invalid regex is no match.
 */
export function ruleMatches(rule: Rule, txn: CategoriseTxn): boolean {
  if (rule.enabled === false) return false;
  const words = ruleWords(rule);
  const hasBound = rule.minAmount !== undefined || rule.maxAmount !== undefined;
  if (words.length === 0 && !hasBound && rule.accountId === undefined) return false;

  if (rule.direction === 'debit' && txn.amount >= 0) return false;
  if (rule.direction === 'credit' && txn.amount <= 0) return false;
  const size = Math.abs(txn.amount);
  if (rule.minAmount !== undefined && size < rule.minAmount) return false;
  if (rule.maxAmount !== undefined && size > rule.maxAmount) return false;
  if (rule.accountId !== undefined && txn.accountId !== rule.accountId) return false;

  const desc = normaliseDescription(txn.description);
  if (words.length > 0 && !words.some((word) => wordMatches(word, rule.isRegex, desc))) return false;
  const except = (rule.exceptPatterns ?? []).filter((word) => word.trim() !== '');
  return !except.some((word) => wordMatches(word, rule.isRegex, desc));
}

/**
 * Files a transaction: user rules by descending priority first, then the built-in rules
 * (SBI's "Transfer to Family" label, interest, investment debits, salary credits), then the MCC, then Other/normal.
 */
export function categorise(txn: CategoriseTxn, rules: Rule[] = []): CategorisedTxn {
  const desc = normaliseDescription(txn.description);
  const ordered = [...rules].sort((a, b) => b.priority - a.priority);
  for (const rule of ordered) {
    if (ruleMatches(rule, txn)) {
      return { category: rule.category, kind: rule.kind ?? 'normal', ruleId: rule.id };
    }
  }

  if (/TRANSFER TO FAMILY/i.test(desc)) {
    return { category: 'Family', kind: 'normal', ruleId: null };
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

export interface RulePreview<T extends RuleTargetTxn> {
  /** Rows the rule would re-file, in input order. */
  changes: T[];
  /** Matching rows that already have the rule's category (and kind, when it sets one). */
  alreadyCorrect: number;
  /** Matching rows left alone because the user categorised them by hand. */
  keptManual: number;
  /** Matching rows left alone because a higher-priority enabled rule also matches them. */
  shadowed: number;
}

/**
 * What applying `rule` to `txns` would do. Paired transfers are never touched, hand-categorised rows
 * are kept, and a row a higher-priority enabled rule in `rules` also matches is left to that rule.
 * The rule itself is previewed as if enabled.
 */
export function previewRule<T extends RuleTargetTxn>(txns: T[], rule: Rule, rules: Rule[]): RulePreview<T> {
  const active: Rule = { ...rule, enabled: true };
  const above = rules.filter((other) => other.id !== rule.id && other.priority > rule.priority);
  const preview: RulePreview<T> = { changes: [], alreadyCorrect: 0, keptManual: 0, shadowed: 0 };
  for (const txn of txns) {
    if (txn.kind === 'transfer' || !ruleMatches(active, txn)) continue;
    if (txn.categorySource === 'manual') preview.keptManual += 1;
    else if (above.some((other) => ruleMatches(other, txn))) preview.shadowed += 1;
    else if (txn.category === rule.category && (rule.kind === undefined || txn.kind === rule.kind)) {
      preview.alreadyCorrect += 1;
    } else preview.changes.push(txn);
  }
  return preview;
}

/**
 * The built-in categories, then the user's own (`custom`), then every other category a rule files
 * under, without repeats.
 */
export function categoryChoices(rules: Pick<Rule, 'category'>[], custom: string[] = []): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const category of [...DEFAULT_CATEGORIES, ...custom, ...rules.map((rule) => rule.category)]) {
    const name = category.trim();
    if (name === '' || seen.has(name.toUpperCase())) continue;
    seen.add(name.toUpperCase());
    out.push(name);
  }
  return out;
}
