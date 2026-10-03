import { useState } from 'react';
import type { MfProvisionalRow } from '../../db/schema';
import type { MfSchemeSummary } from '../../services/dashboard';
import { useActions } from '../actions';
import { Sheet } from '../common/Sheet';
import { dateShort, nav as formatNav, pct, units } from '../format';
import { useMf } from '../hooks';
import { Money } from '../Money';
import { MF_SORT_LABELS, defaultDirection, sortSchemes, type MfSortKey, type SortDirection } from './mfSort';

function SchemeCard({ scheme }: { scheme: MfSchemeSummary }) {
  const gain = scheme.gain;
  return (
    <li className="card" aria-label={scheme.scheme}>
      <h3 className="t-title" style={{ marginBottom: 2 }}>
        {scheme.scheme}
      </h3>
      <span className="sub">
        {units(scheme.units)} units
        {scheme.nav !== null && ` · NAV ${formatNav(scheme.nav)}${scheme.navDate ? ` (${dateShort(scheme.navDate)})` : ''}`}
      </span>
      <div className="stats c3" style={{ marginTop: 12 }}>
        <div className="stat">
          <span className="lab">Invested</span>
          <span className="val">
            <Money paise={scheme.invested} compact />
          </span>
        </div>
        <div className="stat">
          <span className="lab">Value</span>
          <span className="val">
            <Money paise={scheme.value} compact />
          </span>
        </div>
        <div className="stat">
          <span className="lab">XIRR</span>
          <span className="val">{pct(scheme.xirr === null ? null : scheme.xirr * 100)}</span>
        </div>
      </div>
      <div className="row-between" style={{ marginTop: 10 }}>
        <span className="muted">Gain</span>
        <b className={gain >= 0 ? 'res-ok' : 'res-bad'}>
          <Money paise={gain} compact sign />
        </b>
      </div>
      {scheme.nav === null && <div className="note warn" style={{ marginTop: 10 }}>No NAV yet, so this fund is valued at ₹0.</div>}
    </li>
  );
}

function ProvisionalSheet({
  row,
  schemes,
  onClose,
}: {
  row: MfProvisionalRow;
  schemes: MfSchemeSummary[];
  onClose: () => void;
}) {
  const actions = useActions();
  const [key, setKey] = useState(row.schemeKey === 'unassigned' ? '' : row.schemeKey);
  const [busy, setBusy] = useState(false);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    try {
      await task();
    } finally {
      onClose();
    }
  }

  return (
    <Sheet title="Unconfirmed SIP" subtitle={`${dateShort(row.date)} · debit not yet in a statement`} onClose={onClose}>
      <p style={{ margin: '12px 0' }}>
        Choose the fund this debit went into. Its units are estimated until your next CAS confirms them.
      </p>
      <div className="stack" role="radiogroup" aria-label="Fund">
        {schemes.map((scheme) => (
          <label key={scheme.folioId} className="radio">
            <input type="radio" name="scheme" checked={key === scheme.folioId} onChange={() => setKey(scheme.folioId)} />
            {scheme.scheme}
          </label>
        ))}
      </div>
      <button
        type="button"
        className={key === '' || busy ? 'btn block dis' : 'btn block fill'}
        style={{ marginTop: 16 }}
        disabled={key === '' || busy}
        onClick={() => void run(() => actions.reassignProvisional(row.id, key))}
      >
        Assign
      </button>
      <button
        type="button"
        className="btn block text"
        style={{ marginTop: 8, color: 'var(--bad)' }}
        disabled={busy}
        onClick={() => void run(() => actions.discardProvisional(row.id))}
      >
        Discard — this SIP did not go through
      </button>
    </Sheet>
  );
}

/** Portfolio totals, one card per scheme and the SIP debits still waiting on a statement. */
export function MfPanel() {
  const mf = useMf();
  const [editing, setEditing] = useState<MfProvisionalRow | null>(null);
  const [sortKey, setSortKey] = useState<MfSortKey>('value');
  const [direction, setDirection] = useState<SortDirection>(defaultDirection('value'));
  if (mf.data === undefined) return <div className="sk r" style={{ height: 200 }} aria-busy="true" />;
  const { portfolio, schemes, provisionals } = mf.data;
  const waiting = provisionals.filter((row) => row.status !== 'confirmed');

  return (
    <>
      <section className="card" aria-labelledby="mf-h">
        <h2 id="mf-h" className="t-title" style={{ marginBottom: 12 }}>
          Portfolio
        </h2>
        <div className="stats c3">
          <div className="stat">
            <span className="lab">Invested</span>
            <span className="val">
              <Money paise={portfolio.invested} compact />
            </span>
          </div>
          <div className="stat">
            <span className="lab">Value</span>
            <span className="val">
              <Money paise={portfolio.value} compact />
            </span>
          </div>
          <div className="stat">
            <span className="lab">XIRR</span>
            <span className="val">{pct(portfolio.xirr === null ? null : portfolio.xirr * 100)}</span>
          </div>
        </div>
      </section>

      {waiting.length > 0 && (
        <section className="att-card" aria-labelledby="prov-h">
          <h2 id="prov-h">SIPs waiting for a statement</h2>
          {waiting.map((row) => {
            const scheme = schemes.find((candidate) => candidate.folioId === row.schemeKey);
            return (
              <button key={row.id} type="button" className="att" onClick={() => setEditing(row)}>
                <span className="a-msg">
                  {dateShort(row.date)} · <Money paise={row.grossPaise} compact /> ·{' '}
                  {scheme?.scheme ?? 'Choose a fund'}
                  {row.status === 'stale' && ' · older than expected'}
                </span>
              </button>
            );
          })}
        </section>
      )}

      {schemes.length > 1 && (
        <div className="row-between" style={{ gap: 8 }}>
          <div className="inp" style={{ flex: 1, minWidth: 140 }}>
            <select
              className="sel-in"
              aria-label="Sort funds by"
              value={sortKey}
              onChange={(event) => {
                const key = event.target.value as MfSortKey;
                setSortKey(key);
                setDirection(defaultDirection(key));
              }}
            >
              {(Object.keys(MF_SORT_LABELS) as MfSortKey[]).map((key) => (
                <option key={key} value={key}>
                  Sort: {MF_SORT_LABELS[key]}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="btn text"
            aria-label={direction === 'desc' ? 'Sorted high to low, switch to low to high' : 'Sorted low to high, switch to high to low'}
            onClick={() => setDirection(direction === 'desc' ? 'asc' : 'desc')}
          >
            {sortKey === 'name'
              ? direction === 'asc'
                ? 'A → Z'
                : 'Z → A'
              : direction === 'desc'
                ? 'High → Low'
                : 'Low → High'}
          </button>
        </div>
      )}

      <ul className="stack gap12">
        {sortSchemes(schemes, sortKey, direction).map((scheme) => (
          <SchemeCard key={scheme.folioId} scheme={scheme} />
        ))}
      </ul>
      {editing !== null && <ProvisionalSheet row={editing} schemes={schemes} onClose={() => setEditing(null)} />}
    </>
  );
}
