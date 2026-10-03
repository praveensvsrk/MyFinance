import type { BankStatement } from '../../parsers/types';
import { categorise, normaliseDescription, type Rule } from '../../domain/categorise';
import { matchLink } from '../../domain/mfProvisional';
import type { AccountRow, FinanceDb, SnapshotRow, TxnRow } from '../../db/schema';
import { newId } from '../../db/repos';
import { fingerprint } from '../hash';
import type { Mapped } from '../importPipeline';

/**
 * Maps an SBI/Federal/UBI savings statement: upserts the account, categorises the rows, fingerprints
 * them for dedupe, snapshots the closing balance at `periodTo` and (SBI) the PPF balance. Investment
 * debits that match more than one SIP link are surfaced as `ambiguous` for the UI to resolve.
 */
export async function mapBank(db: FinanceDb, s: BankStatement): Promise<Mapped> {
  const accountId = `${s.institution.toLowerCase()}-${s.accountLast4}`;
  const rules = (await db.rules.toArray()).sort((a, b) => b.priority - a.priority) as Rule[];
  const links = await db.mfSipLinks.toArray();
  const lastCasDateByScheme: Record<string, string> = {};
  for (const folio of await db.mfFolios.toArray()) lastCasDateByScheme[folio.id] = folio.asOf;

  const accounts: AccountRow[] = [
    {
      id: accountId,
      kind: 'savings',
      institution: s.institution,
      maskedNumber: s.accountLast4,
      name: `${s.institution} Savings`,
      meta: { ifsc: s.ifsc, source: s.source },
    },
  ];

  const transactions: TxnRow[] = [];
  for (const t of s.txns) {
    const categorised = categorise({ description: t.description, amount: t.amount }, rules);
    transactions.push({
      id: newId(),
      accountId,
      date: t.date,
      description: t.description,
      ref: t.ref ?? '',
      amount: t.amount,
      balanceAfter: t.balanceAfter,
      category: categorised.category,
      categorySource: categorised.ruleId ? 'rule' : 'default',
      kind: categorised.kind,
      transferPairId: null,
      importId: '',
      fingerprint: await fingerprint([
        accountId,
        t.date,
        t.amount,
        t.balanceAfter,
        normaliseDescription(t.description),
      ]),
    });
  }

  const snapshots: SnapshotRow[] = [
    { accountId, date: s.periodTo, balance: s.closingBalance, source: 'statement', importId: '' },
  ];
  const replace: NonNullable<Mapped['replace']> = [
    { table: 'balanceSnapshots', where: { accountId, date: s.periodTo } },
  ];
  const counts: Record<string, number> = { transactions: transactions.length, balanceSnapshots: 1 };

  const ambiguous: NonNullable<Mapped['ambiguous']> = [];
  for (const txn of transactions) {
    if (txn.kind !== 'investment' || txn.amount >= 0) continue;
    const match = matchLink(
      { id: txn.id, accountId, date: txn.date, amount: txn.amount, description: txn.description },
      links,
      lastCasDateByScheme,
    );
    if (match !== null && 'ambiguous' in match) {
      ambiguous.push({ bankTxnId: txn.id, candidates: match.ambiguous });
    }
  }

  if (s.ppfBalance) {
    accounts.push({
      id: 'sbi-ppf',
      kind: 'ppf',
      institution: s.institution,
      maskedNumber: 'PPF',
      name: 'SBI PPF',
      meta: { source: s.source },
    });
    snapshots.push({
      accountId: 'sbi-ppf',
      date: s.ppfBalance.date,
      balance: s.ppfBalance.balance,
      source: 'statement',
      importId: '',
    });
    replace.push({ table: 'balanceSnapshots', where: { accountId: 'sbi-ppf', date: s.ppfBalance.date } });
    counts.balanceSnapshots += 1;
  }

  return {
    tables: { transactions, balanceSnapshots: snapshots },
    replace,
    accountsToUpsert: accounts,
    ambiguous,
    summary: { period: [s.periodFrom, s.periodTo], counts, duplicates: 0 },
  };
}
