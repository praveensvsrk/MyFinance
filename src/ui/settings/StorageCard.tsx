import { useState } from 'react';
import { bytesText } from '../format';
import { useStorageStatus } from '../hooks';

/** Whether the browser promises to keep the data, and how much space it uses. */
export function StorageCard() {
  const storage = useStorageStatus();
  const [granted, setGranted] = useState<boolean | null>(null);
  const data = storage.data;
  const persisted = granted ?? data?.persisted ?? false;
  const used = data?.usageBytes ?? null;
  const quota = data?.quotaBytes ?? null;

  async function request() {
    const ok = (await navigator.storage?.persist?.().catch(() => false)) ?? false;
    setGranted(ok);
  }

  return (
    <section className="card" aria-labelledby="storage-h">
      <div className="row-between">
        <h2 id="storage-h" className="t-title">
          Storage
        </h2>
        {data !== undefined && <span className={persisted ? 'tag good' : 'tag warn'}>{persisted ? 'Protected' : 'Not protected'}</span>}
      </div>
      {used !== null && quota !== null && quota > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="prog" role="img" aria-label={`${bytesText(used)} used of ${bytesText(quota)}`}>
            <i style={{ width: `${Math.max(1, Math.min(100, (used / quota) * 100))}%` }} />
          </div>
          <span className="cap">
            {bytesText(used)} used of {bytesText(quota)} available
          </span>
        </div>
      )}
      {data !== undefined && !persisted && (
        <>
          <div className="note warn" style={{ marginTop: 12 }}>
            The browser may clear your data when the device runs low on space.
          </div>
          <button type="button" className="btn block tonal" style={{ marginTop: 12 }} onClick={() => void request()}>
            Keep my data
          </button>
          {granted === false && <span className="hint err">Not granted. Installing the app to the home screen often helps.</span>}
        </>
      )}
    </section>
  );
}
