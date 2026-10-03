import type { IsoDate } from '../parsers/types';
import { daysBetween } from './dates';

export type AttentionKind =
  | 'stale-bank'
  | 'stale-epf'
  | 'stale-cas'
  | 'backup-overdue'
  | 'price-failed'
  | 'unverified-import'
  | 'stale-provisional'
  | 'storage-not-persisted'
  | 'etrade-mismatch';

export interface Attention {
  id: string;
  kind: AttentionKind;
  message: string;
  target: string;
}

/** Account kinds that can go stale; bank accounts use `bank` (the db stores them as `savings`). */
export type StatementKind = 'bank' | 'epf' | 'ppf' | 'mf' | 'loan' | 'equity' | 'cash';

export interface StatementFreshness {
  accountId: string;
  kind: StatementKind;
  name: string;
  date: IsoDate;
}

export interface AttentionState {
  today: IsoDate;
  lastStatementByAccount: StatementFreshness[];
  lastCasDate: IsoDate | null;
  lastBackupAt: IsoDate | null;
  priceFailures: string[];
  unverifiedImports: { id: string; source: string }[];
  staleProvisionals: number;
  storagePersisted: boolean;
  etradeMismatch?: { statement: number; xlsx: number };
}

/** Strictly-greater staleness thresholds, in days. */
export const STALE_BANK_DAYS = 35;
export const STALE_EPF_DAYS = 90;
export const STALE_CAS_DAYS = 35;
export const BACKUP_OVERDUE_DAYS = 30;

/** True when `date` is absent or more than `days` before `today`. */
function olderThan(date: IsoDate | null, today: IsoDate, days: number): boolean {
  return date === null || daysBetween(date, today) > days;
}

/**
 * Every condition that needs the user's attention, in a stable order.
 *
 * Targets are the three routes the app exposes: stale bank/EPF statements point at their account
 * page (`/accounts/<id>`), CAS/import issues point at `/import`, and backup/price/storage issues
 * point at the settings backup section (`/settings#backup`). A missing CAS or backup counts as
 * overdue. Thresholds are strictly greater than: bank/CAS > 35 days, EPF > 90 days, backup > 30.
 */
export function needsAttention(s: AttentionState): Attention[] {
  const items: Attention[] = [];
  const { today } = s;

  for (const statement of s.lastStatementByAccount) {
    const age = daysBetween(statement.date, today);
    if (statement.kind === 'bank' && age > STALE_BANK_DAYS) {
      items.push({
        id: `stale-bank:${statement.accountId}`,
        kind: 'stale-bank',
        message: `${statement.name}: statement is ${age} days old — import a fresh one`,
        target: `/accounts/${statement.accountId}`,
      });
    } else if (statement.kind === 'epf' && age > STALE_EPF_DAYS) {
      items.push({
        id: `stale-epf:${statement.accountId}`,
        kind: 'stale-epf',
        message: `${statement.name}: passbook is ${age} days old — import a fresh one`,
        target: `/accounts/${statement.accountId}`,
      });
    }
  }

  if (olderThan(s.lastCasDate, today, STALE_CAS_DAYS)) {
    items.push({
      id: 'stale-cas',
      kind: 'stale-cas',
      // A missing CAS is a missing statement; a null date cannot have a day count.
      message: s.lastCasDate === null ? 'No CAS statement imported yet — import one' : `CAS is ${daysBetween(s.lastCasDate, today)} days old — import a fresh one`,
      target: '/import',
    });
  }

  if (olderThan(s.lastBackupAt, today, BACKUP_OVERDUE_DAYS)) {
    items.push({
      id: 'backup-overdue',
      kind: 'backup-overdue',
      message: s.lastBackupAt === null ? 'No backup yet — back up your data' : `Last backup was ${daysBetween(s.lastBackupAt, today)} days ago — back up your data`,
      target: '/settings#backup',
    });
  }

  for (const symbol of new Set(s.priceFailures)) {
    items.push({
      id: `price-failed:${symbol}`,
      kind: 'price-failed',
      message: `Could not refresh the price for ${symbol}`,
      target: '/settings#backup',
    });
  }

  for (const imp of s.unverifiedImports) {
    items.push({
      id: `unverified-import:${imp.id}`,
      kind: 'unverified-import',
      message: `Import from ${imp.source} is unverified — review its validation checks`,
      target: '/import',
    });
  }

  if (s.staleProvisionals > 0) {
    const noun = s.staleProvisionals === 1 ? 'entry is' : 'entries are';
    items.push({
      id: 'stale-provisional',
      kind: 'stale-provisional',
      message: `${s.staleProvisionals} provisional MF ${noun} stale — confirm or reassign`,
      target: '/import',
    });
  }

  if (!s.storagePersisted) {
    items.push({
      id: 'storage-not-persisted',
      kind: 'storage-not-persisted',
      message: 'Storage is not persistent — the browser can clear your data',
      target: '/settings#backup',
    });
  }

  if (s.etradeMismatch !== undefined) {
    items.push({
      id: 'etrade-mismatch',
      kind: 'etrade-mismatch',
      message: `E*TRADE shows ${s.etradeMismatch.statement} shares, Benefit History shows ${s.etradeMismatch.xlsx} — download a fresh Benefit History`,
      target: '/accounts/equity',
    });
  }

  return items;
}
