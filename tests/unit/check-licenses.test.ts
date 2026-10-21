import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { checkLicenses, isAllowed } from '../../scripts/check-licenses.mjs';

const thirdParty = '## alpha\nVersion: 1\n\n## beta\nVersion: 1\n';
const allMit = { MIT: [{ name: 'alpha' }, { name: 'beta' }] };
const withGpl = { MIT: [{ name: 'alpha' }], 'GPL-3.0': [{ name: 'beta' }] };

describe('checkLicenses', () => {
  test('passes an all-MIT list', () => {
    expect(checkLicenses(allMit, thirdParty)).toEqual([]);
  });

  test('rejects a GPL-3.0 package', () => {
    const problems = checkLicenses(withGpl, thirdParty);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('beta');
  });

  test('rejects a package missing from THIRD-PARTY-LICENSES.txt', () => {
    const problems = checkLicenses(allMit, '## alpha\n');
    expect(problems).toEqual(['beta: missing from THIRD-PARTY-LICENSES.txt']);
  });

  test('handles SPDX expressions', () => {
    expect(isAllowed('(MIT OR GPL-3.0)')).toBe(true);
    expect(isAllowed('MIT AND GPL-3.0')).toBe(false);
    expect(isAllowed('UNLICENSED')).toBe(false);
  });
});

describe('check-licenses CLI', () => {
  const dir = mkdtempSync(join(tmpdir(), 'licenses-'));
  writeFileSync(join(dir, 'third-party.txt'), thirdParty);
  writeFileSync(join(dir, 'mit.json'), JSON.stringify(allMit));
  writeFileSync(join(dir, 'gpl.json'), JSON.stringify(withGpl));
  const run = (json: string) =>
    spawnSync(
      process.execPath,
      ['scripts/check-licenses.mjs', '--licenses', join(dir, json), '--third-party', join(dir, 'third-party.txt')],
      { encoding: 'utf8' },
    );

  test('exits 0 for an all-MIT list', () => {
    expect(run('mit.json').status).toBe(0);
  });

  test('exits 1 for a GPL-3.0 package', () => {
    expect(run('gpl.json').status).toBe(1);
  });
});
