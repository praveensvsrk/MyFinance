import type { FinanceDb } from '../../db/schema';
import { getSetting, setSetting } from '../../db/repos';
import { categorise, type Rule } from '../../domain/categorise';
import {
  cleanCategoryName,
  DEFAULT_CATEGORY_CONFIG,
  type CategoryConfig,
} from '../../domain/categories';

const CONFIG_KEY = 'categoryConfig';
const BACKFILL_KEY = 'familyBackfillDone';

export async function getCategoryConfig(db: FinanceDb): Promise<CategoryConfig> {
  const stored = await getSetting<Partial<CategoryConfig>>(db, CONFIG_KEY, {});
  return {
    custom: stored.custom ?? DEFAULT_CATEGORY_CONFIG.custom,
    excluded: stored.excluded ?? DEFAULT_CATEGORY_CONFIG.excluded,
  };
}

/**
 * Creates a category. Returns its stored name, or null when the name is empty or already used.
 * `excluded` leaves it out of income and spending.
 */
export async function addCategory(db: FinanceDb, name: string, excluded: boolean): Promise<string | null> {
  const config = await getCategoryConfig(db);
  const cleaned = cleanCategoryName(name, config);
  if (cleaned === null) return null;
  await setSetting(db, CONFIG_KEY, {
    custom: [...config.custom, cleaned],
    excluded: excluded ? [...config.excluded, cleaned] : config.excluded,
  });
  return cleaned;
}

/** Turns "not spending" on or off for any category; takes effect on all history at once. */
export async function setCategoryExcluded(db: FinanceDb, name: string, excluded: boolean): Promise<void> {
  const config = await getCategoryConfig(db);
  const rest = config.excluded.filter((entry) => entry !== name);
  await setSetting(db, CONFIG_KEY, { ...config, excluded: excluded ? [...rest, name] : rest });
}

/**
 * Deletes a custom category: its rules go, and every row filed under it falls back to the built-in
 * rules (usually Other). Built-in categories cannot be deleted.
 */
export async function deleteCategory(db: FinanceDb, name: string): Promise<void> {
  const config = await getCategoryConfig(db);
  if (!config.custom.includes(name)) return;
  await db.transaction('rw', db.transactions, db.rules, db.settings, async () => {
    await setSetting(db, CONFIG_KEY, {
      custom: config.custom.filter((entry) => entry !== name),
      excluded: config.excluded.filter((entry) => entry !== name),
    });
    const rules = await db.rules.toArray();
    await db.rules.bulkDelete(rules.filter((rule) => rule.category === name).map((rule) => rule.id));
    const remaining = rules.filter((rule) => rule.category !== name) as Rule[];
    for (const txn of await db.transactions.where('category').equals(name).toArray()) {
      const filed = categorise({ description: txn.description, amount: txn.amount }, remaining);
      await db.transactions.update(txn.id, {
        category: filed.category,
        kind: filed.kind,
        categorySource: filed.ruleId ? 'rule' : 'default',
      });
    }
  });
}

/**
 * One-off: files rows imported before the Family category existed. Only rows still on their
 * built-in default are touched; anything filed by a rule or by hand stays.
 */
export async function backfillFamily(db: FinanceDb): Promise<number> {
  if (await getSetting(db, BACKFILL_KEY, false)) return 0;
  let changed = 0;
  await db.transaction('rw', db.transactions, db.settings, async () => {
    const rows = await db.transactions.filter((txn) => /TRANSFER TO FAMILY/i.test(txn.description)).toArray();
    for (const txn of rows) {
      if (txn.categorySource === 'manual' || txn.categorySource === 'rule' || txn.kind === 'transfer') continue;
      if (txn.category === 'Family') continue;
      await db.transactions.update(txn.id, { category: 'Family', categorySource: 'default' });
      changed += 1;
    }
    await setSetting(db, BACKFILL_KEY, true);
  });
  return changed;
}
