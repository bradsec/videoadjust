import { afterEach, describe, expect, test } from 'vitest';
import { chooseSink, MEMORY_WARN_FRACTION, openSink } from '../../src/core/sink';

const MB = 1024 * 1024;
const GB = 1024 * MB;

describe('chooseSink', () => {
  test('streams to a file when the browser supports it', () => {
    expect(chooseSink({ estimateBytes: 5 * GB, fileStreamSave: true, deviceMemoryGB: 4 })).toEqual({
      kind: 'file-stream',
    });
  });

  test('small output without file streaming stays in memory without a warning', () => {
    expect(
      chooseSink({ estimateBytes: 100 * MB, fileStreamSave: false, deviceMemoryGB: 4 }),
    ).toEqual({
      kind: 'memory',
      warn: false,
    });
  });

  test('large output without file streaming warns', () => {
    expect(
      chooseSink({ estimateBytes: 1.5 * GB, fileStreamSave: false, deviceMemoryGB: 4 }),
    ).toEqual({
      kind: 'memory',
      warn: true,
    });
  });

  test('unknown device memory is assumed to be 2 GB', () => {
    const limit = MEMORY_WARN_FRACTION * 2 * GB;
    expect(chooseSink({ estimateBytes: limit - 1, fileStreamSave: false })).toEqual({
      kind: 'memory',
      warn: false,
    });
    expect(chooseSink({ estimateBytes: limit + 1, fileStreamSave: false })).toEqual({
      kind: 'memory',
      warn: true,
    });
  });
});

describe('openSink abort', () => {
  function fakePicker() {
    const calls = { close: 0, abort: 0 };
    const writable = new WritableStream({
      close() {
        calls.close++;
      },
      abort() {
        calls.abort++;
      },
    });
    const handle = { createWritable: async () => writable };
    (globalThis as { window?: unknown }).window = { showSaveFilePicker: async () => handle };
    return calls;
  }

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  test('file-stream abort discards the file once, even if called twice', async () => {
    const calls = fakePicker();
    const sink = await openSink({ kind: 'file-stream' }, 'a-small.mp4', 'video/mp4');
    await sink.abort();
    await sink.abort();
    expect(calls).toEqual({ close: 0, abort: 1 });
  });

  test('a close after abort does not commit the file', async () => {
    const calls = fakePicker();
    const sink = await openSink({ kind: 'file-stream' }, 'a-small.mp4', 'video/mp4');
    await sink.abort();
    // Mediabunny closes its stream writer when an output is canceled.
    const writer = (sink.target as unknown as { _writable: WritableStream })._writable.getWriter();
    await writer.close();
    expect(calls).toEqual({ close: 0, abort: 1 });
  });

  test('memory abort is a no-op', async () => {
    const sink = await openSink({ kind: 'memory', warn: false }, 'a-small.mp4', 'video/mp4');
    await expect(sink.abort()).resolves.toBeUndefined();
  });
});
