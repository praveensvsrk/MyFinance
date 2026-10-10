import type { TxnRow } from '../../db/schema';
import { normaliseDescription } from '../../domain/categorise';
import { rulePatternFor } from '../../services/actions/rules';
import { Money } from '../Money';
import { CatTile } from './CatTile';

/** A short merchant-style name for a bank narration. */
export function merchantOf(description: string): string {
  return rulePatternFor(description) ?? normaliseDescription(description).slice(0, 32);
}

/**
 * The payee as a person reads it: `NETFLIXUPI` gives `Netflix`, `SWIGGY LIMITED` gives
 * `Swiggy Limited`. Two-letter words (`AI`) and words with digits stay as they are, and a UPI
 * handle with no name in it is shown in lower case.
 */
export function payeeLabel(description: string): string {
  const merchant = merchantOf(description).replace(/^M\/S\.? ?/, '');
  if (merchant.includes('@')) return merchant.toLowerCase();
  return merchant
    .split(' ')
    .map((word) => {
      if (/\d/.test(word) || word.replace(/[^A-Z]/g, '').length <= 2) return word;
      const name = word.length > 6 ? word.replace(/UPI$/, '') : word;
      return name.charAt(0) + name.slice(1).toLowerCase();
    })
    .join(' ');
}

/** What a muted row is: a custom category is named alongside the kind. */
function mutedLabel(txn: TxnRow): string {
  if (txn.kind === 'transfer') return 'Transfer';
  const category = txn.category;
  return category === null || category === 'Investments' || category === 'Other' ? 'Investment' : `${category} · Investment`;
}

/**
 * One transaction row: the payee, its category (and account, in a list that mixes accounts) and
 * the amount. The bank's narration is left to the details. Transfers and investments are muted
 * because they are not spending. With
 * `onOpen` the whole row is a button that opens the transaction (see `TxnSheet`).
 */
export function TxnItem({
  txn,
  onOpen,
  showBalance = false,
  excluded = false,
  account,
}: {
  txn: TxnRow;
  onOpen?: (txn: TxnRow) => void;
  showBalance?: boolean;
  /** The row's category is kept out of spending: muted, but the row still opens. */
  excluded?: boolean;
  /** The account's name, for a list that mixes accounts. */
  account?: string;
}) {
  const muted = txn.kind === 'transfer' || txn.kind === 'investment';
  const category = txn.category ?? 'Uncategorised';
  const payee = payeeLabel(txn.description);
  const meta = [muted ? mutedLabel(txn) : category, account].filter((part) => part !== undefined).join(' · ');
  const classes = ['txn', muted || excluded ? 'is-muted' : '', onOpen === undefined ? '' : 'opens'].filter(Boolean).join(' ');
  return (
    <li className={classes}>
      {onOpen !== undefined && (
        <button type="button" className="txn-open" aria-label={`${payee}, ${category}. Show details`} onClick={() => onOpen(txn)} />
      )}
      <CatTile name={txn.kind === 'transfer' ? 'Transfer' : category} />
      <div className="mid">
        <span className="mer">{payee}</span>
        <span className="meta">{meta}</span>
      </div>
      <div className="end">
        <span className={txn.amount > 0 ? 'amt in' : 'amt'}>
          <Money paise={txn.amount} sign />
        </span>
        {showBalance && (
          <span className="sub">
            Bal <Money paise={txn.balanceAfter} compact />
          </span>
        )}
      </div>
    </li>
  );
}
