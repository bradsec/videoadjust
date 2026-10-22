import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES, oversizedFiles } from '../../scripts/check-size.mjs';

const dirs: string[] = [];

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'videoadjust-size-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('check:size', () => {
  it('accepts files at or below 25 MiB, including nested files', () => {
    const dir = fixture();
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'assets', 'limit.bin'), Buffer.alloc(MAX_FILE_BYTES));
    writeFileSync(join(dir, 'small.txt'), 'ok');
    expect(oversizedFiles(dir)).toEqual([]);
  });

  it('reports every file over 25 MiB', () => {
    const dir = fixture();
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'assets', 'large.bin'), Buffer.alloc(MAX_FILE_BYTES + 1));
    writeFileSync(join(dir, 'another.bin'), Buffer.alloc(MAX_FILE_BYTES + 10));
    expect(oversizedFiles(dir)).toEqual([
      { path: 'another.bin', bytes: MAX_FILE_BYTES + 10 },
      { path: join('assets', 'large.bin'), bytes: MAX_FILE_BYTES + 1 },
    ]);
  });
});
