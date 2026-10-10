import { useState, type ReactNode } from 'react';
import type { IsoDate, Paise } from '../../parsers/types';
import type { MfProvisionalRow } from '../../db/schema';
import type { MfSchemeSummary } from '../../services/dashboard';
import { useActions } from '../actions';
import { Sheet } from '../common/Sheet';
import { dateShort, fundDisplayName, nav as formatNav, pct, units } from '../format';
import { useMf } from '../hooks';
import { Icon } from '../Icon';
import { Money } from '../Money';
import { AccountHero } from './AccountHero';
import { ClockIcon, SortIcon } from './icons';
import { MF_SORT_LABELS, defaultDirection, sortSchemes, type MfSortKey, type SortDirection } from './mfSort';

function Holding({ scheme }: { scheme: MfSchemeSummary }) {
  const gain = scheme.gain;
  const gainPct = scheme.invested > 0 ? (gain / scheme.invested) * 100 : null;
  return (
    <li className="hold" aria-label={fundDisplayName(scheme.scheme)}>
      <span className="fn">{fundDisplayName(scheme.scheme)}</span>
      <span className="fv mono">
        <Money paise={scheme.value} compact />
      </span>
      {scheme.nav === null ? (
        <span className="fs warn">No NAV yet, so this fund is valued at ₹0.</span>
      ) : (
        <span className="fs mono">
          {units(scheme.units)} u · NAV {formatNav(scheme.nav)}
          {scheme.navDate ? ` (${dateShort(scheme.navDate)})` : ''}
        </span>
      )}
      <span className={gain < 0 ? 'fr mono neg' : 'fr mono'}>
        <Money paise={gain} compact sign />
        {` · ${pct(scheme.xirr === null ? null : scheme.xirr * 100)}`}
        <span className="sr"> XIRR; gain {gainPct === null ? '' : pct(gainPct)}</span>
      </span>
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
        Choose the fund for this debit; units stay estimated until the next CAS.
      </p>
      <div className="stack" role="radiogroup" aria-label="Fund">
        {schemes.map((scheme) => (
          <label key={scheme.folioId} className="radio">
            <input type="radio" name="scheme" checked={key === scheme.folioId} onChange={() => setKey(scheme.folioId)} />
            {fundDisplayName(scheme.scheme)}
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
        Discard this SIP
      </button>
    </Sheet>
  );
}

/** The mutual-fund page: value hero, SIPs waiting for a statement, and dense holdings with a sort button. */
export function MfPanel({
  title,
  eyebrow,
  subs,
  asOf,
  history,
}: {
  title: string;
  eyebrow?: ReactNode;
  subs?: ReactNode[];
  asOf?: ReactNode;
  history: { date: IsoDate; balance: Paise }[];
}) {
  const mf = useMf();
  const [editing, setEditing] = useState<MfProvisionalRow | null>(null);
  const [sortKey, setSortKey] = useState<MfSortKey>('value');
  const [direction, setDirection] = useState<SortDirection>(defaultDirection('value'));
  const [menu, setMenu] = useState(false);
  if (mf.data === undefined) return <div className="sk r" style={{ height: 200 }} aria-busy="true" />;
  const { portfolio, schemes, provisionals } = mf.data;
  const waiting = provisionals.filter((row) => row.status !== 'confirmed');
  const gainPct = portfolio.invested > 0 ? (portfolio.gain / portfolio.invested) * 100 : null;
  const dirLabel =
    sortKey === 'name' ? (direction === 'asc' ? 'A → Z' : 'Z → A') : direction === 'desc' ? 'High → Low' : 'Low → High';

  return (
    <>
      <AccountHero
        eyebrow={eyebrow}
        title={title}
        subs={subs}
        label="Current value"
        amount={<Money paise={portfolio.value} whole />}
        amountTestId="account-balance"
        delta={
          <>
            <span className={portfolio.gain < 0 ? 'mono down' : 'mono up'}>
              <Money paise={portfolio.gain} whole sign />
              {gainPct !== null && ` (${pct(gainPct)})`}
            </span>
            <span className="muted">all time</span>
          </>
        }
        asOf={asOf}
        points={history}
        chartLabel={`${title} value over time`}
        invested={portfolio.invested}
        strip={[
          { k: 'Invested', v: <Money paise={portfolio.invested} compact /> },
          { k: 'XIRR', v: pct(portfolio.xirr === null ? null : portfolio.xirr * 100), tone: portfolio.xirr !== null && portfolio.xirr < 0 ? 'bad' : 'good' },
          { k: 'Funds', v: schemes.length },
        ]}
      />

      {waiting.length > 0 && (
        <section aria-labelledby="prov-h" className="stack gap8">
          <div className="ad-note" id="prov-h">
            <ClockIcon />
            <span>
              <b>
                {waiting.length} {waiting.length === 1 ? 'SIP' : 'SIPs'} since the CAS statement
              </b>{' '}
              counted as provisional until the next statement.
            </span>
          </div>
          <div className="card flat">
            <ul className="list">
              {waiting.map((row) => {
                const scheme = schemes.find((candidate) => candidate.folioId === row.schemeKey);
                return (
                  <li key={row.id}>
                    <button type="button" className="row" onClick={() => setEditing(row)}>
                      <span className="mid">
                        <span className="ttl">
                          {dateShort(row.date)} · <Money paise={row.grossPaise} compact />
                        </span>
                        <span className="sub">
                          {scheme?.scheme ?? 'Choose a fund'}
                          {row.status === 'stale' && ' · older than expected'}
                        </span>
                      </span>
                      <span className="chev">
                        <Icon name="chevron" size={20} />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      )}

      <section aria-labelledby="hold-h">
        <div className="ad-head">
          <h2 id="hold-h">Holdings · {schemes.length}</h2>
          {schemes.length > 1 && (
            <div className="ad-sort">
              <button
                type="button"
                className="ad-sortbtn"
                aria-haspopup="true"
                aria-expanded={menu}
                aria-label={`Sort funds by ${MF_SORT_LABELS[sortKey]}, ${dirLabel}`}
                onClick={() => setMenu(!menu)}
              >
                <SortIcon />
                {MF_SORT_LABELS[sortKey]}
              </button>
              {menu && (
                <div className="ad-menu" role="group" aria-label="Sort funds by">
                  {(Object.keys(MF_SORT_LABELS) as MfSortKey[]).map((key) => (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={key === sortKey}
                      onClick={() => {
                        setSortKey(key);
                        setDirection(defaultDirection(key));
                        setMenu(false);
                      }}
                    >
                      {MF_SORT_LABELS[key]}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="dir"
                    aria-label={direction === 'desc' ? 'Sorted high to low, switch to low to high' : 'Sorted low to high, switch to high to low'}
                    onClick={() => setDirection(direction === 'desc' ? 'asc' : 'desc')}
                  >
                    {dirLabel}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="card flat" style={{ marginTop: 8 }}>
          <div className="hold-h">
            <span>Fund · units</span>
            <span>Value · XIRR</span>
          </div>
          <ul>
            {sortSchemes(schemes, sortKey, direction).map((scheme) => (
              <Holding key={scheme.folioId} scheme={scheme} />
            ))}
          </ul>
        </div>
      </section>
      {editing !== null && <ProvisionalSheet row={editing} schemes={schemes} onClose={() => setEditing(null)} />}
    </>
  );
}
