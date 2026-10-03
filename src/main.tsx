import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './pwa/pdfWorker';
import { startOnOpen } from './pwa/startup';
import { db } from './ui/db';
import { UpdateBanner } from './ui/shell/UpdateBanner';
import './ui/styles/tokens.css';
import './ui/styles/components.css';

startOnOpen(db);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App>
      <UpdateBanner />
    </App>
  </StrictMode>,
);
