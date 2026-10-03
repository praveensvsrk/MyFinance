import type { EpfPassbook } from '../../parsers/types';
import { linkTransfers, passbookToEntries, type EpfAccountLink, type EpfEntry } from '../../domain/epf';
import { fyEndDate, todayIso } from '../../domain/dates';
import type { AccountRow, EpfEntryRow, FinanceDb, SnapshotRow } from '../../db/schema';
import type { Mapped } from '../importPipeline';

/** Account id from the last five characters of the EPF member id (spec §5.12). */
function epfAccountId(memberId: string): string {
  return `epf-${memberId.slice(-5)}`;
}

function memberIdOf(account: AccountRow): string {
  return typeof account.meta.memberId === 'string' ? account.meta.memberId : '';
}

/**
 * Maps an EPFO passbook: upserts the account, builds its entries (opening, rows, interest),
 * replaces the stored rows of the imported FY, links transferIns across every EPF account with
 * synthetic `transferOut`/inferred-interest entries, and snapshots EE + ER of the closing balance
 * at min(today, FY end).
 */
export async function mapEpf(db: FinanceDb, p: EpfPassbook): Promise<Mapped> {
  const accountId = epfAccountId(p.memberId);
  const account: AccountRow = {
    id: accountId,
    kind: 'epf',
    institution: 'EPFO',
    maskedNumber: p.memberId.slice(-5),
    name: p.establishmentName || 'EPF',
    meta: { memberId: p.memberId, establishmentName: p.establishmentName },
  };

  const entries = passbookToEntries(accountId, p);
  const snapshotDate = todayIso() < fyEndDate(p.fyStart) ? todayIso() : fyEndDate(p.fyStart);
  const snapshots: SnapshotRow[] = [
    {
      accountId,
      date: snapshotDate,
      balance: p.closing.ee + p.closing.er,
      source: 'statement',
      importId: '',
    },
  ];

  // Link over every EPF account, with the rows this import replaces excluded from the stored set.
  const storedAccounts = await db.accounts.where('kind').equals('epf').toArray();
  const links: EpfAccountLink[] = storedAccounts.map((stored) => ({
    accountId: stored.id,
    memberId: memberIdOf(stored),
  }));
  if (!links.some((link) => link.accountId === accountId)) {
    links.push({ accountId, memberId: p.memberId });
  }

  const storedEntries: EpfEntryRow[] = await db.epfEntries.toArray();
  const kept = storedEntries.filter((entry) => !(entry.accountId === accountId && entry.fy === p.fyStart));
  const working: EpfEntry[] = [...kept, ...entries];
  const synthetic = linkTransfers(links, working);
  const allEntries: EpfEntry[] = [...entries, ...synthetic];

  return {
    tables: { epfEntries: allEntries, balanceSnapshots: snapshots },
    replace: [
      { table: 'epfEntries', where: { accountId, fy: p.fyStart } },
      { table: 'balanceSnapshots', where: { accountId, date: snapshotDate } },
    ],
    accountsToUpsert: [account],
    summary: {
      period: [`${p.fyStart}-04-01`, fyEndDate(p.fyStart)],
      counts: { epfEntries: allEntries.length, balanceSnapshots: 1 },
      duplicates: 0,
    },
  };
}
