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

/**
 * Bump when the built-in filing changes (a merchant added, say), so rows still on a built-in
 * default are filed again once (see `refileDefaults`).
 */
export const CATEGORISER_VERSION = 2;

interface MerchantGroup {
  category: string;
  kind?: TxnKind;
  /** Only debits count, such as money sent to a broker (its payouts are not investments). */
  debitOnly?: boolean;
  /** Regex fragments, matched as whole words in the normalised narration. */
  names: string[];
}

/**
 * Well-known Indian merchants, for narrations without an MCC (SBI's `UPI/DR/<ref>/<payee>/...`,
 * card and ACH rows). Checked in order, so a more specific name comes before a broader one
 * (Swiggy Instamart is groceries, Swiggy is food delivery). Payment gateways such as Paytm or PayU
 * are left out: the merchant behind them could be anything.
 */
const MERCHANTS: MerchantGroup[] = [
  {
    category: 'Groceries',
    names: [
      'INSTAMART', 'BLINKIT', 'GROFERS', 'ZEPTO', 'BIG ?BASKET', 'BBNOW', 'DMART', 'AVENUE SUPERMARTS',
      'JIOMART', 'RATNADEEP', 'MORE RETAIL', 'SPENCERS', 'NATURES BASKET', 'FRESHTOHOME', 'LICIOUS',
      'COUNTRY DELIGHT', 'MILKBASKET',
    ],
  },
  { category: 'Food delivery', names: ['SWIGGY', 'ZOMATO', 'EATSURE'] },
  {
    category: 'Transport',
    names: [
      'UBER', 'OLA', 'OLACABS', 'ANI TECHNOLOGIES', 'RAPIDO', 'NAMMA METRO', 'BMRCL', 'DMRC', 'HMRL',
      'METRO RAIL', 'IRCTC', 'FASTAG', 'REDBUS', 'YULU',
    ],
  },
  {
    category: 'Fuel',
    names: ['INDIAN OIL', 'IOCL', 'HPCL', 'HINDUSTAN PETROLEUM', 'BPCL', 'BHARAT PETROLEUM', 'SHELL', 'PETROL', 'FILLING STATION'],
  },
  {
    category: 'Utilities',
    names: [
      'AIRTEL', 'JIO', 'VODAFONE', 'BSNL', 'ACT FIBERNET', 'HATHWAY', 'TATA ?PLAY', 'TATA ?SKY', 'BESCOM',
      'TSSPDCL', 'TGSPDCL', 'APSPDCL', 'MSEDCL', 'TANGEDCO', 'BSES', 'TATA POWER', 'ADANI ELECTRICITY',
      'ELECTRICITY', 'INDANE', 'HP GAS', 'BHARAT ?GAS', 'MAHANAGAR GAS', 'BWSSB', 'WATER BOARD', 'BROADBAND',
    ],
  },
  {
    category: 'Medical',
    names: [
      'PHARMEASY', 'NETMEDS', '1MG', 'MEDPLUS', 'APOLLO PHARMACY', 'APOLLO HOSPITALS?', 'APOLLO 24', 'PRACTO',
      'PHARMACY', 'CHEMISTS?', 'HOSPITALS?', 'CLINIC', 'DIAGNOSTICS?',
    ],
  },
  {
    category: 'Insurance',
    names: [
      'INSURANCE', 'LIC', 'LICI', 'POLICYBAZAAR', 'ACKO', 'HDFC ERGO', 'ICICI LOMBARD', 'STAR HEALTH',
      'NIVA BUPA', 'CARE HEALTH', 'BAJAJ ALLIANZ', 'TATA AIG',
    ],
  },
  {
    category: 'Investments',
    kind: 'investment',
    debitOnly: true,
    names: ['ZERODHA', 'GROWW', 'UPSTOX', 'KUVERA', 'PAYTM MONEY', 'SMALLCASE', 'INDMONEY', 'ET MONEY', 'KFINTECH'],
  },
  {
    category: 'Shopping',
    names: [
      'AMAZON', 'FLIPKART', 'MYNTRA', 'AJIO', 'NYKAA', 'MEESHO', 'CROMA', 'RELIANCE DIGITAL', 'RELIANCE TRENDS',
      'RELIANCE RETAIL', 'DECATHLON', 'IKEA', 'TATA CLIQ', 'LIFESTYLE', 'WESTSIDE', 'ZUDIO', 'LENSKART', 'FIRSTCRY',
    ],
  },
  { category: 'Rent', debitOnly: true, names: ['RENT', 'HOUSE RENT', 'NOBROKER'] },
];

/**
 * Each group's names as one regex. A name must not sit inside a longer word (OLA in COLA) or be
 * the bank part of a person's UPI handle (`name@airtel`).
 */
const MERCHANT_PATTERNS = MERCHANTS.map((group) => ({
  ...group,
  re: new RegExp(`(?<![A-Z0-9@])(?:${group.names.join('|')})(?![A-Z])`),
}));

/** The built-in merchant group a normalised narration names, or null. */
function merchantFor(desc: string, amount: number): CategorisedTxn | null {
  for (const group of MERCHANT_PATTERNS) {
    if (group.debitOnly && amount >= 0) continue;
    if (group.re.test(desc)) return { category: group.category, kind: group.kind ?? 'normal', ruleId: null };
  }
  return null;
}

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

const DATE = /\d{1,2}[-./]\d{1,2}[-./]\d{2,4}/g;
const LONG_NUMBER = /\d{6,}/;

/**
 * A narration with the parts that differ between payments to the same payee taken out: dates and
 * reference numbers (six digits or more), and slashes and runs of spaces collapsed to one space.
 */
export function looseText(text: string): string {
  return text
    .toUpperCase()
    .replace(DATE, ' ')
    .replace(/\d{6,}/g, ' ')
    .replace(/[/\s]+/g, ' ')
    .trim();
}

/**
 * True when a rule word is in the narration: as typed, or compared loosely (see `looseText`), so
 * `ACME TOYS` finds `.../ACME TOYS/...` and a word saved with a reference number stripped still
 * finds its payee. A word that names a long number must match it as typed.
 */
function wordMatches(word: string, isRegex: boolean, normalised: string): boolean {
  if (isRegex) {
    try {
      return new RegExp(word, 'i').test(normalised);
    } catch {
      return false;
    }
  }
  const upper = word.toUpperCase();
  if (normalised.includes(upper)) return true;
  if (LONG_NUMBER.test(upper)) return false;
  const loose = looseText(upper);
  return loose.length >= 3 && looseText(normalised).includes(loose);
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
 * (SBI's "Transfer to Family" label, interest, investment debits, salary credits), then the MCC, then
 * well-known merchant names, then Other/normal.
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
  return merchantFor(desc, txn.amount) ?? { category: 'Other', kind: 'normal', ruleId: null };
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
