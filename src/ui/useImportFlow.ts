import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { ParseOptions, SourceId } from '../parsers';
import { takeSharedFiles } from '../pwa/shareInbox';
import { canCommit, reduce, runCommit, runPreview, type ImportState } from '../services/importFlow';
import { useApp } from './AppContext';

interface QueuedFile {
  name: string;
  bytes: Uint8Array;
}

export interface ImportFlow {
  state: ImportState;
  /** Names of the files still waiting behind the current one. */
  queue: string[];
  canCommit: boolean;
  pickFiles: (files: File[]) => Promise<void>;
  submitPassword: (password: string) => void;
  chooseSource: (source: SourceId) => void;
  assign: (bankTxnId: string, schemeKey: string) => void;
  toggleSavePassword: () => void;
  toggleUnverified: () => void;
  commit: () => void;
  /** Leaves the current result and moves on to the next queued file, if any. */
  reset: () => void;
}

/**
 * Drives the import screen (§6.6): files from the picker or the share inbox are processed one at a
 * time (an email can carry several attachments) through the pure reducer in `importFlow.ts`.
 */
export function useImportFlow(): ImportFlow {
  const { db, refresh } = useApp();
  const [state, dispatch] = useReducer(reduce, { step: 'idle' } as ImportState);
  // The ref is the source of truth so effects that run twice (StrictMode) cannot start a file twice.
  const queueRef = useRef<QueuedFile[]>([]);
  const [queue, setQueue] = useState<string[]>([]);
  const [arrivals, setArrivals] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const enqueue = useCallback((files: QueuedFile[]) => {
    if (files.length === 0) return;
    queueRef.current.push(...files);
    setQueue(queueRef.current.map((file) => file.name));
    setArrivals((count) => count + 1);
  }, []);

  const preview = useCallback(
    async (fileName: string, bytes: Uint8Array, opts: ParseOptions) => {
      const event = await runPreview(db, bytes, fileName, opts);
      if (alive.current) dispatch(event);
    },
    [db],
  );

  // Start the next queued file whenever the flow is idle.
  useEffect(() => {
    if (state.step !== 'idle') return;
    const next = queueRef.current.shift();
    if (next === undefined) return;
    setQueue(queueRef.current.map((file) => file.name));
    dispatch({ type: 'picked', fileName: next.name });
    void preview(next.name, next.bytes, {});
  }, [state.step, arrivals, preview]);

  // Files shared to the installed app are waiting in the inbox when it opens.
  useEffect(() => {
    void takeSharedFiles()
      .then((files) => {
        if (alive.current) enqueue(files);
      })
      .catch(() => undefined);
  }, [enqueue]);

  const pickFiles = useCallback(
    async (files: File[]) => {
      const read = await Promise.all(
        files.map(async (file) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })),
      );
      enqueue(read);
    },
    [enqueue],
  );

  const submitPassword = useCallback(
    (password: string) => {
      if (state.step !== 'need-password') return;
      const { fileName, bytes } = state;
      dispatch({ type: 'password-submitted', password });
      void preview(fileName, bytes, { password });
    },
    [state, preview],
  );

  const chooseSource = useCallback(
    (source: SourceId) => {
      if (state.step !== 'choose-source') return;
      const { fileName, bytes } = state;
      dispatch({ type: 'source-chosen', source });
      void preview(fileName, bytes, { forceSource: source });
    },
    [state, preview],
  );

  const commit = useCallback(() => {
    if (state.step !== 'preview' || !canCommit(state)) return;
    const current = state;
    dispatch({ type: 'commit-started' });
    void runCommit(db, current).then((event) => {
      if (event.type === 'commit-finished') refresh();
      if (alive.current) dispatch(event);
    });
  }, [state, db, refresh]);

  return {
    state,
    queue,
    canCommit: canCommit(state),
    pickFiles,
    submitPassword,
    chooseSource,
    assign: (bankTxnId, schemeKey) => dispatch({ type: 'assign', bankTxnId, schemeKey }),
    toggleSavePassword: () => dispatch({ type: 'toggle-save-password' }),
    toggleUnverified: () => dispatch({ type: 'toggle-unverified' }),
    commit,
    reset: () => dispatch({ type: 'reset' }),
  };
}
