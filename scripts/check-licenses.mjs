#!/usr/bin/env node
// Fails when a production dependency has a licence outside the allowlist or
// has no entry ("## <name>") in THIRD-PARTY-LICENSES.txt.
// Usage: node scripts/check-licenses.mjs [--licenses <json file>] [--third-party <file>]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ALLOWED = new Set([
  'MIT',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'Apache-2.0',
  '0BSD',
  'MPL-2.0',
]);

// An SPDX expression passes when every AND term has at least one allowed OR choice.
export function isAllowed(expression) {
  return expression
    .replace(/[()]/g, '')
    .split(/\s+AND\s+/)
    .every((term) => term.split(/\s+OR\s+/).some((id) => ALLOWED.has(id.trim())));
}

/**
 * @param {Record<string, Array<{ name: string, versions?: string[] }>>} licenses
 *   output of `pnpm licenses list --prod --json` (licence name -> packages)
 * @param {string} thirdPartyText contents of THIRD-PARTY-LICENSES.txt
 * @returns {string[]} problems; empty when everything passes
 */
export function checkLicenses(licenses, thirdPartyText) {
  const listed = new Set(
    thirdPartyText
      .split('\n')
      .filter((line) => line.startsWith('## '))
      .map((line) => line.slice(3).trim()),
  );
  const problems = [];
  for (const [license, packages] of Object.entries(licenses)) {
    for (const pkg of packages) {
      if (!isAllowed(license)) {
        problems.push(`${pkg.name}: licence "${license}" is not in the allowlist`);
      }
      if (!listed.has(pkg.name)) {
        problems.push(`${pkg.name}: missing from THIRD-PARTY-LICENSES.txt`);
      }
    }
  }
  return problems;
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

function main() {
  const licensesFile = arg('--licenses');
  const raw = licensesFile
    ? readFileSync(licensesFile, 'utf8')
    : execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], { encoding: 'utf8' });
  const thirdParty = readFileSync(
    arg('--third-party') ?? new URL('../THIRD-PARTY-LICENSES.txt', import.meta.url),
    'utf8',
  );
  const problems = checkLicenses(JSON.parse(raw), thirdParty);
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  console.log('licence check passed');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
