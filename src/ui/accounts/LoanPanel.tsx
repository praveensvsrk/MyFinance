import { dateShort, fyLabel, pct } from '../format';
import { Empty } from '../common/Empty';
import { useLoan } from '../hooks';
import { Money } from '../Money';

/** Home-loan terms, the rate history, interest against principal by year and prepayments. */
export function LoanPanel() {
  const loan = useLoan();
  if (loan.data === undefined) return <div className="sk r" style={{ height: 200 }} aria-busy="true" />;
  const data = loan.data;
  const outstanding = data.outstandingHistory[data.outstandingHistory.length - 1]?.outstanding ?? 0;
  const repaidPct = data.disbursed > 0 ? Math.max(0, Math.min(100, ((data.disbursed - outstanding) / data.disbursed) * 100)) : null;

  return (
    <>
      <section className="card" aria-labelledby="loan-h">
        <h2 id="loan-h" className="t-title" style={{ marginBottom: 8 }}>
          Loan details
        </h2>
        {repaidPct !== null && (
          <div style={{ marginBottom: 8 }}>
            <div className="prog" role="img" aria-label={`${Math.round(repaidPct)}% of the disbursed amount repaid`}>
              <i className="good" style={{ width: `${repaidPct}%` }} />
            </div>
            <span className="cap">{Math.round(repaidPct)}% of the disbursed amount repaid</span>
          </div>
        )}
        {data.sanctioned !== null && (
          <div className="kv">
            <span className="k">Sanctioned</span>
            <span className="v">
              <Money paise={data.sanctioned} whole />
            </span>
          </div>
        )}
        <div className="kv">
          <span className="k">Disbursed</span>
          <span className="v">
            <Money paise={data.disbursed} whole />
          </span>
        </div>
        {data.undisbursed > 0 && (
          <div className="kv">
            <span className="k">Not yet disbursed</span>
            <span className="v">
              <Money paise={data.undisbursed} whole />
            </span>
          </div>
        )}
        {data.emi !== null && (
          <div className="kv">
            <span className="k">EMI</span>
            <span className="v">
              <Money paise={data.emi} whole />
            </span>
          </div>
        )}
        <div className="kv">
          <span className="k">Rate used for planning</span>
          <span className="v">{pct(data.planningRate, 2)}</span>
        </div>
      </section>

      {data.rateHistory.length > 0 && (
        <section className="card" aria-labelledby="rate-h">
          <h2 id="rate-h" className="t-title" style={{ marginBottom: 12 }}>
            Interest rate
          </h2>
          <div className="timeline">
            {data.rateHistory.map((step, index) => (
              <div key={step.from} className="tl">
                <span className="rail">
                  <b className={index === data.rateHistory.length - 1 ? '' : 'done'} />
                  <i />
                </span>
                <span className="body">
                  <span>{index === data.rateHistory.length - 1 ? 'Now' : `From ${dateShort(step.from)} ${step.from.slice(0, 4)}`}</span>
                  <b>{pct(step.ratePct, 2)}</b>
                </span>
              </div>
            ))}
          </div>
          <span className="cap">Worked out from the interest charged in your statements.</span>
        </section>
      )}

      {data.years.length > 0 && (
        <section className="card" aria-labelledby="fy-h">
          <h2 id="fy-h" className="t-title" style={{ marginBottom: 8 }}>
            By financial year
          </h2>
          <div className="scroll-x">
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">Year</th>
                  <th scope="col">Interest</th>
                  <th scope="col">Principal</th>
                </tr>
              </thead>
              <tbody>
                {data.years.map((year) => (
                  <tr key={year.fy}>
                    <td>
                      {fyLabel(year.fy)}
                      {year.source === 'certificate' && <span className="tag" style={{ marginLeft: 6 }}>Certificate</span>}
                    </td>
                    <td>
                      <Money paise={year.interest} compact />
                    </td>
                    <td>
                      <Money paise={year.principal} compact />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card flat" aria-labelledby="pre-h">
        <h2 id="pre-h" className="t-title" style={{ padding: '16px 16px 4px' }}>
          Prepayments
        </h2>
        {data.prepayments.length === 0 ? (
          <p className="muted" style={{ padding: '4px 16px 16px' }}>
            No part-payments recorded.
          </p>
        ) : (
          <ul className="list">
            {data.prepayments.map((prepayment) => (
              <li key={prepayment.id} className="row">
                <span className="mid">
                  <span className="ttl">{dateShort(prepayment.date)} {prepayment.date.slice(0, 4)}</span>
                  <span className="sub">{prepayment.description}</span>
                </span>
                <span className="amt">
                  <Money paise={prepayment.amount} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {data.outstandingHistory.length === 0 && <Empty icon="loan" title="No loan statement yet">Import your loan statement to see the details.</Empty>}
    </>
  );
}
