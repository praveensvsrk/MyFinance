import '../styles/cashflow.css';

const PALETTE: Array<[string, string]> = [
  ['#FCE4E1', '#9A2A21'],
  ['#E6E9FB', '#2C3FA8'],
  ['#DFF1F0', '#0E6B66'],
  ['#E2F3EA', '#0B6B45'],
  ['#FDEFD9', '#8F5200'],
  ['#F3E6F8', '#7A3A9E'],
];

/** A tinted two-letter tile for a category; the colour is stable per name. */
export function CatTile({ name }: { name: string }) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const [bg, fg] = PALETTE[hash % PALETTE.length]!;
  const letters = name.replace(/[^A-Za-z0-9 ]/g, '').trim().split(/\s+/);
  const text = (letters.length > 1 ? letters[0]![0]! + letters[1]![0]! : (letters[0] ?? '?').slice(0, 2)).toUpperCase();
  return (
    <span className="cf-tile" aria-hidden="true" style={{ background: bg, color: fg }}>
      {text}
    </span>
  );
}
