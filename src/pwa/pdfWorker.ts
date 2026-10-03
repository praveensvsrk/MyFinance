/**
 * Points pdf.js at its worker script. Vite emits the worker as a hashed asset and the service
 * worker precaches it, so PDF parsing also works offline. Imported once from `main.tsx`.
 */
import { GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;
