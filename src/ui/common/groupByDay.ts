import type { IsoDate } from '../../parsers/types';

export interface DayGroup<T> {
  date: IsoDate;
  items: T[];
}

/** Groups rows that share a date, keeping the order the rows came in (so newest-first stays so). */
export function groupByDay<T extends { date: IsoDate }>(rows: T[]): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last.date === row.date) last.items.push(row);
    else groups.push({ date: row.date, items: [row] });
  }
  return groups;
}
