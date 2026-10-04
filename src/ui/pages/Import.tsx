import { useState } from 'react';
import '../styles/import.css';
import type { ImportState } from '../../services/importFlow';
import { useActions } from '../actions';
import { Field } from '../common/Field';
import { HistoryCard } from '../import/HistoryCard';
import { MappingCard } from '../import/MappingCard';
import { countRows, PreviewCard } from '../import/PreviewCard';
import { Icon } from '../Icon';
import { useAccounts, useSampleData } from '../hooks';
import { useImportFlow, type ImportFlow } from '../useImportFlow';
import { SOURCE_LABELS } from '../useImportHistory';
import type { SourceId } from '../../parsers';

/** 0 = choose, 1 = review, 2 = done: the three bars at the top. */
function stepIndex(state: ImportState): number {
  switch (state.step) {
    case 'preview':
    case 'committing':
      return 1;
    case 'done':
      return 2;
    default:
      return 0;
  }
}

const STEP_NAMES = ['Choose', 'Review', 'Done'];

function PasswordCard({ state, flow }: { state: Extract<ImportState, { step: 'need-password' }>; flow: ImportFlow }) {
  const [password, setPassword] = useState('');
  return (
    <form
      className="card stack gap16"
      onSubmit={(event) => {
        event.preventDefault();
        if (password !== '') flow.submitPassword(password);
      }}
    >
      <div>
        <h2 className="t-title">This file is locked</h2>
        <span className="sub">{state.fileName}</span>
      </div>
      <Field
        id="import-password"
        label={`Password for ${state.fileName}`}
        type="password"
        autoComplete="off"
        value={password}
        onChange={setPassword}
        error={state.wrong ? 'That password didn’t work. Try again.' : undefined}
        hint="Statement passwords are often your PAN or date of birth."
      />
      <button type="submit" className={password === '' ? 'btn block dis' : 'btn block fill'} disabled={password === ''}>
        Unlock
      </button>
      <button type="button" className="btn block text" onClick={flow.reset}>
        Cancel
      </button>
    </form>
  );
}

function SourceCard({ state, flow }: { state: Extract<ImportState, { step: 'choose-source' }>; flow: ImportFlow }) {
  return (
    <section className="card flat" aria-labelledby="src-h">
      <div style={{ padding: 16 }}>
        <h2 id="src-h" className="t-title">
          What kind of file is this?
        </h2>
        <span className="sub">{state.reason}</span>
      </div>
      <ul className="list">
        {(Object.keys(SOURCE_LABELS) as SourceId[])
          .filter((source) => source !== 'generic')
          .map((source) => (
          <li key={source}>
            <button type="button" className="row" onClick={() => flow.chooseSource(source)}>
              <span className="mid">
                <span className="ttl">{SOURCE_LABELS[source]}</span>
              </span>
              <span className="chev">
                <Icon name="chevron" size={20} />
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div style={{ padding: 8 }}>
        <button type="button" className="row" onClick={() => flow.chooseSource('generic')}>
          <span className="mid">
            <span className="ttl">CSV or Excel — map columns</span>
            <span className="sub">Any bank export. You pick the date, description and amount columns.</span>
          </span>
          <span className="chev">
            <Icon name="chevron" size={20} />
          </span>
        </button>
        <button type="button" className="btn block text" onClick={flow.reset}>
          Cancel
        </button>
      </div>
    </section>
  );
}

/** Pick statements, review what they hold, save them, and undo past imports. */
export function Import() {
  const flow = useImportFlow();
  const { state } = flow;
  const sample = useSampleData();
  const accounts = useAccounts();
  const actions = useActions();
  const [sampleBusy, setSampleBusy] = useState(false);
  const showSampleButton = sample.data !== true && (accounts.data?.length ?? 0) === 0;
  const active = stepIndex(state);
  const busy = state.step === 'reading' || state.step === 'committing';
  const empty = state.step === 'idle';

  return (
    <div className="import-page">
      <div>
        <div className="steps" aria-hidden="true">
          {STEP_NAMES.map((name, i) => (
            <i key={name} className={i <= active ? 'on' : ''} />
          ))}
        </div>
        <span className="cap">
          Step {active + 1} of 3 · {STEP_NAMES[active]}
        </span>
      </div>
      <p className="sr" data-testid="import-step">
        {state.step}
      </p>

      {empty && (
        <section className="dropzone" aria-labelledby="drop-h">
          <span className="lead acc" style={{ width: 56, height: 56, borderRadius: 28 }}>
            <Icon name="upload" size={28} />
          </span>
          <h2 id="drop-h" className="t-title">
            Add your statements
          </h2>
          <p className="muted" style={{ maxWidth: 280 }}>
            PDFs, or a CSV/Excel export if your bank isn’t on the list. Several at once is fine.
          </p>
          <label className="drop-label">
            Choose files
            <input
              type="file"
              multiple
              accept=".pdf,.xlsx,.csv,application/pdf,text/csv"
              aria-label="Choose statements"
              onChange={(event) => {
                void flow.pickFiles(Array.from(event.target.files ?? []));
                event.target.value = '';
              }}
            />
          </label>
          <span className="hint">
            <Icon name="lock" size={14} /> Read on this device. Nothing is uploaded.
          </span>
          {showSampleButton && (
            <button
              type="button"
              className="btn out"
              style={{ marginTop: 8 }}
              disabled={sampleBusy}
              onClick={() => {
                setSampleBusy(true);
                void actions.loadSampleData().finally(() => setSampleBusy(false));
              }}
            >
              {sampleBusy ? 'Loading sample…' : 'Try with sample data'}
            </button>
          )}
        </section>
      )}

      {flow.queue.length > 0 && (
        <div className="note" data-testid="import-queue">
          <Icon name="info" size={20} />
          <span>Up next: {flow.queue.join(', ')}</span>
        </div>
      )}

      {busy && (
        <section className="card" role="status" aria-busy="true">
          <h2 className="t-title">{state.step === 'reading' ? `Reading ${state.fileName}…` : 'Saving…'}</h2>
          <div className="sk" style={{ height: 8, marginTop: 12 }} />
        </section>
      )}

      {state.step === 'need-password' && <PasswordCard state={state} flow={flow} />}
      {state.step === 'choose-source' && <SourceCard state={state} flow={flow} />}
      {state.step === 'map-columns' && <MappingCard state={state} flow={flow} />}
      {state.step === 'preview' && <PreviewCard state={state} flow={flow} />}

      {state.step === 'done' && (
        <section className="card" role="status" aria-labelledby="done-h">
          <div className="row-between" style={{ justifyContent: 'flex-start' }}>
            <span className="lead good">
              <Icon name="check" size={22} />
            </span>
            <h2 id="done-h" className="t-title">
              Saved
            </h2>
          </div>
          <div style={{ margin: '8px 0 12px' }}>
            {countRows(state.counts).map((row) => (
              <div key={row.key} className="kv">
                <span className="k">{row.label}</span>
                <span className="v">{row.value}</span>
              </div>
            ))}
          </div>
          <button type="button" className="btn block fill" onClick={flow.reset}>
            {flow.queue.length > 0 ? 'Next file' : 'Done'}
          </button>
        </section>
      )}

      {state.step === 'error' && (
        <section className="stack gap12">
          <div className="note bad" role="alert">
            <Icon name="alert" size={20} />
            <span>{state.message}</span>
          </div>
          <button type="button" className="btn block tonal" onClick={flow.reset}>
            {flow.queue.length > 0 ? 'Next file' : 'Try another file'}
          </button>
        </section>
      )}

      <HistoryCard />
    </div>
  );
}
