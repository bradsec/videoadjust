import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

// THIRD-PARTY-LICENSES.txt stays at the repo root (scripts/check-licenses.mjs reads it there)
// and ships with the site at ./THIRD-PARTY-LICENSES.txt.
const LICENCES = 'THIRD-PARTY-LICENSES.txt';
const licencesFile = new URL(`./${LICENCES}`, import.meta.url);

function shipLicences(): Plugin {
  return {
    name: 'ship-licences',
    configureServer(server) {
      server.middlewares.use(`/${LICENCES}`, (_req, res) => {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(readFileSync(licencesFile));
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: LICENCES, source: readFileSync(licencesFile) });
    },
  };
}

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: {
    assetsInlineLimit: 0,
    // e2e-only second entry; absent from the deployed build.
    rollupOptions:
      process.env.VR_E2E === '1'
        ? { input: { main: fileURLToPath(new URL('./index.html', import.meta.url)), harness: fileURLToPath(new URL('./e2e/harness.html', import.meta.url)) } }
        : undefined,
  },
  plugins: [shipLicences()],
});
