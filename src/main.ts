import { probeCapabilities } from './core/capabilities';

// Probe results go on a data attribute rather than a global so the production
// build that e2e runs against can be inspected without a debug-only code path.
probeCapabilities().then(
  (caps) => {
    document.documentElement.dataset.caps = JSON.stringify(caps);
  },
  (err: unknown) => console.error('capability probe failed', err),
);
