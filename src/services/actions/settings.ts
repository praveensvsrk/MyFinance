import type { SourceId } from '../../parsers';
import type { Paise } from '../../parsers/types';
import type { FinanceDb } from '../../db/schema';
import { getSetting, setSetting } from '../../db/repos';

export interface PlanDefaults {
  ppfRatePct: number;
  epfRatePct: number;
  retirementAge: number;
  epfMonthly?: Paise;
  ppfYearly?: Paise;
  loanRateOverridePct?: number;
  acmeOverrideUsdCents?: number;
  usdInrOverride?: number;
}

const BASE_PLAN_DEFAULTS: PlanDefaults = { ppfRatePct: 7.1, epfRatePct: 8.25, retirementAge: 58 };

export async function savePassword(db: FinanceDb, source: SourceId, password: string): Promise<void> {
  const passwords = await getSetting<Record<string, string>>(db, 'passwords', {});
  await setSetting(db, 'passwords', { ...passwords, [source]: password });
}

export async function clearPassword(db: FinanceDb, source: SourceId): Promise<void> {
  const passwords = { ...(await getSetting<Record<string, string>>(db, 'passwords', {})) };
  delete passwords[source];
  await setSetting(db, 'passwords', passwords);
}

export async function saveFinnhubKey(db: FinanceDb, key: string): Promise<void> {
  await setSetting(db, 'finnhubKey', key.trim());
}

export async function savePlanDefaults(db: FinanceDb, defaults: PlanDefaults): Promise<void> {
  await setSetting(db, 'planDefaults', defaults);
}

export async function getPlanDefaults(db: FinanceDb): Promise<PlanDefaults> {
  const stored = await getSetting<Partial<PlanDefaults>>(db, 'planDefaults', {});
  return { ...BASE_PLAN_DEFAULTS, ...stored };
}
