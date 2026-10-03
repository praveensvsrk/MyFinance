import { dateLong, dateShort } from '../format';
import { countRows } from './PreviewCard';
import { useImportHistory } from '../useImportHistory';

/** Past imports, newest first; undoing one removes exactly what it added. */
export function HistoryCard() {
  const history = useImportHistory();
  return (
    <section className="card flat" aria-labelledby="hist-h" data-testid="import-history">
      <h2 id="hist-h" className="t-title" style={{ padding: '16px 16px 4px' }}>
        History
      </h2>
      {history.items.length === 0 ? (
        <p className="muted" style={{ padding: '4px 16px 16px' }}>
          {history.loading ? 'Loading…' : 'Nothing imported yet.'}
        </p>
      ) : (
        <ul className="list">
          {history.items.map((item) => (
            <li key={item.id} className="row" style={{ alignItems: 'flex-start' }}>
              <span className="mid">
                <span className="ttl" style={{ whiteSpace: 'normal' }}>
                  {item.label}
                  {!item.verified && <span className="tag warn" style={{ marginLeft: 8 }}>Unverified</span>}
                </span>
                <span className="sub">
                  {dateShort(item.periodFrom)} {item.periodFrom.slice(0, 4)} to {dateLong(item.periodTo)}
                </span>
                <span className="sub">
                  Added {dateLong(item.importedAt)}
                  {countRows(item.counts).length > 0 &&
                    ` · ${countRows(item.counts).map((row) => `${row.value} ${row.label.toLowerCase()}`).join(', ')}`}
                </span>
              </span>
              <button type="button" className="btn text sm" aria-label={`Undo ${item.label}`} onClick={() => void history.undo(item.id)}>
                Undo
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
