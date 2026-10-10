import type { TxnRow } from '../db/schema';
import { looseText } from './categorise';

const AMOUNT = /^₹?\s*(\d[\d,]*)(?:\.(\d{1,2}))?$/;

/** True when the transaction's size is the amount typed: whole rupees, or exact with paise. */
function amountMatches(amount: number, query: string): boolean {
  const match = AMOUNT.exec(query);
  if (match === null) return false;
  const rupees = Number(match[1]!.replace(/,/g, ''));
  const size = Math.abs(amount);
  if (match[2] === undefined) return Math.floor(size / 100) === rupees;
  return size === rupees * 100 + Number(match[2].padEnd(2, '0'));
}

/**
 * True when a search box query finds this transaction: every word is in the narration (as written
 * or with slashes and reference numbers taken out), the reference or the category, or the query is
 * the transaction's amount.
 */
export function matchesSearch(txn: TxnRow, query: string): boolean {
  const q = query.trim();
  if (q === '') return false;
  if (amountMatches(txn.amount, q)) return true;
  const haystack = [txn.description.toUpperCase(), looseText(txn.description), (txn.ref ?? '').toUpperCase(), (txn.category ?? '').toUpperCase()].join('\n');
  return q
    .toUpperCase()
    .split(/\s+/)
    .every((word) => haystack.includes(word));
}
