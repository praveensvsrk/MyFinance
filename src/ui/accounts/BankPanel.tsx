import { useState } from 'react';
import type { TxnRow } from '../../db/schema';
import { CategorySheet } from '../common/CategorySheet';
import { Empty } from '../common/Empty';
import { groupByDay } from '../common/groupByDay';
import { TxnItem } from '../common/TxnItem';
import { dateLong } from '../format';
import { Icon } from '../Icon';

const PAGE = 50;

/** Searchable statement transactions, newest first, grouped by day. */
export function BankPanel({
  txns,
  search,
  onSearch,
}: {
  txns: TxnRow[];
  search: string;
  onSearch: (value: string) => void;
}) {
  const [shown, setShown] = useState(PAGE);
  const [editing, setEditing] = useState<TxnRow | null>(null);
  // Rows arrive oldest first; show the latest `shown` of them, newest on top.
  const visible = txns.slice(-shown).reverse();
  const groups = groupByDay(visible);

  return (
    <section aria-labelledby="txn-h" className="stack gap12">
      <h2 id="txn-h" className="t-title" style={{ padding: '0 4px' }}>
        Transactions
      </h2>
      <div className="inp">
        <Icon name="search" size={20} />
        <input
          type="search"
          className="hide-native"
          aria-label="Search transactions"
          placeholder="Search narration or reference"
          autoComplete="off"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
        />
      </div>
      {txns.length === 0 ? (
        search.trim() === '' ? (
          <Empty icon="file" title="No transactions">
            Import a statement to see its transactions here.
          </Empty>
        ) : (
          <p className="muted" style={{ padding: '8px 4px' }}>
            Nothing matches “{search.trim()}”.
          </p>
        )
      ) : (
        <div className="card flat" data-testid="txn-list">
          {groups.map((group, index) => (
            <div key={group.date}>
              <div className={index === 0 ? 'day first' : 'day'}>{dateLong(group.date)}</div>
              <ul>
                {group.items.map((txn) => (
                  <TxnItem key={txn.id} txn={txn} onCategory={setEditing} showBalance />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {txns.length > shown && (
        <button type="button" className="btn out block" onClick={() => setShown((count) => count + PAGE)}>
          Show older ({txns.length - shown} more)
        </button>
      )}
      {editing !== null && <CategorySheet txn={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}
