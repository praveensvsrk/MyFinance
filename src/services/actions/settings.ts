import type { Paise } from '../../parsers/types';
import type { FinanceDb } from '../../db/schema';
import { getSetting, setSetting } from '../../db/repos';
import { saveSecret } from '../secrets';

export interface PlanDefaults {
  ppfRatePct: number;
  epfRatePct: number;
  retirementAge: number;
  epfMonthly?: Paise;
  ppfYearly?: Paise;
  /** Age today, to turn the retirement age into a retirement date. */
  currentAge?: number;
  /** First year of the FY the PPF account was opened in (2015 for FY 2015-16). */
  ppfOpeningFy?: number;
  loanRateOverridePct?: number;
  acmeOverrideUsdCents?: number;
  usdInrOverride?: number;
}

const BASE_PLAN_DEFAULTS: PlanDefaults = { ppfRatePct: 7.1, epfRatePct: 8.25, retirementAge: 58 };

export async function saveFinnhubKey(db: FinanceDb, key: string): Promise<void> {
  await saveSecret(db, 'finnhubKey', key.trim());
}

export async function savePlanDefaults(db: FinanceDb, defaults: PlanDefaults): Promise<void> {
  await setSetting(db, 'planDefaults', defaults);
}

export async function getPlanDefaults(db: FinanceDb): Promise<PlanDefaults> {
  const stored = await getSetting<Partial<PlanDefaults>>(db, 'planDefaults', {});
  return { ...BASE_PLAN_DEFAULTS, ...stored };
}
