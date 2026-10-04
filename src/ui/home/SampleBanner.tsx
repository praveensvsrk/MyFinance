import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useActions } from '../actions';
import { Icon } from '../Icon';

/** Shown on every screen while the made-up demo person is loaded. */
export function SampleBanner() {
  const actions = useActions();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function clear() {
    setBusy(true);
    try {
      await actions.clearAllData();
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div className="note warn" role="status">
      <Icon name="info" size={20} />
      <span className="stack gap8" style={{ flex: 1 }}>
        {confirming ? (
          <>
            <span>This removes the example and leaves an empty app.</span>
            <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn sm danger" disabled={busy} onClick={() => void clear()}>
                Remove sample
              </button>
              <button type="button" className="btn sm text" disabled={busy} onClick={() => setConfirming(false)}>
                Keep it
              </button>
            </span>
          </>
        ) : (
          <>
            <span>You are looking at made-up sample data. Nothing here is yours.</span>
            <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Link to="/import" className="btn sm tonal">
                Import your own
              </Link>
              <button type="button" className="btn sm text" onClick={() => setConfirming(true)}>
                Clear sample
              </button>
            </span>
          </>
        )}
      </span>
    </div>
  );
}
