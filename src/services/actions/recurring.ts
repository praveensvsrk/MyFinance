import type { FinanceDb } from '../../db/schema';
import { getSetting, setSetting } from '../../db/repos';
import { RECURRING_DISMISSED_KEY } from '../recurring';

/** Hides a payee from recurring payments ("not recurring"). */
export async function dismissRecurring(db: FinanceDb, payee: string): Promise<void> {
  const dismissed = await getSetting<string[]>(db, RECURRING_DISMISSED_KEY, []);
  if (!dismissed.includes(payee)) await setSetting(db, RECURRING_DISMISSED_KEY, [...dismissed, payee]);
}

/** Brings back every payee hidden from recurring payments. */
export async function restoreRecurring(db: FinanceDb): Promise<void> {
  await setSetting(db, RECURRING_DISMISSED_KEY, []);
}
