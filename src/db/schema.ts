import Dexie, { type Table } from 'dexie';
import type { TxnKind, Rule } from '../domain/categorise';
import type { EpfEntry } from '../domain/epf';
import type { Provisional, SipLink } from '../domain/mfProvisional';
import type { CasTxnType, IsoDate, Paise, SourceId } from '../parsers/types';

/** IndexedDB schema version; bump together with a `version(n)` block in `FinanceDb`. */
export const SCHEMA_VERSION = 1;

/**
 * The Dexie stores spec. `&` marks a unique index and `[a+b]` a compound
 * index; the first entry is the primary key (`++` = auto-increment).
 */
export const TABLE_STORES = {
  accounts: 'id, kind, institution',
  transactions:
    'id, accountId, date, [accountId+date], importId, &fingerprint, category, kind, transferPairId',
  balanceSnapshots: '[accountId+date], accountId, importId',
  epfEntries: '++id, accountId, [accountId+fy], importId',
  loanYears: '[accountId+fy], importId',
  loanEntries: 'id, accountId, date, importId, &fingerprint',
  mfFolios: 'id, isin, &[folio+isin]',
  mfTxns: 'id, folioId, date, importId, &fingerprint',
  mfProvisional: 'id, bankTxnId, schemeKey, status',
  mfSipLinks: 'id, schemeKey',
  equityGrants: 'id',
  vests: 'id, grantId',
  equityLots: 'id',
  prices: '[symbol+date], symbol',
  rules: 'id, priority',
  imports: 'id, &fileHash, source, importedAt',
  goals: 'id',
  settings: 'key',
} satisfies Record<string, string>;

/** Every table name in `FinanceDb`. */
export type TableName = keyof typeof TABLE_STORES;

// ---------- accounts ----------

export type AccountKind = 'savings' | 'card' | 'ppf' | 'epf' | 'loan' | 'cash' | 'mf' | 'equity' | 'property';

export interface AccountRow {
  id: string;
  kind: AccountKind;
  institution: string;
  maskedNumber: string;
  name: string;
  meta: Record<string, unknown>;
}

// ---------- transactions ----------

/** How a transaction's category was chosen: by a rule, by hand, or by the built-in defaults. */
export type CategorySource = 'rule' | 'manual' | 'default' | null;

export interface TxnRow {
  id: string;
  accountId: string;
  date: IsoDate;
  description: string;
  ref: string;
  /** Signed paise: credit > 0, debit < 0. */
  amount: Paise;
  balanceAfter: Paise;
  category: string | null;
  categorySource: CategorySource;
  kind: TxnKind;
  transferPairId: string | null;
  importId: string;
  fingerprint: string;
}

// ---------- balance snapshots ----------

export type SnapshotSource = 'statement' | 'manual' | 'derived';

export interface SnapshotRow {
  accountId: string;
  date: IsoDate;
  balance: Paise;
  source: SnapshotSource;
  importId: string | null;
}

// ---------- EPF ----------

export interface EpfEntryRow extends EpfEntry {
  /** Auto-increment primary key, assigned by Dexie on insert. */
  id?: number;
  importId: string;
}

// ---------- loans ----------

export interface LoanYearRow {
  accountId: string;
  fy: number;
  interestCharged: Paise;
  principalRepaid: Paise;
  totalPaid: Paise;
  closingOutstanding: Paise;
  importId: string;
}

export type LoanEntryKind = 'disbursement' | 'emi' | 'prepayment' | 'interest' | 'charge';

export interface LoanEntryRow {
  id: string;
  accountId: string;
  date: IsoDate;
  description: string;
  ref: string;
  kind: LoanEntryKind;
  /** Always positive; `kind` carries the direction (disbursement raises the loan). */
  amount: Paise;
  principalPart?: Paise;
  interestPart?: Paise;
  /** Positive = owed, after this row. */
  outstandingAfter: Paise;
  interestFrom?: IsoDate;
  interestTo?: IsoDate;
  importId: string;
  fingerprint: string;
}

// ---------- mutual funds ----------

export type MfHoldingMode = 'soa' | 'demat';

export interface MfFolioRow {
  id: string;
  folio: string;
  amc: string;
  scheme: string;
  isin: string;
  /** AMFI scheme code; resolved by the price refresh when the CAS does not carry it. */
  amfiCode?: number | null;
  holdingMode: MfHoldingMode;
  /** Units ×1000, integer. */
  units: number;
  asOf: IsoDate;
  historyComplete: boolean;
}

export interface MfTxnRow {
  id: string;
  folioId: string;
  date: IsoDate;
  description: string;
  type: CasTxnType;
  /** Signed paise, excluding stamp duty. */
  amount: Paise;
  /** Units ×1000, signed. */
  units: number;
  /** NAV ×10⁴. */
  nav: number;
  stampDuty: Paise;
  importId: string;
  fingerprint: string;
}

export type MfProvisionalRow = Provisional;

export type MfSipLinkRow = SipLink;

// ---------- equity ----------

export type EquitySource = 'RSU' | 'ESPP';

export interface EquityGrantRow {
  id: string;
  grantNumber: string;
  type: EquitySource;
  grantDate: IsoDate;
  totalShares: number;
  cancelledShares: number;
  vestedShares?: number;
  unvestedShares?: number;
  sellableShares?: number;
}

export type VestStatus = 'vested' | 'unvested' | 'cancelled';

export interface VestRow {
  id: string;
  grantId: string;
  period: number;
  vestDate: IsoDate;
  shares: number;
  status: VestStatus;
  /** Denormalised from the grant so the row can be consumed as a parser `VestRec`. */
  grantNumber?: string;
  cancelledShares?: number;
  vestedShares?: number;
  releasedShares?: number;
  sellableShares?: number;
  sharesWithheld?: number;
  fmvUsdCents?: number | null;
  taxableGainUsdCents?: number | null;
  taxRatePct?: number | null;
}

export interface EquityLotRow {
  id: string;
  vestId: string | null;
  esppPurchaseId: string | null;
  /** Lot key from the Benefit History (`${grantNumber}#${period}` or `ESPP#${purchaseDate}`). */
  key: string;
  acquiredDate: IsoDate;
  netShares: number;
  remainingShares: number;
  costPerShareUsdCents: number;
  remainingCostUsdCents: number;
  /** USDINR rate ×10⁴ on the acquire date; backfilled by the price service when null. */
  usdInrOnAcquire: number | null;
  source: EquitySource;
}

// ---------- prices, rules, imports, goals, settings ----------

export type PriceSource = 'api' | 'statement';

export interface PriceRow {
  /** `ACME` in USD cents, `USDINR` ×10⁴, `MF:<amfiCode>` NAV ×10⁴. */
  symbol: string;
  date: IsoDate;
  value: number;
  source: PriceSource;
}

export type RuleRow = Rule;

/**
 * What an import changed beyond rows tagged with its `importId`, so an undo can put it back: the
 * rows its `replace` step deleted and the primary keys it inserted into tables without an
 * `importId` index (folios, equity, prices, settings).
 */
export interface ImportUndo {
  replaced: Partial<Record<TableName, unknown[]>>;
  inserted: Partial<Record<TableName, unknown[]>>;
}

export interface ImportRow {
  id: string;
  fileHash: string;
  source: SourceId;
  periodFrom: IsoDate;
  periodTo: IsoDate;
  importedAt: IsoDate;
  counts: Record<string, number>;
  verified: boolean;
  notes: string[];
  undo?: ImportUndo;
}

export interface GoalRow {
  id: string;
  name: string;
  targetPaise: Paise;
  targetDate: IsoDate;
  linkedAccountIds: string[];
}

export interface SettingRow {
  key: string;
  value: unknown;
}

/** The app database. Version history lives in the constructor. */
export class FinanceDb extends Dexie {
  accounts!: Table<AccountRow, string>;
  transactions!: Table<TxnRow, string>;
  balanceSnapshots!: Table<SnapshotRow, [string, string]>;
  epfEntries!: Table<EpfEntryRow, number>;
  loanYears!: Table<LoanYearRow, [string, number]>;
  loanEntries!: Table<LoanEntryRow, string>;
  mfFolios!: Table<MfFolioRow, string>;
  mfTxns!: Table<MfTxnRow, string>;
  mfProvisional!: Table<MfProvisionalRow, string>;
  mfSipLinks!: Table<MfSipLinkRow, string>;
  equityGrants!: Table<EquityGrantRow, string>;
  vests!: Table<VestRow, string>;
  equityLots!: Table<EquityLotRow, string>;
  prices!: Table<PriceRow, [string, string]>;
  rules!: Table<RuleRow, string>;
  imports!: Table<ImportRow, string>;
  goals!: Table<GoalRow, string>;
  settings!: Table<SettingRow, string>;

  constructor(name = 'myfinance') {
    super(name);
    this.version(SCHEMA_VERSION).stores(TABLE_STORES);
  }
}
