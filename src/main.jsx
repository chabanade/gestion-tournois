// @ts-check
import { render } from 'preact';
import { App } from './ui/app.jsx';
import { initDark } from './ui/theme.js';
import './styles/theme.css';
import './styles/print.css';

initDark();

const root = document.getElementById('app');
if (root) render(<App />, root);

// Enregistrement du service worker (PWA offline) — injecté par vite-plugin-pwa.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true })).catch(() => {});
  });
}
