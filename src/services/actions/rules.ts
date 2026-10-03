import type { FinanceDb, RuleRow } from '../../db/schema';
import { newId } from '../../db/repos';
import { applyRuleToAll, normaliseDescription } from '../../domain/categorise';

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
    const ids = applyRuleToAll(all, rule).filter((id) => id !== txnId);
    for (const id of ids) await db.transactions.update(id, { category, categorySource: 'rule' });
    return { changed: ids.length, ruleId: rule.id };
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
