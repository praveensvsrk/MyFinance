import type { Rule, RuleDirection } from './categorise';

/** A rule as the editor holds it: plain lists and rupee-free paise, no id or priority yet. */
export interface RuleDraft {
  /** Set when editing an existing rule. */
  id?: string;
  name?: string;
  /** Narration words; the rule matches when any is present. */
  words: string[];
  isRegex: boolean;
  /** Narration words that stop the rule from matching. */
  exceptWords: string[];
  direction?: RuleDirection;
  /** Absolute paise bounds. */
  minAmount?: number;
  maxAmount?: number;
  accountId?: string;
  category: string;
  /** `normal` counts as spending; `investment` and `excluded` are left out of Spent and Saved. */
  kind: 'normal' | 'investment' | 'excluded';
}

/** Trims, drops blanks and drops case-insensitive repeats, keeping the first spelling. */
export function cleanWords(words: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const word of words) {
    const trimmed = word.trim();
    const key = trimmed.toUpperCase();
    if (trimmed === '' || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/** A message for the first problem with `draft`, or null when it can be saved. */
export function validateDraft(draft: RuleDraft): string | null {
  const words = cleanWords(draft.words);
  if (draft.category.trim() === '') return 'Choose or type a category.';
  if (words.length === 0 && draft.minAmount === undefined && draft.maxAmount === undefined && draft.accountId === undefined) {
    return 'Add at least one condition: a word, an amount or an account.';
  }
  if (draft.minAmount !== undefined && draft.maxAmount !== undefined && draft.minAmount > draft.maxAmount) {
    return 'The smallest amount is larger than the largest.';
  }
  if (draft.isRegex) {
    for (const word of [...words, ...cleanWords(draft.exceptWords)]) {
      try {
        new RegExp(word, 'i');
      } catch {
        return `“${word}” is not a valid pattern.`;
      }
    }
  }
  return null;
}

/**
 * The rule a draft describes, for saving and for previewing. Optional fields are left out rather
 * than set to `undefined`, so a stored rule carries only what it uses.
 */
export function ruleFromDraft(draft: RuleDraft, id: string, priority: number, enabled?: boolean): Rule {
  const words = cleanWords(draft.words);
  const except = cleanWords(draft.exceptWords);
  const name = draft.name?.trim();
  const rule: Rule = {
    id,
    pattern: words[0] ?? '',
    isRegex: draft.isRegex,
    category: draft.category.trim(),
    kind: draft.kind,
    priority,
  };
  if (name) rule.name = name;
  if (enabled === false) rule.enabled = false;
  if (words.length > 1) rule.orPatterns = words.slice(1);
  if (except.length > 0) rule.exceptPatterns = except;
  if (draft.direction !== undefined) rule.direction = draft.direction;
  if (draft.minAmount !== undefined) rule.minAmount = draft.minAmount;
  if (draft.maxAmount !== undefined) rule.maxAmount = draft.maxAmount;
  if (draft.accountId !== undefined) rule.accountId = draft.accountId;
  return rule;
}

/** The editor's view of a stored rule. */
export function draftFromRule(rule: Rule): RuleDraft {
  return {
    id: rule.id,
    name: rule.name,
    words: [rule.pattern, ...(rule.orPatterns ?? [])].filter((word) => word.trim() !== ''),
    isRegex: rule.isRegex,
    exceptWords: rule.exceptPatterns ?? [],
    direction: rule.direction,
    minAmount: rule.minAmount,
    maxAmount: rule.maxAmount,
    accountId: rule.accountId,
    category: rule.category,
    kind: rule.kind === 'investment' || rule.kind === 'excluded' ? rule.kind : 'normal',
  };
}

/** A one-line description of what a rule does, for the rules list. */
export function summariseRule(rule: Rule): string {
  const words = [rule.pattern, ...(rule.orPatterns ?? [])].filter((word) => word.trim() !== '');
  const parts: string[] = [];
  if (words.length > 0) parts.push(words.map((word) => `“${word}”`).join(' or '));
  if (rule.direction !== undefined) parts.push(rule.direction === 'debit' ? 'debits' : 'credits');
  if (rule.minAmount !== undefined || rule.maxAmount !== undefined) parts.push('amount range');
  if (rule.accountId !== undefined) parts.push('one account');
  const target =
    rule.kind === 'investment'
      ? `${rule.category} (investment)`
      : rule.kind === 'excluded'
        ? `${rule.category} (not spending)`
        : rule.category;
  return `${parts.join(' · ')} → ${target}`;
}
