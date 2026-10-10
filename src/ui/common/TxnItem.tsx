import type { TxnRow } from '../../db/schema';
import { normaliseDescription } from '../../domain/categorise';
import { rulePatternFor } from '../../services/actions/rules';
import { Money } from '../Money';
import { CatTile } from './CatTile';

/** A short merchant-style name for a bank narration. */
export function merchantOf(description: string): string {
  return rulePatternFor(description) ?? normaliseDescription(description).slice(0, 32);
}

/** The tag on a muted row: a custom category is named alongside the kind. */
function mutedLabel(txn: TxnRow): string {
  if (txn.kind === 'transfer') return 'Transfer';
  const category = txn.category;
  return category === null || category === 'Investments' || category === 'Other' ? 'Investment' : `${category} · Investment`;
}

/**
 * One transaction row; transfers and investments are muted because they are not spending. With
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
  const merchant = merchantOf(txn.description);
  const classes = ['txn', muted || excluded ? 'is-muted' : '', onOpen === undefined ? '' : 'opens'].filter(Boolean).join(' ');
  return (
    <li className={classes}>
      {onOpen !== undefined && (
        <button type="button" className="txn-open" aria-label={`${merchant}, ${category}. Show details`} onClick={() => onOpen(txn)} />
      )}
      <CatTile name={txn.kind === 'transfer' ? 'Transfer' : category} />
      <div className="mid">
        <span className="mer">{merchant}</span>
        {merchant.toUpperCase() !== txn.description.trim().toUpperCase() && <span className="narr">{txn.description}</span>}
        <span className="meta">
          {muted ? <span className="tag outline">{mutedLabel(txn)}</span> : <span className={onOpen === undefined ? 'tag' : 'tag acc'}>{category}</span>}
          {account !== undefined && <span className="acct">{account}</span>}
        </span>
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
