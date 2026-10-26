import './styles/tokens.css';
import './styles/shell.css';
import './styles/controls.css';
import './styles/workspace.css';
import './styles/editor.css';
import './styles/inspector.css';
import './styles/result.css';
import './styles/responsive.css';
import { canEncodeVideo } from 'mediabunny';
import { ensureMp3Encoder, probeCapabilities } from './core/capabilities';
import { startConversion } from './core/convert';
import { openSink } from './core/sink';
import { readSource } from './core/source';
import { createApp } from './ui/app';

// The About dialog is static markup; a click on the backdrop (the dialog box itself, outside
// its form) closes it like Escape does.
const about = document.querySelector<HTMLDialogElement>('#about-dialog')!;
document.querySelector('.about-link')!.addEventListener('click', () => about.showModal());
about.addEventListener('click', (event) => {
  if (event.target === about) about.close();
});

const help = document.querySelector<HTMLDialogElement>('#help-dialog')!;
const helpButton = document.querySelector<HTMLButtonElement>('.help-link')!;
helpButton.addEventListener('click', () => help.showModal());
help.addEventListener('click', (event) => {
  if (event.target === help) help.close();
});
help.addEventListener('close', () => helpButton.focus());

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
  canEncodeVideo,
  readSource,
  startConversion,
  openSink,
  ensureMp3Encoder,
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
