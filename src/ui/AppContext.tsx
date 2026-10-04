import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AmountUnit } from '../domain/money';
import type { FinanceDb } from '../db/schema';
import { getSetting, setSetting } from '../db/repos';
import { todayIso } from '../domain/dates';
import type { IsoDate } from '../parsers/types';
import { db as appDb } from './db';

const HIDE_AMOUNTS_KEY = 'hideAmounts';
const THEME_KEY = 'theme';
const AMOUNT_UNIT_KEY = 'amountUnit';

export type ThemeChoice = 'system' | 'light' | 'dark';
const THEMES: ThemeChoice[] = ['system', 'light', 'dark'];
const UNITS: AmountUnit[] = ['default', 'thousands', 'lakhs', 'rupees'];

/** Sets `data-theme` on <html> (system removes it so the media query decides) and the browser chrome colour. */
function applyTheme(theme: ThemeChoice): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  meta?.setAttribute('content', dark ? '#0a0e0c' : '#f3f4f1');
}

export interface AppContextValue {
  db: FinanceDb;
  today: IsoDate;
  /** Privacy toggle (§6.7): every amount renders as `••••` while on. */
  hideAmounts: boolean;
  setHideAmounts: (hidden: boolean) => void;
  /** Light, dark or follow the system. */
  theme: ThemeChoice;
  setTheme: (theme: ThemeChoice) => void;
  /** How the Accounts screen scales amounts. */
  amountUnit: AmountUnit;
  setAmountUnit: (unit: AmountUnit) => void;
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
  const [theme, setThemeState] = useState<ThemeChoice>('system');
  const [amountUnit, setUnitState] = useState<AmountUnit>('default');
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

  useEffect(() => {
    let cancelled = false;
    getSetting<unknown>(db, THEME_KEY, 'system')
      .then((stored) => {
        if (!cancelled && THEMES.includes(stored as ThemeChoice)) setThemeState(stored as ThemeChoice);
      })
      .catch(() => undefined);
    getSetting<unknown>(db, AMOUNT_UNIT_KEY, 'default')
      .then((stored) => {
        if (!cancelled && UNITS.includes(stored as AmountUnit)) setUnitState(stored as AmountUnit);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [db]);

  useEffect(() => applyTheme(theme), [theme]);

  const setTheme = useCallback(
    (next: ThemeChoice) => {
      setThemeState(next);
      setSetting(db, THEME_KEY, next).catch(() => undefined);
    },
    [db],
  );
  const setAmountUnit = useCallback(
    (next: AmountUnit) => {
      setUnitState(next);
      setSetting(db, AMOUNT_UNIT_KEY, next).catch(() => undefined);
    },
    [db],
  );

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
    () => ({ db, today: today ?? todayIso(), hideAmounts, setHideAmounts, theme, setTheme, amountUnit, setAmountUnit, refresh, version }),
    [db, today, hideAmounts, setHideAmounts, theme, setTheme, amountUnit, setAmountUnit, refresh, version],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (value === null) throw new Error('useApp must be used inside <AppProvider>');
  return value;
}
