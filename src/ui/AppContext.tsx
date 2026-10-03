import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { FinanceDb } from '../db/schema';
import { getSetting, setSetting } from '../db/repos';
import { todayIso } from '../domain/dates';
import type { IsoDate } from '../parsers/types';
import { db as appDb } from './db';

const HIDE_AMOUNTS_KEY = 'hideAmounts';

export interface AppContextValue {
  db: FinanceDb;
  today: IsoDate;
  /** Privacy toggle (§6.7): every amount renders as `••••` while on. */
  hideAmounts: boolean;
  setHideAmounts: (hidden: boolean) => void;
  /** Bumped after an import, restore or undo so non-live data can reload. */
  refresh: () => void;
  version: number;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({
  db = appDb,
  today,
  children,
}: {
  db?: FinanceDb;
  today?: IsoDate;
  children: ReactNode;
}) {
  const [hideAmounts, setHide] = useState(false);
  const [version, setVersion] = useState(0);
  const touched = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getSetting(db, HIDE_AMOUNTS_KEY, false)
      .then((stored) => {
        if (!cancelled && !touched.current) setHide(stored);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [db]);

  const setHideAmounts = useCallback(
    (hidden: boolean) => {
      touched.current = true;
      setHide(hidden);
      setSetting(db, HIDE_AMOUNTS_KEY, hidden).catch(() => undefined);
    },
    [db],
  );
  const refresh = useCallback(() => setVersion((current) => current + 1), []);

  const value = useMemo<AppContextValue>(
    () => ({ db, today: today ?? todayIso(), hideAmounts, setHideAmounts, refresh, version }),
    [db, today, hideAmounts, setHideAmounts, refresh, version],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (value === null) throw new Error('useApp must be used inside <AppProvider>');
  return value;
}
