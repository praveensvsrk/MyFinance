import type { IsoDate, Paise } from '../parsers/types';
import { normaliseDescription } from './categorise';
import { addDays, daysBetween } from './dates';
import { schemeValue } from './mf';

export interface SipLink {
  id: string;
  schemeKey: string;
  narrationPattern: string;
  grossPaise: Paise;
  dayOfMonth: number;
  accountId: string;
  source: 'learned' | 'user';
}

export interface Provisional {
  id: string;
  bankTxnId: string;
  schemeKey: string | 'unassigned';
  date: IsoDate;
  grossPaise: Paise;
  estUnits: number;
  navDate: IsoDate | null;
  status: 'provisional' | 'confirmed' | 'stale';
  confirmedByMfTxnId?: string;
}

/** A CAS purchase/SIP; `gross` = amount + stamp duty. */
export interface CasBuy {
  schemeKey: string;
  date: IsoDate;
  gross: Paise;
}

/** A bank row; `amount` is signed, so a debit is negative. */
export interface BankDebit {
  id: string;
  accountId: string;
  date: IsoDate;
  amount: Paise;
  description: string;
}

/** A CAS transaction to confirm a provisional with (gross = amount + stamp duty). */
export interface CasMatch {
  id: string;
  schemeKey: string;
  date: IsoDate;
  gross: Paise;
}

/** Stamp duty on MF purchases: 0.005% of the gross. */
export const STAMP_DUTY_RATE = 0.00005;

const AMOUNT_TOLERANCE = 0.001; // ±0.1%
const LEARN_MAX_DAYS_BEFORE = 5;
const MATCH_MAX_DAY_DISTANCE = 4;
const CONFIRM_MAX_DAYS_AFTER = 7;
const STALE_AFTER_DAYS = 45;
const STALE_COVERAGE_DAYS = 7;

function dayOfMonth(date: IsoDate): number {
  return +date.slice(8, 10);
}

function withinPct(actual: number, target: number, fraction: number): boolean {
  return Math.abs(actual - target) <= Math.abs(target) * fraction;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Normalised narration with every digit run of 6+ replaced by `\d+`. */
export function narrationPatternOf(description: string): string {
  return escapeRegex(normaliseDescription(description)).replace(/\d{6,}/g, '\\d+');
}

function patternMatches(pattern: string, text: string): boolean {
  try {
    return new RegExp(pattern).test(text);
  } catch {
    return false;
  }
}

/**
 * Units (×1000) bought by `gross` (paise) once stamp duty is deducted, at `nav` (×10⁴).
 * `estimateUnits(g, n)` = round((g − round(g × 0.00005)) / (n/10⁴) / 100 × 1000) = round((g − duty) × 10⁵ / n).
 */
export function estimateUnits(gross: Paise, nav: number): number {
  const stampDuty = Math.round(gross * STAMP_DUTY_RATE);
  return Math.round(((gross - stampDuty) * 100_000) / nav);
}

/**
 * Learns/refreshes SIP links from CAS buys matched to bank debits dated 0–5 days
 * before the allotment, within ±0.1% of the gross. Never touches `user` links.
 * Returns only the new or refreshed learned links.
 */
export function learnLinks(casBuys: CasBuy[], bankDebits: BankDebit[], existing: SipLink[]): SipLink[] {
  const learned: SipLink[] = [];
  for (const buy of casBuys) {
    const candidate = bankDebits
      .map((debit) => ({ debit, gap: daysBetween(debit.date, buy.date) }))
      .filter(
        ({ debit, gap }) =>
          gap >= 0 && gap <= LEARN_MAX_DAYS_BEFORE && withinPct(Math.abs(debit.amount), buy.gross, AMOUNT_TOLERANCE),
      )
      .sort(
        (a, b) =>
          a.gap - b.gap ||
          (a.debit.date < b.debit.date ? -1 : a.debit.date > b.debit.date ? 1 : 0) ||
          (a.debit.id < b.debit.id ? -1 : a.debit.id > b.debit.id ? 1 : 0),
      )[0]?.debit;
    if (!candidate) continue;

    const pattern = narrationPatternOf(candidate.description);
    const alreadyUser = existing.some(
      (l) =>
        l.source === 'user' &&
        l.schemeKey === buy.schemeKey &&
        l.accountId === candidate.accountId &&
        l.narrationPattern === pattern,
    );
    if (alreadyUser) continue;

    const previous = existing.find(
      (l) =>
        l.source === 'learned' &&
        l.schemeKey === buy.schemeKey &&
        l.accountId === candidate.accountId &&
        l.narrationPattern === pattern,
    );
    learned.push({
      id: previous?.id ?? `learned:${candidate.accountId}:${buy.schemeKey}:${pattern}`,
      schemeKey: buy.schemeKey,
      narrationPattern: pattern,
      grossPaise: buy.gross,
      dayOfMonth: dayOfMonth(candidate.date),
      accountId: candidate.accountId,
      source: 'learned',
    });
  }
  return learned;
}

/**
 * Matches a bank debit to a SIP link: amount ±0.1%, narration pattern, day of month
 * ±4, and the debit must be after that scheme's last CAS date. Ties go to the
 * smallest day-of-month distance; a remaining tie across schemes is ambiguous.
 */
export function matchLink(
  debit: BankDebit,
  links: SipLink[],
  lastCasDateByScheme: Record<string, IsoDate>,
): { schemeKey: string } | { ambiguous: string[] } | null {
  const description = normaliseDescription(debit.description);
  const day = dayOfMonth(debit.date);
  const candidates: { link: SipLink; distance: number }[] = [];
  for (const link of links) {
    if (!withinPct(Math.abs(debit.amount), link.grossPaise, AMOUNT_TOLERANCE)) continue;
    if (!patternMatches(link.narrationPattern, description)) continue;
    const distance = Math.abs(day - link.dayOfMonth);
    if (distance > MATCH_MAX_DAY_DISTANCE) continue;
    const lastCas: IsoDate | undefined = lastCasDateByScheme[link.schemeKey];
    if (lastCas !== undefined && debit.date <= lastCas) continue;
    candidates.push({ link, distance });
  }
  if (candidates.length === 0) return null;

  const closest = Math.min(...candidates.map((c) => c.distance));
  const schemes = [...new Set(candidates.filter((c) => c.distance === closest).map((c) => c.link.schemeKey))].sort();
  return schemes.length === 1 ? { schemeKey: schemes[0] } : { ambiguous: schemes };
}

/** Confirms provisionals matched to CAS txns of the same scheme, ±0.1% gross, 0–7 days after the debit. */
export function confirm(provisionals: Provisional[], casTxns: CasMatch[]): Provisional[] {
  return provisionals.map((p): Provisional => {
    if (p.status === 'confirmed') return p;
    const match = casTxns.find((t) => {
      if (t.schemeKey !== p.schemeKey) return false;
      if (!withinPct(t.gross, p.grossPaise, AMOUNT_TOLERANCE)) return false;
      const gap = daysBetween(p.date, t.date);
      return gap >= 0 && gap <= CONFIRM_MAX_DAYS_AFTER;
    });
    return match ? { ...p, status: 'confirmed', confirmedByMfTxnId: match.id } : p;
  });
}

/**
 * Marks provisionals stale once a CAS covers their date + 7 days, or 45 days
 * have passed since the debit. Confirmed provisionals are left alone.
 */
export function markStale(
  provisionals: Provisional[],
  casCoverageToByScheme: Record<string, IsoDate>,
  today: IsoDate,
): Provisional[] {
  return provisionals.map((p): Provisional => {
    if (p.status === 'confirmed') return p;
    const coverage: IsoDate | undefined = casCoverageToByScheme[p.schemeKey];
    const casCovered = coverage !== undefined && coverage >= addDays(p.date, STALE_COVERAGE_DAYS);
    const tooOld = today >= addDays(p.date, STALE_AFTER_DAYS);
    return casCovered || tooOld ? { ...p, status: 'stale' } : p;
  });
}

/**
 * MF value: confirmed units at the latest NAV, plus every non-confirmed
 * provisional (stale still counts, unassigned counts at gross).
 */
export function mfValueAt(
  confirmedUnitsByScheme: Record<string, number>,
  navByScheme: Record<string, number>,
  provisionals: Provisional[],
): { value: Paise; provisionalValue: Paise; provisionalCount: number } {
  let value = 0;
  for (const scheme of Object.keys(confirmedUnitsByScheme)) {
    const nav: number | undefined = navByScheme[scheme];
    if (nav !== undefined) value += schemeValue(confirmedUnitsByScheme[scheme], nav);
  }

  let provisionalValue = 0;
  let provisionalCount = 0;
  for (const p of provisionals) {
    if (p.status === 'confirmed') continue;
    provisionalCount++;
    if (p.schemeKey === 'unassigned') {
      provisionalValue += p.grossPaise;
      continue;
    }
    const nav: number | undefined = navByScheme[p.schemeKey];
    // Until a NAV is stored, an assigned provisional is conservatively valued at cost.
    provisionalValue += nav === undefined ? p.grossPaise : schemeValue(p.estUnits, nav);
  }
  return { value: value + provisionalValue, provisionalValue, provisionalCount };
}
