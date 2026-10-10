import type { Paise } from '../../parsers/types';
import { dateLong, monthLabel } from '../format';
import { useEpf } from '../hooks';
import { Money } from '../Money';

/** Employee, employer and pension shares of one EPF account, and its recent contributions. */
export function EpfPanel({ accountId }: { accountId: string }) {
  const epf = useEpf();
  if (epf.data === undefined) return <div className="sk r" style={{ height: 200 }} aria-busy="true" />;
  const account = epf.data.accounts.find((candidate) => candidate.accountId === accountId);
  if (account === undefined) return null;
  const { ee, er, eps } = account.balance;
  const counted = ee + er;
  const parts: { key: string; label: string; paise: Paise; tone: string }[] = [
    { key: 'ee', label: 'Your share', paise: ee, tone: 't1' },
    { key: 'er', label: 'Employer share', paise: er, tone: 't2' },
  ];
  const recent = account.contributions.slice(-12).reverse();

  return (
    <>
      <section className="card" aria-labelledby="epf-h">
        <h2 id="epf-h" className="ad-card-h" style={{ marginBottom: 12 }}>
          Balance split
        </h2>
        <div className="sb-bar" role="img" aria-label="Your share against employer share">
          {parts.map((part) => (
            <span key={part.key} className={`sb-seg ${part.tone}`} style={{ flex: Math.max(part.paise, 0) / (counted || 1) }} />
          ))}
        </div>
        <div className="sb-legend c2">
          {parts.map((part) => (
            <div key={part.key} className="sb-item">
              <span className="k">
                <span className={`sw8 ${part.tone}`} />
                {part.label}
              </span>
              <span className="v">
                <Money paise={part.paise} compact />
              </span>
            </div>
          ))}
        </div>
        <div className="note" style={{ marginTop: 12 }}>
          <span>
            Pension (EPS) of <Money paise={eps} compact /> is tracked separately and not counted in net worth.
          </span>
        </div>
        {account.asOf !== null && <span className="cap">Balance as of {dateLong(account.asOf)}.</span>}
      </section>

      <section className="card flat" aria-labelledby="epfc-h">
        <h2 id="epfc-h" className="ad-sec-h">
          Recent contributions
        </h2>
        {recent.length === 0 ? (
          <p className="muted" style={{ padding: '4px 16px 16px' }}>
            No contributions in the imported passbook.
          </p>
        ) : (
          <ul className="list">
            {recent.map((row) => (
              <li key={`${row.date}-${row.ee}`} className="row" style={{ minHeight: 56 }}>
                <span className="mid">
                  <span className="ttl">{monthLabel(row.date.slice(0, 7))}</span>
                  <span className="sub">
                    You <Money paise={row.ee} compact /> · Employer <Money paise={row.er} compact />
                  </span>
                </span>
                <span className="amt in">
                  <Money paise={row.ee + row.er} sign />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
