import { useImportFlow } from '../useImportFlow';
import { useImportHistory } from '../useImportHistory';

/** Functional placeholder: drives the real import flow and history with unstyled markup (Plan 3B restyles it). */
export function Import() {
  const flow = useImportFlow();
  const history = useImportHistory();
  const { state } = flow;
  return (
    <section>
      <h2>Import</h2>
      <input
        type="file"
        multiple
        accept=".pdf,.xlsx,application/pdf"
        aria-label="Choose statements"
        onChange={(event) => {
          void flow.pickFiles(Array.from(event.target.files ?? []));
          event.target.value = '';
        }}
      />
      <p data-testid="import-step">{state.step}</p>
      {flow.queue.length > 0 && <p data-testid="import-queue">{flow.queue.join(', ')}</p>}
      {state.step === 'preview' && (
        <div data-testid="import-preview">
          <p>
            {state.fileName}: {state.preview.source}
            {state.preview.alreadyImported ? ' (already imported)' : ''}
          </p>
          <pre className="debug">{JSON.stringify(state.preview.mapped.summary, null, 2)}</pre>
          <button type="button" disabled={!flow.canCommit} onClick={flow.commit}>
            Import
          </button>
          <button type="button" onClick={flow.reset}>
            Cancel
          </button>
        </div>
      )}
      {state.step === 'need-password' && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const field = event.currentTarget.elements.namedItem('password') as HTMLInputElement;
            flow.submitPassword(field.value);
          }}
        >
          <label>
            Password for {state.fileName}
            <input name="password" type="password" />
          </label>
          <button type="submit">Unlock</button>
        </form>
      )}
      {state.step === 'choose-source' && <p>{state.reason}</p>}
      {state.step === 'error' && <p role="alert">{state.message}</p>}
      {(state.step === 'done' || state.step === 'error' || state.step === 'choose-source') && (
        <button type="button" onClick={flow.reset}>
          {flow.queue.length > 0 ? 'Next file' : 'Done'}
        </button>
      )}
      <h2>History</h2>
      <ul data-testid="import-history">
        {history.items.map((item) => (
          <li key={item.id}>
            {item.label} {item.periodFrom}–{item.periodTo}{' '}
            <button type="button" onClick={() => void history.undo(item.id)}>
              Undo
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
