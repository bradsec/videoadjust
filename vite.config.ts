import { readFileSync } from 'node:fs';
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
  build: { assetsInlineLimit: 0 },
  plugins: [shipLicences()],
});
