import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
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

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

// Files the worker must not precache: itself, host config, and the e2e-only harness.
const NOT_PRECACHED = (path: string) =>
  path === 'sw.js' || path === '_headers' || path.startsWith('e2e/') || /harness/.test(path);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

// Fills the tokens in dist/sw.js with the cache version and the list of every built file, so
// offline works for the exact build that was deployed. The AAC encoder chunk is included even
// though it loads lazily: a browser that needs it must still be able to export offline.
function precacheList(): Plugin {
  let outDir = 'dist';
  return {
    name: 'precache-list',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    writeBundle() {
      const files = walk(outDir)
        .map((full) => relative(outDir, full).split(sep).join('/'))
        .filter((path) => !NOT_PRECACHED(path))
        .sort();
      const urls = ['./', ...files.map((path) => `./${path}`)];
      const hash = createHash('sha256');
      for (const path of files) hash.update(path).update(readFileSync(join(outDir, path)));
      const version = `${pkg.version}-${hash.digest('hex').slice(0, 10)}`;
      const swPath = join(outDir, 'sw.js');
      const sw = readFileSync(swPath, 'utf8')
        .replace('__VM_VERSION__', version)
        .replace('__VM_PRECACHE__', urls.join('\\n'));
      writeFileSync(swPath, sw);
    },
  };
}

// Stamps the footer with package.json's version, the single version source.
function appVersion(): Plugin {
  return {
    name: 'app-version',
    transformIndexHtml: (html) => html.replaceAll('__VM_APP_VERSION__', pkg.version),
  };
}

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: {
    assetsInlineLimit: 0,
    // e2e-only second entry; absent from the deployed build.
    rollupOptions:
      process.env.VM_E2E === '1'
        ? {
            input: {
              main: fileURLToPath(new URL('./index.html', import.meta.url)),
              harness: fileURLToPath(new URL('./e2e/harness.html', import.meta.url)),
            },
          }
        : undefined,
  },
  plugins: [shipLicences(), precacheList(), appVersion()],
});
