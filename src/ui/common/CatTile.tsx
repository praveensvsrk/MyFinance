import '../styles/cashflow.css';
import { Icon, type IconName } from '../Icon';

const PALETTE: Array<[string, string]> = [
  ['#FCE4E1', '#9A2A21'],
  ['#E6E9FB', '#2C3FA8'],
  ['#DFF1F0', '#0E6B66'],
  ['#E2F3EA', '#0B6B45'],
  ['#FDEFD9', '#8F5200'],
  ['#F3E6F8', '#7A3A9E'],
  ['#EEF0ED', '#5B6661'],
];

/** Icon and palette entry for the built-in categories and the usual custom ones. */
const LOOKS: Record<string, [IconName, number]> = {
  Salary: ['wallet', 3],
  Rent: ['key', 4],
  Groceries: ['cart', 3],
  'Food delivery': ['bowl', 0],
  Utilities: ['bolt', 4],
  Fuel: ['fuel', 0],
  Shopping: ['bag', 5],
  Medical: ['medical', 0],
  Insurance: ['shield', 1],
  'Loan EMI': ['loan', 1],
  Investments: ['trend', 2],
  Interest: ['percent', 2],
  Transport: ['car', 1],
  Family: ['people', 5],
  Subscriptions: ['repeat', 5],
  'Bank charges': ['bank', 6],
  Tax: ['file', 4],
  Other: ['dots', 6],
  Uncategorized: ['dots', 6],
  Transfer: ['flow', 6],
  Travel: ['suitcase', 2],
  'Dining out': ['dining', 4],
  Gifts: ['gift', 0],
};

/** The icon drawn for a category, or null when it shows letters instead. */
export function categoryIcon(name: string): IconName | null {
  return LOOKS[name]?.[0] ?? null;
}

/**
 * A tinted tile for a category: its icon, or two letters for a category the user made. The colour
 * is fixed for the known categories and stable per name for the rest.
 */
export function CatTile({ name }: { name: string }) {
  const look = LOOKS[name];
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const [bg, fg] = PALETTE[look?.[1] ?? hash % (PALETTE.length - 1)]!;
  const letters = name.replace(/[^A-Za-z0-9 ]/g, '').trim().split(/\s+/);
  const text = (letters.length > 1 ? letters[0]![0]! + letters[1]![0]! : (letters[0] ?? '?').slice(0, 2)).toUpperCase();
  return (
    <span className="cf-tile" aria-hidden="true" style={{ background: bg, color: fg }}>
      {look === undefined ? text : <Icon name={look[0]} size={20} />}
    </span>
  );
}
