import { SAMPLE_DATA_SETTING } from '../../config';
import { setSetting } from '../../db/repos';
import type { FinanceDb } from '../../db/schema';
import { todayIso } from '../../domain/dates';

/** Wipes every table. Sample data and real imports both go through this. */
export async function clearAllData(db: FinanceDb): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
  });
}

/**
 * Loads the screenshot demo person into the app database and marks it as sample data so the UI
 * can offer to clear it. Wipes whatever was already stored.
 */
export async function loadSampleData(db: FinanceDb): Promise<void> {
  const { seedDemo } = await import('../../demo/seed');
  await seedDemo(db);
  await setSetting(db, SAMPLE_DATA_SETTING, true);
  await setSetting(db, 'lastBackupAt', todayIso());
}
