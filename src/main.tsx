import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './i18n/index';
import App from './App.tsx';
import { initPwaAutoUpdate } from './lib/pwaUpdate';

// Register the service worker + aggressive update checks so an installed
// (home-screen) PWA always loads the newest deploy without re-installing.
// Called once at module scope (outside the React tree) so StrictMode's
// double-render doesn't register it twice.
initPwaAutoUpdate();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
