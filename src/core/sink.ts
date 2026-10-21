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

const EXTENSIONS: Record<string, string> = { 'video/mp4': '.mp4', 'video/webm': '.webm' };

export async function openSink(
  plan: SinkPlan,
  suggestedName: string,
  mime: string,
): Promise<{ target: Target; finish(): Promise<Blob | null> }> {
  if (plan.kind === 'memory') {
    const target = new BufferTarget();
    return {
      target,
      async finish() {
        if (!target.buffer) throw new Error('Output was not finalized before reading the buffer.');
        return new Blob([target.buffer], { type: mime });
      },
    };
  }

  if (!window.showSaveFilePicker) throw new Error('This browser cannot save files directly.');
  const extension = EXTENSIONS[mime];
  // A cancelled picker rejects with AbortError; the caller decides how to treat that.
  const handle = await window.showSaveFilePicker({
    suggestedName,
    types: extension ? [{ accept: { [mime]: [extension] } }] : undefined,
  });
  const writable = (await handle.createWritable()) as unknown as WritableStream<StreamTargetChunk>;
  return {
    target: new StreamTarget(writable, { chunked: true }),
    async finish() {
      return null;
    },
  };
}
