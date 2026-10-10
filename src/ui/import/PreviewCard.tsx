import type { TxnRow } from '../../db/schema';
import type { PreviewStep } from '../../services/importFlow';
import { dateLong, dateShort } from '../format';
import { Icon } from '../Icon';
import { useMf } from '../hooks';
import { merchantOf } from '../common/TxnItem';
import { Money } from '../Money';
import { SOURCE_LABELS } from '../useImportHistory';
import type { ImportFlow } from '../useImportFlow';

const COUNT_LABELS: Record<string, string> = {
  transactions: 'Transactions',
  snapshots: 'Balances',
  prices: 'Prices',
  epfEntries: 'EPF entries',
  loanEntries: 'Loan entries',
  loanYears: 'Loan years',
  mfTxns: 'Fund transactions',
  mfFolios: 'Funds',
  vests: 'Vests',
  equityLots: 'Share lots',
  equityGrants: 'Grants',
};

/** Counts as readable rows, skipping zeros. */
export function countRows(counts: Record<string, number>): { key: string; label: string; value: number }[] {
  return Object.entries(counts)
    .filter(([, value]) => value > 0)
    .map(([key, value]) => ({ key, label: COUNT_LABELS[key] ?? key, value }));
}

function Ambiguous({ state, flow }: { state: PreviewStep; flow: ImportFlow }) {
  const mf = useMf();
  const bankTxns = (state.preview.mapped.tables.transactions ?? []) as TxnRow[];
  const nameOf = (key: string) => mf.data?.schemes.find((scheme) => scheme.folioId === key)?.scheme ?? key;
  return (
    <section className="card" aria-labelledby="amb-h">
      <h2 id="amb-h" className="t-title">
        Which fund did these go to?
      </h2>
      <span className="sub">Investments, but more than one fund fits each.</span>
      {state.preview.ambiguous.map((debit) => {
        const txn = bankTxns.find((row) => row.id === debit.bankTxnId);
        const fieldId = `amb-${debit.bankTxnId}`;
        return (
          <div key={debit.bankTxnId} className="field" style={{ marginTop: 14 }}>
            <label htmlFor={fieldId}>
              {txn === undefined ? 'Debit' : `${dateShort(txn.date)} · ${merchantOf(txn.description)} · `}
              {txn !== undefined && <Money paise={-txn.amount} compact />}
            </label>
            <div className="inp">
              <select
                id={fieldId}
                className="sel-in"
                value={state.assignments[debit.bankTxnId] ?? ''}
                onChange={(event) => flow.assign(debit.bankTxnId, event.target.value)}
              >
                <option value="" disabled>
                  Choose a fund
                </option>
                {debit.candidates.map((key) => (
                  <option key={key} value={key}>
                    {nameOf(key)}
                  </option>
                ))}
                <option value="unassigned">Not sure yet</option>
              </select>
            </div>
          </div>
        );
      })}
    </section>
  );
}

/** What a file would add, how it checked out, and the choices needed before it can be saved. */
export function PreviewCard({ state, flow }: { state: PreviewStep; flow: ImportFlow }) {
  const { preview } = state;
  const summary = preview.mapped.summary;
  const failed = preview.validation.checks.filter((check) => !check.ok);

  return (
    <div data-testid="import-preview" className="stack gap16">
      <section className="card" aria-labelledby="pv-h">
        <div className="row-between" style={{ alignItems: 'flex-start' }}>
          <span style={{ minWidth: 0 }}>
            <h2 id="pv-h" className="t-title" style={{ wordBreak: 'break-word' }}>
              {state.fileName}
            </h2>
            <span className="sub">
              {SOURCE_LABELS[preview.source]} · {dateShort(summary.period[0])} {summary.period[0].slice(0, 4)} to{' '}
              {dateLong(summary.period[1])}
            </span>
          </span>
          <span className={preview.validation.ok ? 'tag good' : 'tag bad'}>{preview.validation.ok ? 'Checks passed' : 'Checks failed'}</span>
        </div>
        <div style={{ marginTop: 8 }}>
          {countRows(summary.counts).map((row) => (
            <div key={row.key} className="kv">
              <span className="k">{row.label}</span>
              <span className="v">{row.value}</span>
            </div>
          ))}
          {summary.duplicates > 0 && (
            <div className="kv">
              <span className="k">Already saved, skipped</span>
              <span className="v">{summary.duplicates}</span>
            </div>
          )}
        </div>
      </section>

      {preview.alreadyImported && (
        <div className="note warn" role="status">
          <Icon name="info" size={20} />
          <span>This file was already imported; nothing new to save.</span>
        </div>
      )}

      {failed.length > 0 && (
        <section className="card" aria-labelledby="chk-h">
          <h2 id="chk-h" className="t-title" style={{ marginBottom: 6 }}>
            Failed checks
          </h2>
          {failed.map((check) => (
            <div key={check.name} className="kv" style={{ alignItems: 'flex-start' }}>
              <span className="k">{check.name}</span>
              <span className="v res-bad" style={{ whiteSpace: 'normal', textAlign: 'right' }}>
                Expected {String(check.expected)}, found {String(check.actual)}
              </span>
            </div>
          ))}
          <label className="check" style={{ marginTop: 8 }}>
            <input type="checkbox" checked={state.unverified} onChange={flow.toggleUnverified} />
            Save anyway, marked as unverified
          </label>
        </section>
      )}

      {preview.validation.notes.length > 0 && (
        <div className="note">
          <Icon name="info" size={20} />
          <span>{preview.validation.notes.join(' ')}</span>
        </div>
      )}

      {preview.ambiguous.length > 0 && <Ambiguous state={state} flow={flow} />}

      <button type="button" className={flow.canCommit ? 'btn block fill' : 'btn block dis'} disabled={!flow.canCommit} onClick={flow.commit}>
        Import
      </button>
      <button type="button" className="btn block text" onClick={flow.reset}>
        Cancel
      </button>
    </div>
  );
}
