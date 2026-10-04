import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useActions } from '../actions';
import { Icon, type IconName } from '../Icon';

const SOURCES: { icon: IconName; title: string; sub: string }[] = [
  { icon: 'bank', title: 'Bank statements', sub: 'PDFs, or a CSV/Excel export from any bank' },
  { icon: 'shield', title: 'EPF passbook', sub: 'From the EPFO member portal' },
  { icon: 'layers', title: 'Mutual-fund statement', sub: 'CAS from CAMS or KFintech' },
  { icon: 'trend', title: 'E*TRADE', sub: 'Stock plan and RSU statements' },
];

/** Shown before any account exists. */
export function FirstRun() {
  const actions = useActions();
  const [busy, setBusy] = useState(false);

  async function trySample() {
    setBusy(true);
    try {
      await actions.loadSampleData();
    } finally {
      setBusy(false);
    }
  }

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
        <button type="button" className="btn out" disabled={busy} onClick={() => void trySample()}>
          {busy ? 'Loading sample…' : 'Try with sample data'}
        </button>
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
