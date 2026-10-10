import type { FinanceDb } from '../db/schema';
import { daysBetween } from '../domain/dates';
import { classifyLoanCredit } from '../domain/loanRates';

/** How far a bank debit may sit from the loan statement's EMI row and still be that EMI. */
const WINDOW_DAYS = 10;

/**
 * Files bank debits that pay a loan EMI as Loan EMI: a debit still on Other by default, within 1%
 * of an EMI on a loan statement and within ten days of it. The narration rarely says EMI (an ACH
 * mandate names the lender's bank), so the loan statement is what tells. Returns how many changed.
 */
export async function fileLoanEmis(db: FinanceDb): Promise<number> {
  const emis = await db.loanEntries.filter((entry) => entry.kind === 'emi').toArray();
  if (emis.length === 0) return 0;
  const rows = await db.transactions
    .filter(
      (txn) =>
        txn.amount < 0 &&
        txn.kind === 'normal' &&
        (txn.category === null || txn.category === 'Other') &&
        txn.categorySource !== 'manual' &&
        txn.categorySource !== 'rule',
    )
    .toArray();
  let changed = 0;
  for (const txn of rows) {
    const paysEmi = emis.some(
      (entry) =>
        Math.abs(daysBetween(entry.date, txn.date)) <= WINDOW_DAYS &&
        classifyLoanCredit(-txn.amount, entry.amount) === 'emi',
    );
    if (!paysEmi) continue;
    await db.transactions.update(txn.id, { category: 'Loan EMI', categorySource: 'default' });
    changed += 1;
  }
  return changed;
}
