// Shared styles first, so each screen's own CSS (imported by its component) can override them.
import './ui/styles/tokens.css';
import './ui/styles/components.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './pwa/pdfWorker';
import { startOnOpen } from './pwa/startup';
import { db } from './ui/db';
import { UpdateBanner } from './ui/shell/UpdateBanner';

startOnOpen(db);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App>
      <UpdateBanner />
    </App>
  </StrictMode>,
);
