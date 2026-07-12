import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './i18n/index';
import App from './App.tsx';
import { initPwaAutoUpdate } from './lib/pwaUpdate';

initPwaAutoUpdate();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
