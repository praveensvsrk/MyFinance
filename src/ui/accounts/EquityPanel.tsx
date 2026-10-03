import { useState } from 'react';
import { dateLong, usdInr as formatUsdInr } from '../format';
import { useEquity } from '../hooks';
import { Icon } from '../Icon';
import { Money, Usd } from '../Money';
import { pct } from '../format';

/** A label with an (i) that reveals a one-line explanation, like the brokerage summary it mirrors. */
function Labelled({ label, tip }: { label: string; tip: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="k">
      {label}{' '}
      <button
        type="button"
        className="ib"
        style={{ display: 'inline-grid', width: 32, height: 32, margin: '-8px 0', verticalAlign: 'middle', color: 'var(--text-muted)' }}
        aria-label={`About ${label}`}
        aria-expanded={open}
        title={tip}
        onClick={() => setOpen(!open)}
      >
        <Icon name="info" size={16} />
      </button>
      {open && <span className="cap" style={{ display: 'block' }}>{tip}</span>}
    </span>
  );
}

interface VestGroup {
  date: string;
  shares: number;
  valueInr: number | null;
  vested: boolean;
}

/** One entry per vest date: shares added up, value added up (unknown if any part is unknown). */
function groupVests(vests: { vestDate: string; shares: number; valueInr: number | null; status: string }[]): VestGroup[] {
  const byDate = new Map<string, VestGroup>();
  for (const vest of vests) {
    const group = byDate.get(vest.vestDate);
    if (group === undefined) {
      byDate.set(vest.vestDate, { date: vest.vestDate, shares: vest.shares, valueInr: vest.valueInr, vested: vest.status === 'vested' });
    } else {
      group.shares += vest.shares;
      group.valueInr = group.valueInr === null || vest.valueInr === null ? null : group.valueInr + vest.valueInr;
      group.vested = group.vested && vest.status === 'vested';
    }
  }
  return [...byDate.values()];
}

/** Shares held, the price and rate behind their value, the vest timeline and lots. */
export function EquityPanel() {
  const equity = useEquity();
  const [showPast, setShowPast] = useState(false);
  if (equity.data === undefined) return <div className="sk r" style={{ height: 200 }} aria-busy="true" />;
  const data = equity.data;
  const groups = groupVests(data.vests.filter((vest) => vest.status !== 'cancelled')).sort((a, b) => (a.date < b.date ? -1 : 1));
  // Past vests collapse to the latest one; the upcoming schedule is what matters.
  const past = groups.filter((group) => group.vested);
  const hidden = showPast ? 0 : Math.max(0, past.length - 1);
  const vests = groups.filter((group) => !group.vested || showPast || group === past[past.length - 1]);
  const lots = [...data.lots].filter((lot) => lot.remainingShares > 0).sort((a, b) => (a.acquiredDate < b.acquiredDate ? 1 : -1));

  return (
    <>
      <section className="card" aria-labelledby="sum-h">
        <h2 id="sum-h" className="t-title" style={{ marginBottom: 4 }}>
          Account summary
        </h2>
        <div className="kv">
          <Labelled label="Current Account Value" tip="Shares you hold today (already vested or purchased), at the latest price." />
          <span className="v">
            <Money paise={data.valueInr} whole />
          </span>
        </div>
        <div className="kv">
          <Labelled label="Day's Gain" tip={data.dayGain === null ? 'Needs a share price from the last few days to compare with.' : `Change in value since the previous price on ${dateLong(data.dayGain.since)}.`} />
          <span className={`v ${data.dayGain === null ? '' : data.dayGain.inr < 0 ? 'res-bad' : 'res-ok'}`}>
            {data.dayGain === null ? (
              '—'
            ) : (
              <>
                <Money paise={data.dayGain.inr} whole sign />
                <span style={{ display: 'block', textAlign: 'right' }}>({data.dayGain.pct > 0 ? '+' : ''}{pct(data.dayGain.pct, 2)})</span>
              </>
            )}
          </span>
        </div>
        <div className="kv">
          <Labelled label="Potential Benefit Value" tip="Shares that have not vested yet, at the latest price. Not part of net worth until they vest." />
          <span className="v">
            <Money paise={data.unvestedValueInr} whole />
          </span>
        </div>
        <div className="kv">
          <Labelled label="Total Account Value" tip="Current account value plus potential benefit value." />
          <span className="v">
            <Money paise={data.valueInr + data.unvestedValueInr} whole />
          </span>
        </div>
      </section>

      <section className="card" aria-labelledby="eq-h">
        <h2 id="eq-h" className="t-title" style={{ marginBottom: 12 }}>
          {data.symbol === '' ? 'Employer' : data.symbol} shares
        </h2>
        <div className="stats c2">
          <div className="stat">
            <span className="lab">Held</span>
            <span className="val">{data.releasedShares}</span>
          </div>
          <div className="stat">
            <span className="lab">Value</span>
            <span className="val">
              <Money paise={data.valueInr} compact />
            </span>
          </div>
        </div>
        <div className="divider" style={{ margin: '12px 0 0' }} />
        <div className="kv">
          <span className="k">Share price</span>
          <span className="v">
            {data.priceUsdCents === null ? 'No price yet' : <Usd cents={data.priceUsdCents} />}
            {data.priceDate && <span className="sub"> · {dateLong(data.priceDate)}</span>}
          </span>
        </div>
        <div className="kv">
          <span className="k">USD → INR</span>
          <span className="v">{data.usdInr === null ? 'No rate yet' : `₹${formatUsdInr(data.usdInr)}`}</span>
        </div>
        {data.priceUsdCents === null && (
          <div className="note warn" style={{ marginTop: 8 }}>
            Add a Finnhub key in Settings to fetch the share price.
          </div>
        )}
      </section>

      {vests.length > 0 && (
        <section className="card" aria-labelledby="vest-h">
          <h2 id="vest-h" className="t-title" style={{ marginBottom: 12 }}>
            Vests
          </h2>
          {hidden > 0 && (
            <button type="button" className="btn tonal" style={{ marginBottom: 8 }} onClick={() => setShowPast(true)}>
              Show {hidden} earlier {hidden === 1 ? 'vest' : 'vests'}
            </button>
          )}
          {showPast && past.length > 1 && (
            <button type="button" className="btn tonal" style={{ marginBottom: 8 }} onClick={() => setShowPast(false)}>
              Hide earlier vests
            </button>
          )}
          <div className="timeline">
            {vests.map((vest) => (
              <div key={vest.date} className="tl">
                <span className="rail">
                  <b className={vest.vested ? 'done' : ''} />
                  <i />
                </span>
                <span className="body">
                  <span>
                    {dateLong(vest.date)}
                    <span className="sub" style={{ display: 'block' }}>
                      {vest.shares} shares · {vest.vested ? 'Vested' : 'Upcoming'}
                    </span>
                  </span>
                  <b>{vest.valueInr === null ? '—' : <Money paise={vest.valueInr} compact />}</b>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {lots.length > 0 && (
        <section className="card flat" aria-labelledby="lot-h">
          <h2 id="lot-h" className="t-title" style={{ padding: '16px 16px 4px' }}>
            Lots
          </h2>
          <ul className="list">
            {lots.map((lot) => (
              <li key={lot.id} className="row">
                <span className="mid">
                  <span className="ttl">
                    {lot.remainingShares} shares <span className="tag">{lot.source}</span>
                  </span>
                  <span className="sub">Acquired {dateLong(lot.acquiredDate)}</span>
                </span>
                <span className="end">
                  <span className="sub">Gain</span>
                  <b className={lot.gainInr !== null && lot.gainInr < 0 ? 'res-bad' : 'res-ok'}>
                    {lot.gainInr === null ? '—' : <Money paise={lot.gainInr} compact sign />}
                  </b>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
