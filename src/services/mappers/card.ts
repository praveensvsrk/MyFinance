import type { CardStatement } from '../../parsers/types';
import { categorise, normaliseDescription, type Rule } from '../../domain/categorise';
import type { AccountRow, FinanceDb, SnapshotRow, TxnRow } from '../../db/schema';
import { newId } from '../../db/repos';
import { fingerprint } from '../hash';
import type { Mapped } from '../importPipeline';

/**
 * Maps a credit card statement: upserts the card account, categorises the rows (charges are debits,
 * payments and refunds credits, so a bill paid from a bank pairs up as a transfer) and snapshots
 * what is owed at `periodTo` as a negative balance. Rows are fingerprinted by the bank's serial
 * number, since a card has no running balance to tell twin charges apart.
 */
export async function mapCard(db: FinanceDb, s: CardStatement): Promise<Mapped> {
  const accountId = `${s.institution.toLowerCase()}-card-${s.cardLast4}`;
  const rules = (await db.rules.toArray()).sort((a, b) => b.priority - a.priority) as Rule[];

  const accounts: AccountRow[] = [
    {
      id: accountId,
      kind: 'card',
      institution: s.institution,
      maskedNumber: s.cardLast4,
      name: `${s.institution} Credit Card`,
      meta: { source: s.source },
    },
  ];

  const transactions: TxnRow[] = [];
  for (const t of s.txns) {
    const categorised = categorise({ description: t.description, amount: t.amount, accountId }, rules);
    transactions.push({
      id: newId(),
      accountId,
      date: t.date,
      description: t.description,
      ref: t.ref,
      amount: t.amount,
      balanceAfter: t.balanceAfter,
      category: categorised.category,
      categorySource: categorised.ruleId ? 'rule' : 'default',
      kind: categorised.kind,
      transferPairId: null,
      importId: '',
      fingerprint: await fingerprint([accountId, t.date, t.amount, t.ref, normaliseDescription(t.description)]),
    });
  }

  const snapshots: SnapshotRow[] = [
    { accountId, date: s.periodTo, balance: -s.totalDue, source: 'statement', importId: '' },
  ];

  return {
    tables: { transactions, balanceSnapshots: snapshots },
    replace: [{ table: 'balanceSnapshots', where: { accountId, date: s.periodTo } }],
    accountsToUpsert: accounts,
    summary: {
      period: [s.periodFrom, s.periodTo],
      counts: { transactions: transactions.length, balanceSnapshots: 1 },
      duplicates: 0,
    },
  };
}
