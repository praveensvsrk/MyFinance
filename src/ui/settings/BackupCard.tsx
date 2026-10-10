import { useState } from 'react';
import { BackupError } from '../../services/backup';
import { useApp } from '../AppContext';
import { useActions } from '../actions';
import { Field } from '../common/Field';
import { dateLong } from '../format';
import { useSetting } from '../hooks';

const MIN_PASSPHRASE = 8;

function download(bytes: Uint8Array, name: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function messageOf(error: unknown): string {
  if (error instanceof BackupError) {
    return error.reason === 'decrypt' ? 'That passphrase doesn’t open this backup.' : error.message;
  }
  return 'That file isn’t a MyFinance backup.';
}

/** An encrypted copy of everything on this device, and restoring from one. */
export function BackupCard() {
  const { today } = useApp();
  const actions = useActions();
  const last = useSetting<string | null>('lastBackupAt', null);
  const [exportPass, setExportPass] = useState('');
  const [exportMsg, setExportMsg] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [restorePass, setRestorePass] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const canExport = exportPass.length >= MIN_PASSPHRASE && !busy;
  const canRestore = file !== null && restorePass !== '' && confirm && !busy;

  async function doExport() {
    setBusy(true);
    setExportMsg('');
    try {
      download(await actions.exportBackup(exportPass), `myfinance-backup-${today}.mfbackup`);
      setExportMsg('Backup saved to your downloads.');
      setExportPass('');
    } catch {
      setExportMsg('Could not make the backup.');
    } finally {
      setBusy(false);
    }
  }

  async function doRestore() {
    if (file === null) return;
    setBusy(true);
    setRestoreMsg('');
    try {
      const result = await actions.restoreBackup(new Uint8Array(await file.arrayBuffer()), restorePass);
      setRestoreMsg(`Restored ${result.rows} rows.`);
      setRestorePass('');
      setConfirm(false);
      setFile(null);
    } catch (error) {
      setRestoreMsg(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="backup-h">
      <h2 id="backup-h" className="t-title">
        Backup
      </h2>
      <span className="sub">
        {last.data ? `Last backup ${dateLong(last.data)}.` : 'No backup yet.'}
      </span>

      <form
        className="stack gap12"
        style={{ marginTop: 14 }}
        onSubmit={(event) => {
          event.preventDefault();
          if (canExport) void doExport();
        }}
      >
        <Field
          id="backup-pass"
          label="Passphrase for the backup"
          type="password"
          value={exportPass}
          onChange={setExportPass}
          hint={`At least ${MIN_PASSPHRASE} characters; it cannot be recovered.`}
        />
        <button type="submit" className={canExport ? 'btn block tonal' : 'btn block dis'} disabled={!canExport}>
          Export backup
        </button>
        {exportMsg !== '' && (
          <span role="status" className="hint">
            {exportMsg}
          </span>
        )}
      </form>

      <div className="divider" style={{ margin: '16px 0' }} />

      <form
        className="stack gap12"
        onSubmit={(event) => {
          event.preventDefault();
          if (canRestore) void doRestore();
        }}
      >
        <div className="field">
          <label htmlFor="restore-file">Restore from a backup file</label>
          <div className="inp">
            <input id="restore-file" type="file" accept=".mfbackup,application/octet-stream" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          </div>
        </div>
        <Field id="restore-pass" label="Passphrase for the file" type="password" value={restorePass} onChange={setRestorePass} />
        <label className="check">
          <input type="checkbox" checked={confirm} onChange={(event) => setConfirm(event.target.checked)} />
          Replace everything on this device with the backup
        </label>
        <button type="submit" className={canRestore ? 'btn block danger' : 'btn block dis'} disabled={!canRestore}>
          Restore
        </button>
        {restoreMsg !== '' && (
          <span role="status" className="hint">
            {restoreMsg}
          </span>
        )}
      </form>
    </section>
  );
}
