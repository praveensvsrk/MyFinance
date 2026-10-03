import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './pwa/pdfWorker';
import { UpdateBanner } from './ui/shell/UpdateBanner';
import './ui/styles/tokens.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App>
      <UpdateBanner />
    </App>
  </StrictMode>,
);
