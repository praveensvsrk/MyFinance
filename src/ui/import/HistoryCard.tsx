import { useState } from 'react';
import type { SourceId } from '../../parsers';
import { dateLong, dateShort } from '../format';
import { Icon } from '../Icon';
import { countRows } from './PreviewCard';
import { useImportHistory, type ImportHistoryItem } from '../useImportHistory';
import {
  applyHistoryView,
  DEFAULT_VIEW,
  GROUP_LABELS,
  SORT_LABELS,
  type HistoryGroup,
  type HistorySort,
  type HistoryView,
  type VerifiedFilter,
} from './historyView';

function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Record<T, string>; onChange: (v: T) => void }) {
  return (
    <div className="inp" style={{ flex: 1, minWidth: 140 }}>
      <select className="sel-in" aria-label={label} value={value} onChange={(event) => onChange(event.target.value as T)}>
        {(Object.keys(options) as T[]).map((key) => (
          <option key={key} value={key}>
            {options[key]}
          </option>
        ))}
      </select>
    </div>
  );
}

const VERIFIED_LABELS: Record<VerifiedFilter, string> = { all: 'All checks', verified: 'Verified', unverified: 'Unverified' };

function Row({ item, undo }: { item: ImportHistoryItem; undo: (id: string) => Promise<void> }) {
  return (
    <li className="row" style={{ alignItems: 'flex-start' }}>
      <span className="lead" aria-hidden="true">
        <Icon name="import" size={20} />
      </span>
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
      <button type="button" className="btn text sm" aria-label={`Undo ${item.label}`} onClick={() => void undo(item.id)}>
        Undo
      </button>
    </li>
  );
}

/** Past imports, newest first; undoing one removes exactly what it added. */
export function HistoryCard() {
  const history = useImportHistory();
  const [view, setView] = useState<HistoryView>(DEFAULT_VIEW);
  const patch = (change: Partial<HistoryView>) => setView((prev) => ({ ...prev, ...change }));
  const sourcesPresent = [...new Map(history.items.map((item) => [item.source, item.label])).entries()] as [SourceId, string][];
  const groups = applyHistoryView(history.items, view);
  const filtered = view.search.trim() !== '' || view.verified !== 'all' || view.sources.length > 0;
  const toggleSource = (source: SourceId) =>
    patch({ sources: view.sources.includes(source) ? view.sources.filter((s) => s !== source) : [...view.sources, source] });

  return (
    <section className="card flat" aria-labelledby="hist-h" data-testid="import-history">
      <h2 id="hist-h" className="hist-h" style={{ padding: '16px 16px 4px' }}>
        History
      </h2>
      {history.items.length === 0 ? (
        <p className="muted" style={{ padding: '4px 16px 16px' }}>
          {history.loading ? 'Loading…' : 'Nothing imported yet.'}
        </p>
      ) : (
        <>
          <div className="stack gap12" style={{ padding: '8px 16px 12px' }}>
            <div className="inp">
              <Icon name="search" size={20} />
              <input
                type="search"
                className="hide-native"
                aria-label="Search history"
                placeholder="Search source, date or note"
                autoComplete="off"
                value={view.search}
                onChange={(event) => patch({ search: event.target.value })}
              />
            </div>
            <div className="chips" role="group" aria-label="Filter by source">
              {sourcesPresent.map(([source, label]) => (
                <button key={source} type="button" aria-pressed={view.sources.includes(source)} className={view.sources.includes(source) ? 'chip on' : 'chip'} onClick={() => toggleSource(source)}>
                  {label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <Select<VerifiedFilter> label="Filter by checks" value={view.verified} options={VERIFIED_LABELS} onChange={(verified) => patch({ verified })} />
              <Select<HistorySort> label="Sort history" value={view.sort} options={SORT_LABELS} onChange={(sort) => patch({ sort })} />
              <Select<HistoryGroup> label="Group history" value={view.group} options={GROUP_LABELS} onChange={(group) => patch({ group })} />
            </div>
            {filtered && (
              <button type="button" className="btn text sm" onClick={() => setView(DEFAULT_VIEW)}>
                Clear filters
              </button>
            )}
          </div>
          {groups.length === 0 ? (
            <p className="muted" style={{ padding: '4px 16px 16px' }}>
              Nothing matches these filters.
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.title ?? 'all'}>
                {group.title !== null && (
                  <h3 className="cap" style={{ padding: '8px 16px 0' }}>
                    {group.title} · {group.items.length}
                  </h3>
                )}
                <ul className="list">
                  {group.items.map((item) => (
                    <Row key={item.id} item={item} undo={history.undo} />
                  ))}
                </ul>
              </div>
            ))
          )}
        </>
      )}
    </section>
  );
}
