import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './ui/styles/tokens.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
