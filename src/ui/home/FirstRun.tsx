import { Link } from 'react-router-dom';
import { Icon, type IconName } from '../Icon';

const SOURCES: { icon: IconName; title: string; sub: string }[] = [
  { icon: 'bank', title: 'Bank statements', sub: 'Savings account PDFs or spreadsheets' },
  { icon: 'shield', title: 'EPF passbook', sub: 'From the EPFO member portal' },
  { icon: 'layers', title: 'Mutual-fund statement', sub: 'CAS from CAMS or KFintech' },
  { icon: 'trend', title: 'E*TRADE', sub: 'Stock plan and RSU statements' },
];

/** Shown before any account exists. */
export function FirstRun() {
  return (
    <>
      <section className="empty">
        <span className="art">
          <Icon name="import" size={44} />
        </span>
        <h2>Import your first statement</h2>
        <p>Everything stays on this device. Nothing is uploaded.</p>
        <Link to="/import" className="btn fill">
          <Icon name="import" size={20} />
          Import
        </Link>
      </section>
      <section className="card flat" aria-labelledby="src-h">
        <h2 id="src-h" className="t-title" style={{ padding: '16px 16px 4px' }}>
          What you can import
        </h2>
        <ul className="list">
          {SOURCES.map((source) => (
            <li key={source.title} className="row">
              <span className="lead">
                <Icon name={source.icon} size={22} />
              </span>
              <span className="mid">
                <span className="ttl">{source.title}</span>
                <span className="sub">{source.sub}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
