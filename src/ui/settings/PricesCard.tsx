import { useState } from 'react';
import { useActions } from '../actions';
import { Field } from '../common/Field';
import { useSetting } from '../hooks';

/** The Finnhub key that lets the app fetch the share price; saving it fetches prices at once. */
export function PricesCard() {
  const actions = useActions();
  const stored = useSetting('finnhubKey', '');
  const [key, setKey] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <section className="card" aria-labelledby="prices-h">
      <h2 id="prices-h" className="t-title">
        Share prices
      </h2>
      <span className="sub">A free Finnhub key lets the app price your company shares. The key stays on this device.</span>
      <form
        className="stack gap12"
        style={{ marginTop: 14 }}
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setStatus('');
          void actions
            .saveFinnhubKeyAndRefresh(key)
            .then((result) => {
              setStatus(result.failed.length === 0 ? 'Prices updated' : `Failed: ${result.failed.map((f) => f.symbol).join(', ')}`);
              setKey('');
            })
            .catch(() => setStatus('Could not save the key'))
            .finally(() => setBusy(false));
        }}
      >
        <Field id="finnhub-key" label="Finnhub API key" value={key} onChange={setKey} placeholder={stored.data ? 'Replace the saved key' : 'Paste your key'} />
        <button type="submit" className={busy ? 'btn block dis' : 'btn block tonal'} disabled={busy}>
          Save key
        </button>
        <p data-testid="key-status" role="status" className="hint">
          {status || (stored.data ? 'Key saved' : 'No key')}
        </p>
      </form>
    </section>
  );
}
