import './styles/tokens.css';
import './styles/app.css';
import { probeCapabilities } from './core/capabilities';
import { startConversion } from './core/convert';
import { openSink } from './core/sink';
import { readSource } from './core/source';
import { createApp } from './ui/app';

const caps = probeCapabilities();

// Probe results go on a data attribute rather than a global so the production
// build that e2e runs against can be inspected without a debug-only code path.
caps.then(
  (c) => {
    document.documentElement.dataset.caps = JSON.stringify(c);
  },
  (err: unknown) => console.error('capability probe failed', err),
);

// The app reuses this probe: the same promise is handed back instead of probing twice.
createApp(document.getElementById('app')!, {
  probeCapabilities: () => caps,
  readSource,
  startConversion,
  openSink,
  deviceMemoryGB: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
});

// Production only: the dev server serves modules that a precache list cannot describe.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js', { scope: './' })
      .catch((err: unknown) => console.error('service worker registration failed', err));
  });
}
