import { EQUITY_SYMBOL } from '../../config';
import { dateLong, usdInr as formatUsdInr } from '../format';
import { useEquity } from '../hooks';
import { Money, Usd } from '../Money';

/** Shares held, the price and rate behind their value, the vest timeline and lots. */
export function EquityPanel() {
  const equity = useEquity();
  if (equity.data === undefined) return <div className="sk r" style={{ height: 200 }} aria-busy="true" />;
  const data = equity.data;
  const vests = [...data.vests].filter((vest) => vest.status !== 'cancelled').sort((a, b) => (a.vestDate < b.vestDate ? -1 : 1));
  const lots = [...data.lots].filter((lot) => lot.remainingShares > 0).sort((a, b) => (a.acquiredDate < b.acquiredDate ? 1 : -1));

  return (
    <>
      <section className="card" aria-labelledby="eq-h">
        <h2 id="eq-h" className="t-title" style={{ marginBottom: 12 }}>
          {EQUITY_SYMBOL} shares
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
        {data.unvestedShares > 0 && (
          <div className="note" style={{ marginTop: 8 }}>
            <span>
              {data.unvestedShares} unvested shares (<Money paise={data.unvestedValueInr} compact />) are not part of net
              worth.
            </span>
          </div>
        )}
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
          <div className="timeline">
            {vests.map((vest) => (
              <div key={vest.id} className="tl">
                <span className="rail">
                  <b className={vest.status === 'vested' ? 'done' : ''} />
                  <i />
                </span>
                <span className="body">
                  <span>
                    {dateLong(vest.vestDate)}
                    <span className="sub" style={{ display: 'block' }}>
                      {vest.shares} shares · {vest.status === 'vested' ? 'Vested' : 'Upcoming'}
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
