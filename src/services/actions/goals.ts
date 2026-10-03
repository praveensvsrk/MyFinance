import type { IsoDate, Paise } from '../../parsers/types';
import type { FinanceDb, GoalRow } from '../../db/schema';
import { newId } from '../../db/repos';
import { goalMonthlyRequired } from '../../domain/projections';

export async function saveGoal(
  db: FinanceDb,
  goal: Omit<GoalRow, 'id'> & { id?: string },
): Promise<string> {
  const id = goal.id ?? newId();
  await db.goals.put({ ...goal, id });
  return id;
}

export async function deleteGoal(db: FinanceDb, id: string): Promise<void> {
  await db.goals.delete(id);
}

export async function listGoals(db: FinanceDb): Promise<GoalRow[]> {
  return (await db.goals.toArray()).sort((a, b) => (a.targetDate < b.targetDate ? -1 : 1));
}

/** Progress of a goal from the balances of its linked accounts. */
export function goalProgress(
  goal: GoalRow,
  balances: Record<string, Paise>,
  today: IsoDate,
): { current: Paise; pct: number; monthlyRequired: Paise } {
  const current = goal.linkedAccountIds.reduce((sum, id) => sum + (balances[id] ?? 0), 0);
  const pct = goal.targetPaise > 0 ? Math.min(100, Math.max(0, (current / goal.targetPaise) * 100)) : 0;
  return {
    current,
    pct,
    monthlyRequired: goalMonthlyRequired(goal.targetPaise, current, today, goal.targetDate),
  };
}
