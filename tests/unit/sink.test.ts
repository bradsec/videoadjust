import { describe, expect, test } from 'vitest';
import { chooseSink, MEMORY_WARN_FRACTION } from '../../src/core/sink';

const MB = 1024 * 1024;
const GB = 1024 * MB;

describe('chooseSink', () => {
  test('streams to a file when the browser supports it', () => {
    expect(chooseSink({ estimateBytes: 5 * GB, fileStreamSave: true, deviceMemoryGB: 4 })).toEqual({
      kind: 'file-stream',
    });
  });

  test('small output without file streaming stays in memory without a warning', () => {
    expect(chooseSink({ estimateBytes: 100 * MB, fileStreamSave: false, deviceMemoryGB: 4 })).toEqual({
      kind: 'memory',
      warn: false,
    });
  });

  test('large output without file streaming warns', () => {
    expect(chooseSink({ estimateBytes: 1.5 * GB, fileStreamSave: false, deviceMemoryGB: 4 })).toEqual({
      kind: 'memory',
      warn: true,
    });
  });

  test('unknown device memory is assumed to be 2 GB', () => {
    const limit = MEMORY_WARN_FRACTION * 2 * GB;
    expect(chooseSink({ estimateBytes: limit - 1, fileStreamSave: false })).toEqual({ kind: 'memory', warn: false });
    expect(chooseSink({ estimateBytes: limit + 1, fileStreamSave: false })).toEqual({ kind: 'memory', warn: true });
  });
});
