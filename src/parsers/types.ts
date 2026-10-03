/** Integer paise (INR × 100). USD amounts are integer cents and use the same helpers. */
export type Paise = number;
/** ISO date string, YYYY-MM-DD. */
export type IsoDate = string;

export interface Check {
  name: string;
  expected: number | string;
  actual: number | string;
  ok: boolean;
}

export interface Validation {
  ok: boolean;
  checks: Check[];
  notes: string[];
}

// ---------- Bank savings: SBI, Federal, UBI (spec §5.7–5.9) ----------
export type BankSource = 'sbi' | 'federal' | 'ubi-savings';

export interface BankTxn {
  date: IsoDate;
  valueDate?: IsoDate;
  description: string;
  ref?: string;
  /** Signed: credit > 0, debit < 0. */
  amount: Paise;
  balanceAfter: Paise;
}

export interface BankStatement {
  source: BankSource;
  institution: 'SBI' | 'Federal' | 'UBI';
  accountLast4: string;
  ifsc: string;
  periodFrom: IsoDate;
  periodTo: IsoDate;
  openingBalance: Paise;
  closingBalance: Paise;
  txns: BankTxn[];
  /** SBI only: PPF balance from the page-1 Relationship Summary. */
  ppfBalance?: { date: IsoDate; balance: Paise };
  validation: Validation;
}

// ---------- UBI home loan (spec §5.10, §5.11) ----------
export type LoanRowKind = 'disbursement' | 'interest' | 'repayment' | 'charge';

export interface LoanRow {
  date: IsoDate;
  description: string;
  ref: string;
  kind: LoanRowKind;
  /** Always positive. Disbursement, interest and charge raise the outstanding; repayment lowers it. */
  amount: Paise;
  /** Outstanding after this row, recomputed from amounts (positive = owed). */
  outstandingAfter: Paise;
  /** Outstanding as printed by the bank (can be wrong, spec §5.10). Positive = owed. */
  printedOutstanding: Paise;
  interestFrom?: IsoDate;
  interestTo?: IsoDate;
}

export interface LoanStatement {
  source: 'ubi-loan';
  accountLast4: string;
  periodFrom: IsoDate;
  periodTo: IsoDate;
  /** Ascending by date. */
  rows: LoanRow[];
  openingOutstanding: Paise;
  closingOutstanding: Paise;
  validation: Validation;
}

export interface LoanCertificate {
  source: 'ubi-cert';
  accountLast4: string;
  fyStart: number;
  sanctioned: Paise;
  releaseDate: IsoDate;
  emi: Paise;
  closingDate: IsoDate;
  closingOutstanding: Paise;
  interestCharged: Paise;
  totalPaid: Paise;
  principalPaid: Paise;
  interestPaid: Paise;
  validation: Validation;
}

// ---------- EPFO passbook (spec §5.12) ----------
export interface EpfAmounts {
  ee: Paise;
  er: Paise;
  eps: Paise;
}

export type EpfRowKind = 'contribution' | 'transferIn' | 'withdrawal';

export interface EpfRow {
  /** YYYY-MM */
  wageMonth: string;
  creditDate: IsoDate;
  kind: EpfRowKind;
  particulars: string;
  epfWages: Paise;
  epsWages: Paise;
  /** Signed: DR rows are negative. */
  amounts: EpfAmounts;
  fromMemberId?: string;
}

export interface EpfPassbook {
  source: 'epf';
  memberId: string;
  establishmentId: string;
  establishmentName: string;
  fyStart: number;
  opening: EpfAmounts;
  rows: EpfRow[];
  /** null while the FY's interest is not yet credited ("Interest details N/A"). */
  interest: EpfAmounts | null;
  closing: EpfAmounts;
  totalContributions: EpfAmounts;
  validation: Validation;
}

// ---------- CAMS CAS (spec §5.5) ----------
export type CasTxnType =
  | 'purchase'
  | 'sip'
  | 'redemption'
  | 'switch_in'
  | 'switch_out'
  | 'dividend'
  | 'reversal';

export interface CasTxn {
  date: IsoDate;
  description: string;
  type: CasTxnType;
  /** Signed: money into the fund > 0, redemption < 0. Excludes stamp duty. */
  amount: Paise;
  /** ×1000, signed. */
  units: number;
  /** ×10^4 */
  nav: number;
  /** ×1000 */
  unitBalance: number;
  stampDuty: Paise;
  stt: Paise;
  tds: Paise;
}

export interface CasScheme {
  amc: string;
  folio: string;
  schemeCode: string;
  name: string;
  isin: string;
  registrar: 'CAMS' | 'KFINTECH';
  demat: boolean;
  openingUnits: number;
  closingUnits: number;
  nav: number;
  navDate: IsoDate;
  totalCost: Paise;
  marketValue: Paise;
  txns: CasTxn[];
}

export interface CasStatement {
  source: 'cas';
  periodFrom: IsoDate;
  periodTo: IsoDate;
  portfolio: { amc: string; cost: Paise; marketValue: Paise }[];
  /** The document's printed Total row; may differ from the sum of `portfolio` by a rounding paise. */
  total: { cost: Paise; marketValue: Paise };
  schemes: CasScheme[];
  validation: Validation;
}

// ---------- E*TRADE (spec §5.13) ----------
export interface EquityGrantRec {
  /** RSU: `RU…`; ESPP: the offering start date (ISO). */
  grantNumber: string;
  type: 'RSU' | 'ESPP';
  grantDate: IsoDate;
  totalShares: number;
  cancelledShares: number;
  vestedShares: number;
  unvestedShares: number;
  sellableShares: number;
}

export interface VestRec {
  grantNumber: string;
  period: number;
  vestDate: IsoDate;
  shares: number;
  cancelledShares: number;
  vestedShares: number;
  releasedShares: number;
  sellableShares: number;
  sharesWithheld: number;
  /** Taxable gain ÷ vested shares, rounded to a cent. null until vested. */
  fmvUsdCents: number | null;
  taxableGainUsdCents: number | null;
  taxRatePct: number | null;
  status: 'vested' | 'unvested' | 'cancelled';
}

export interface EsppPurchaseRec {
  offeringDate: IsoDate;
  purchaseDate: IsoDate;
  purchasePriceUsdCents: number;
  purchasedShares: number;
  sellableShares: number;
  grantDateFmvUsdCents: number;
  purchaseDateFmvUsdCents: number;
  discountPct: number | null;
}

export interface LotRec {
  /** `${grantNumber}#${period}` for RSU, `ESPP#${purchaseDate}` for ESPP. */
  key: string;
  source: 'RSU' | 'ESPP';
  acquiredDate: IsoDate;
  netShares: number;
  remainingShares: number;
  costPerShareUsdCents: number;
  /** Exact cost of the remaining shares (avoids per-share rounding drift). */
  remainingCostUsdCents: number;
}

export interface SaleEventRec {
  date: IsoDate;
  plan: 'RSU' | 'ESPP';
  grantNumber?: string;
  shares?: number;
}

export interface BenefitHistory {
  source: 'etrade-xlsx';
  symbol: 'ACME';
  grants: EquityGrantRec[];
  vests: VestRec[];
  esppPurchases: EsppPurchaseRec[];
  lots: LotRec[];
  sales: SaleEventRec[];
  validation: Validation;
}

export interface EtradeStatement {
  source: 'etrade-stmt';
  periodFrom: IsoDate;
  periodTo: IsoDate;
  symbol: 'ACME';
  quantity: number;
  priceUsdCents: number;
  totalCostUsdCents: number;
  marketValueUsdCents: number;
  unvested: { grantDate: IsoDate; grantNumber: string; quantity: number }[];
  validation: Validation;
}

export type ParsedFile =
  | BankStatement
  | LoanStatement
  | LoanCertificate
  | EpfPassbook
  | CasStatement
  | BenefitHistory
  | EtradeStatement;

export type SourceId = ParsedFile['source'];
