import type { TxnRow } from '../../db/schema';
import { normaliseDescription } from '../../domain/categorise';
import { rulePatternFor } from '../../services/actions/rules';
import { Money } from '../Money';

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

/** One transaction row; transfers and investments are muted because they are not spending. */
export function TxnItem({
  txn,
  onCategory,
  showBalance = false,
  excluded = false,
}: {
  txn: TxnRow;
  onCategory?: (txn: TxnRow) => void;
  showBalance?: boolean;
  /** The row's category is kept out of spending: muted, but the category stays tappable. */
  excluded?: boolean;
}) {
  const muted = txn.kind === 'transfer' || txn.kind === 'investment';
  const category = txn.category ?? 'Uncategorised';
  return (
    <li className={muted || excluded ? 'txn is-muted' : 'txn'}>
      <div className="mid">
        <span className="mer">{merchantOf(txn.description)}</span>
        {merchantOf(txn.description).toUpperCase() !== txn.description.trim().toUpperCase() && (
          <span className="narr">{txn.description}</span>
        )}
        <span className="meta">
          {muted ? (
            <span className="tag outline">{mutedLabel(txn)}</span>
          ) : onCategory === undefined ? (
            <span className="tag">{category}</span>
          ) : (
            <button
              type="button"
              className="tag acc tag-btn"
              aria-label={`${category}. Change category for ${merchantOf(txn.description)}`}
              onClick={() => onCategory(txn)}
            >
              {category}
            </button>
          )}
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
