import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_FILE_BYTES = 26_214_400;

export function oversizedFiles(dist) {
  const problems = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.isFile()) {
        const bytes = statSync(path).size;
        if (bytes > MAX_FILE_BYTES) problems.push({ path: relative(dist, path), bytes });
      }
    }
  }
  walk(dist);
  return problems.sort((a, b) => a.path.localeCompare(b.path));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dist = fileURLToPath(new URL('../dist', import.meta.url));
  const problems = oversizedFiles(dist);
  if (problems.length) {
    console.error(
      'check:size failed:\n' +
        problems.map(({ path, bytes }) => `  ${path}: ${bytes} bytes`).join('\n'),
    );
    process.exit(1);
  }
  console.log(`check:size ok: all dist files are at most ${MAX_FILE_BYTES} bytes`);
}
