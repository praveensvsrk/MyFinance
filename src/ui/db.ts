import { FinanceDb } from '../db/schema';

/** The one browser database. Tests build their own `FinanceDb` and hand it to `AppProvider`. */
export const db = new FinanceDb();
