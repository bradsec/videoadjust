import { BufferTarget, StreamTarget, type StreamTargetChunk, type Target } from 'mediabunny';

export type SinkPlan = { kind: 'file-stream' } | { kind: 'memory'; warn: boolean };

// Share of device memory the in-memory output may take before the user is warned.
export const MEMORY_WARN_FRACTION = 0.25;
const ASSUMED_DEVICE_MEMORY_GB = 2;
const GIB = 1024 ** 3;

export function chooseSink(opts: {
  estimateBytes: number;
  fileStreamSave: boolean;
  deviceMemoryGB?: number;
}): SinkPlan {
  if (opts.fileStreamSave) return { kind: 'file-stream' };
  const memoryGB = opts.deviceMemoryGB ?? ASSUMED_DEVICE_MEMORY_GB;
  return { kind: 'memory', warn: opts.estimateBytes > MEMORY_WARN_FRACTION * memoryGB * GIB };
}

export interface OpenSink {
  target: Target;
  /** The in-memory output, or null for a file stream (the bytes are already on disk). */
  finish(): Promise<Blob | null>;
  /** Discard a file-stream output instead of committing it; a no-op for memory. */
  abort(): Promise<void>;
}

const EXTENSIONS: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/wav': '.wav',
  'image/gif': '.gif',
};

export interface GifSink {
  finish(bytes: Uint8Array): Promise<Blob | null>;
  abort(): Promise<void>;
}

export async function openGifSink(plan: SinkPlan, suggestedName: string): Promise<GifSink> {
  if (plan.kind === 'memory') {
    return {
      async finish(bytes) {
        return new Blob([new Uint8Array(bytes)], { type: 'image/gif' });
      },
      async abort() {},
    };
  }
  if (!window.showSaveFilePicker) throw new Error('This browser cannot save files directly.');
  const handle = await window.showSaveFilePicker({
    suggestedName,
    types: [{ accept: { 'image/gif': ['.gif'] } }],
  });
  const writable = await handle.createWritable();
  let closed = false;
  return {
    async finish(bytes) {
      await writable.write(new Uint8Array(bytes));
      await writable.close();
      closed = true;
      return null;
    },
    async abort() {
      if (closed) return;
      closed = true;
      try {
        await writable.abort();
      } catch (err) {
        console.warn('discarding the output file failed', err);
      }
    },
  };
}

export async function openSink(
  plan: SinkPlan,
  suggestedName: string,
  mime: string,
): Promise<OpenSink> {
  if (plan.kind === 'memory') {
    const target = new BufferTarget();
    return {
      target,
      async finish() {
        if (!target.buffer) throw new Error('Output was not finalized before reading the buffer.');
        return new Blob([target.buffer], { type: mime });
      },
      async abort() {},
    };
  }

  if (!window.showSaveFilePicker) throw new Error('This browser cannot save files directly.');
  const extension = EXTENSIONS[mime];
  // A cancelled picker rejects with AbortError; the caller decides how to treat that.
  const handle = await window.showSaveFilePicker({
    suggestedName,
    types: extension ? [{ accept: { [mime]: [extension] } }] : undefined,
  });
  const file = (await handle.createWritable()) as unknown as WritableStream<StreamTargetChunk>;
  const fileWriter = file.getWriter();
  let aborted = false;
  // Mediabunny closes its writer on cancel as well as on success, and closing a
  // FileSystemWritableFileStream commits whatever was written. This wrapper turns that
  // close into a no-op once abort() has run, so a canceled export is discarded instead.
  const writable = new WritableStream<StreamTargetChunk>({
    write: (chunk) => fileWriter.write(chunk),
    close: () => (aborted ? undefined : fileWriter.close()),
    abort: (reason) => fileWriter.abort(reason),
  });
  return {
    target: new StreamTarget(writable, { chunked: true }),
    async finish() {
      return null;
    },
    async abort() {
      if (aborted) return;
      aborted = true;
      try {
        await fileWriter.abort();
      } catch (err) {
        // Already closed or errored: nothing more can be undone, and the caller tells the
        // user a partial file may remain.
        console.warn('discarding the output file failed', err);
      }
    },
  };
}
