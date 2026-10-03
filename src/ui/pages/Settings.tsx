import { useState } from 'react';
import { useApp } from '../AppContext';
import { useActions } from '../actions';
import { useSetting, useStorageStatus } from '../hooks';
import { Debug } from './Debug';

/** Functional placeholder: Finnhub key, hide amounts and storage status (Plan 3B builds the full screen). */
export function Settings() {
  const { hideAmounts, setHideAmounts } = useApp();
  const actions = useActions();
  const storedKey = useSetting('finnhubKey', '');
  const [key, setKey] = useState('');
  const [status, setStatus] = useState('');
  return (
    <>
      <Debug title="Settings" query={useStorageStatus()} />
      <label>
        <input type="checkbox" checked={hideAmounts} onChange={(event) => setHideAmounts(event.target.checked)} />
        Hide amounts
      </label>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void actions.saveFinnhubKeyAndRefresh(key).then((result) => {
            setStatus(result.failed.length === 0 ? 'Prices updated' : `Failed: ${result.failed.map((f) => f.symbol).join(', ')}`);
            setKey('');
          });
        }}
      >
        <label>
          Finnhub API key
          <input value={key} onChange={(event) => setKey(event.target.value)} autoComplete="off" />
        </label>
        <button type="submit">Save key</button>
      </form>
      <p data-testid="key-status">{status || (storedKey.data ? 'Key saved' : 'No key')}</p>
    </>
  );
}
