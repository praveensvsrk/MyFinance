import type { FinanceDb, RuleRow, TxnRow } from '../../db/schema';
import { newId } from '../../db/repos';
import { normaliseDescription, previewRule, type Rule } from '../../domain/categorise';
import { allCategories } from '../../domain/categories';
import { ruleFromDraft, validateDraft, type RuleDraft } from '../../domain/ruleDraft';
import { addProvisionals } from '../importPipeline';
import { getCategoryConfig, setCategoryConfig } from './categories';

const MIN_PATTERN_LENGTH = 4;
const PRIORITY_STEP = 10;

/**
 * The substring a re-categorise rule matches on. A UPI narration keys on its payee segment
 * (`UPIOUT/<ref>/SWIGGY/<note>/<MCC>` gives `SWIGGY`); anything else loses its long digit runs and
 * trailing MCC. Returns null when too little is left to be a safe rule.
 */
export function rulePatternFor(description: string): string | null {
  const text = normaliseDescription(description);
  const upi = text.match(/^UPI(?:OUT| IN)?\/\d+\/([^/]+)/);
  const cleaned = upi
    ? upi[1].trim()
    : text
        .replace(/\/\d{4}$/, '')
        .replace(/\d{6,}/g, ' ')
        .replace(/[/\s]+/g, ' ')
        .trim();
  return cleaned.length >= MIN_PATTERN_LENGTH ? cleaned : null;
}

/**
 * Files a transaction under `category` by hand. With `applyToAll`, also saves a rule from the
 * narration and re-files every other row it matches, except rows the user categorised by hand.
 */
export async function recategorise(
  db: FinanceDb,
  txnId: string,
  category: string,
  opts: { applyToAll: boolean },
): Promise<{ changed: number; ruleId: string | null }> {
  return db.transaction('rw', db.transactions, db.rules, async () => {
    const txn = await db.transactions.get(txnId);
    if (txn === undefined) throw new Error(`transaction ${txnId} not found`);
    await db.transactions.update(txnId, { category, categorySource: 'manual' });
    if (!opts.applyToAll) return { changed: 1, ruleId: null };

    const pattern = rulePatternFor(txn.description);
    if (pattern === null) return { changed: 0, ruleId: null };
    const existing = await db.rules.toArray();
    const rule: RuleRow = {
      id: newId(),
      pattern,
      isRegex: false,
      category,
      priority: existing.reduce((max, row) => Math.max(max, row.priority), 0) + PRIORITY_STEP,
    };
    await db.rules.add(rule);
    const all = await db.transactions.toArray();
    const { changes } = previewRule(all, rule, await db.rules.toArray());
    for (const row of changes) await db.transactions.update(row.id, { category, categorySource: 'rule' });
    return { changed: changes.length, ruleId: rule.id };
  });
}

/**
 * Re-files every row `rule` would change (see `previewRule`) and keeps MF provisionals in step with
 * the kind change: a row that becomes an investment debit gets one, a row that stops being an
 * investment loses its unconfirmed one. Call inside a `rw` transaction over all tables.
 */
async function applyRule(db: FinanceDb, rule: Rule): Promise<number> {
  const { changes } = previewRule(await db.transactions.toArray(), rule, await db.rules.toArray());
  const gained: TxnRow[] = [];
  const lost: string[] = [];
  for (const row of changes) {
    const kind = rule.kind ?? row.kind;
    await db.transactions.update(row.id, { category: rule.category, categorySource: 'rule', kind });
    if (kind === 'investment' && row.kind !== 'investment' && row.amount < 0) gained.push({ ...row, kind });
    if (kind !== 'investment' && row.kind === 'investment') lost.push(row.id);
  }
  if (lost.length > 0) {
    const stale = await db.mfProvisional.where('bankTxnId').anyOf(lost).toArray();
    await db.mfProvisional.bulkDelete(stale.filter((row) => row.status !== 'confirmed').map((row) => row.id));
  }
  await addProvisionals(db, gained);
  return changes.length;
}

/**
 * Creates a rule (on top of the others) or updates one in place, keeping its priority and on/off
 * state. With `applyToExisting`, also re-files the transactions it matches. Throws a readable
 * message for a draft `validateDraft` rejects. `categoryExcluded` also turns the category's "not
 * spending" flag on or off (it applies to everything filed there, not only this rule's rows).
 */
export async function saveRule(
  db: FinanceDb,
  draft: RuleDraft,
  opts: { applyToExisting: boolean; categoryExcluded?: boolean },
): Promise<{ ruleId: string; changed: number }> {
  const problem = validateDraft(draft);
  if (problem !== null) throw new Error(problem);
  return db.transaction('rw', db.tables, async () => {
    // A category the rule names is a real category: it joins the user's own list (so Settings can
    // flag or delete it) and is spelt the way it already exists, whatever case was typed.
    const config = await getCategoryConfig(db);
    const typed = draft.category.trim();
    const known = allCategories(config).find((name) => name.toLowerCase() === typed.toLowerCase());
    const category = known ?? typed;
    let { custom, excluded } = config;
    if (known === undefined) custom = [...custom, category];
    if (opts.categoryExcluded !== undefined) {
      excluded = excluded.filter((name) => name !== category);
      if (opts.categoryExcluded) excluded = [...excluded, category];
    }
    if (custom !== config.custom || excluded !== config.excluded) await setCategoryConfig(db, { custom, excluded });
    draft = { ...draft, category };
    const existing = draft.id === undefined ? undefined : await db.rules.get(draft.id);
    const priority =
      existing?.priority ??
      (await db.rules.toArray()).reduce((max, row) => Math.max(max, row.priority), 0) + PRIORITY_STEP;
    const rule = ruleFromDraft(draft, existing?.id ?? newId(), priority, existing?.enabled);
    await db.rules.put(rule);
    const changed = opts.applyToExisting && rule.enabled !== false ? await applyRule(db, rule) : 0;
    return { ruleId: rule.id, changed };
  });
}

/** Turns a rule off or on. Existing transactions keep the category they have. */
export async function setRuleEnabled(db: FinanceDb, id: string, enabled: boolean): Promise<void> {
  await db.rules.update(id, { enabled });
}

/** Swaps a rule's priority with its neighbour in the list; a no-op at either end. */
export async function moveRule(db: FinanceDb, id: string, direction: 'up' | 'down'): Promise<void> {
  await db.transaction('rw', db.rules, async () => {
    const ordered = (await db.rules.toArray()).sort((a, b) => b.priority - a.priority);
    const index = ordered.findIndex((row) => row.id === id);
    const other = ordered[direction === 'up' ? index - 1 : index + 1];
    if (index < 0 || other === undefined) return;
    await db.rules.update(id, { priority: other.priority });
    await db.rules.update(other.id, { priority: ordered[index].priority });
  });
}

/** Rules, highest priority first. */
export async function listRules(db: FinanceDb): Promise<RuleRow[]> {
  return (await db.rules.toArray()).sort((a, b) => b.priority - a.priority);
}

/** Deletes a rule; rows it already filed keep their category. */
export async function deleteRule(db: FinanceDb, id: string): Promise<void> {
  await db.rules.delete(id);
}
