// Test-only page. vite.config.ts builds it only when VA_E2E=1, so the deployed site has no harness.
import {
  ALL_FORMATS,
  BlobSource,
  CanvasSink,
  canEncodeAudio,
  canEncodeVideo,
  Input,
  StreamTarget,
  type StreamTargetChunk,
} from 'mediabunny';
import { AUDIO_FORMATS, type AudioExtractSettings } from '../src/core/audioExtract';
import { autoSettings } from '../src/core/autoSettings';
import { ensureMp3Encoder, probeCapabilities, registerAacFallback } from '../src/core/capabilities';
import {
  audioExtractJob,
  createAudioOutputFormat,
  createOutputFormat,
  shrinkJob,
  startConversion,
} from '../src/core/convert';
import { exportGif, type GifSettings } from '../src/core/gifExport';
import { chooseSink, openSink } from '../src/core/sink';
import { readSource, UnsupportedSourceError } from '../src/core/source';
import { applyTargetSize } from '../src/core/targetSize';
import type { Settings, SourceInfo, VideoCodecId } from '../src/core/types';

export type ReadResult =
  | { ok: true; info: SourceInfo }
  | { ok: false; error: { name: string; message: string; codec: string | null } };

export type ConvertResult =
  | {
      ok: true;
      output: SourceInfo;
      outputBytes: number;
      reportedBytes: number;
      lastProgress: number;
      pixelSamples?: [number, number, number][];
    }
  | { ok: false; error: { name: string; message: string } };

export type CancelAt = 'never' | 'immediately' | 'at-start' | 'mid-run';

export type StreamResult = ConvertResult & { closeCalls: number; abortCalls: number };

export type GifResult =
  | {
      ok: true;
      width: number;
      height: number;
      frames: number;
      outputBytes: number;
      lastProgress: number;
      pixelSamples: [number, number, number][];
    }
  | { ok: false; error: { name: string; message: string } };

const fileInput = document.getElementById('file') as HTMLInputElement;

// Decodes with Mediabunny rather than a <video> element, which can paint black before its first frame.
type PixelPoint = readonly [number, number];
const centrePoints: PixelPoint[] = [
  [0.1, 0.5],
  [0.5, 0.5],
  [0.9, 0.5],
];

async function sampleVideoPixels(
  blob: Blob,
  points = centrePoints,
): Promise<[number, number, number][]> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('Exported video has no video track');
    const frame = await new CanvasSink(track).getCanvas(await track.getFirstTimestamp());
    if (!frame) throw new Error('Exported video did not decode');
    const canvas = frame.canvas;
    const context = canvas.getContext('2d') as
      CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!context) throw new Error('Canvas 2D context is unavailable');
    return points.map(([fractionX, fractionY]) => {
      const x = Math.floor(canvas.width * fractionX);
      const y = Math.floor(canvas.height * fractionY);
      const pixel = context.getImageData(x, y, 1, 1).data;
      return [pixel[0], pixel[1], pixel[2]];
    });
  } finally {
    input.dispose();
  }
}

function inspectGif(bytes: Uint8Array): { width: number; height: number; frames: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = String.fromCharCode(...bytes.subarray(0, 6));
  if (signature !== 'GIF89a' && signature !== 'GIF87a') throw new Error('GIF header is missing');
  const width = view.getUint16(6, true);
  const height = view.getUint16(8, true);
  let offset = 13;
  const screen = bytes[10];
  if (screen & 0x80) offset += 3 * 2 ** ((screen & 7) + 1);
  let frames = 0;
  while (offset < bytes.length) {
    const block = bytes[offset++];
    if (block === 0x3b) break;
    if (block === 0x21) {
      offset++; // Extension label.
    } else if (block === 0x2c) {
      frames++;
      const packed = bytes[offset + 8];
      offset += 9;
      if (packed & 0x80) offset += 3 * 2 ** ((packed & 7) + 1);
      offset++; // LZW minimum code size.
    } else {
      throw new Error(`Unexpected GIF block ${block}`);
    }
    while (offset < bytes.length) {
      const length = bytes[offset++];
      if (length === 0) break;
      offset += length;
    }
  }
  return { width, height, frames };
}

async function sampleGifPixels(
  blob: Blob,
  points = centrePoints,
): Promise<[number, number, number][]> {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context is unavailable');
    context.drawImage(image, 0, 0);
    return points.map(([fractionX, fractionY]) => {
      const pixel = context.getImageData(
        Math.floor(canvas.width * fractionX),
        Math.floor(canvas.height * fractionY),
        1,
        1,
      ).data;
      return [pixel[0], pixel[1], pixel[2]];
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function selectedFile(): File {
  const file = fileInput.files?.[0];
  if (!file) throw new Error('No file selected in the harness');
  return file;
}

function failure(err: unknown): { ok: false; error: { name: string; message: string } } {
  const e = err as Error;
  return { ok: false, error: { name: e.name, message: e.message } };
}

async function ensureAudioEncoder(settings: Settings): Promise<void> {
  if (settings.audio?.codec === 'aac' && !settings.audio.copy && !(await canEncodeAudio('aac'))) {
    await registerAacFallback();
  }
}

const harness = {
  async exportGif(
    settings: GifSettings,
    transform?: Settings['transform'],
    overlays?: Settings['overlays'],
    points = centrePoints,
  ): Promise<GifResult> {
    let input: Input | undefined;
    try {
      const selected = selectedFile();
      const read = await readSource(selected);
      input = read.input;
      let lastProgress = 0;
      const bytes = await exportGif(
        input,
        read.info,
        settings,
        transform,
        new AbortController().signal,
        (progress) => {
          lastProgress = progress;
        },
        overlays,
      );
      const blob = new Blob([new Uint8Array(bytes)], { type: 'image/gif' });
      return {
        ok: true,
        ...inspectGif(bytes),
        outputBytes: bytes.byteLength,
        lastProgress,
        pixelSamples: await sampleGifPixels(blob, points),
      };
    } catch (err) {
      return failure(err);
    } finally {
      input?.dispose();
    }
  },
  async readSource(): Promise<ReadResult> {
    try {
      const { info } = await readSource(selectedFile());
      return { ok: true, info };
    } catch (err) {
      const e = err as Error;
      return {
        ok: false,
        error: {
          name: e.name,
          message: e.message,
          codec: err instanceof UnsupportedSourceError ? err.codec : null,
        },
      };
    }
  },
  chooseSink,
  canEncodeVideo(codec: VideoCodecId, width: number, height: number): Promise<boolean> {
    return canEncodeVideo(codec, { width, height });
  },

  // Converts the selected file into memory, then reads the output back to describe it.
  // cancelAt: 'never' runs to completion, 'immediately' cancels before init resolves,
  // 'at-start' cancels from the progress-0 callback that fires before the output starts,
  // 'mid-run' cancels from the first callback with progress above 0.
  async convertToMemory(
    settings: Settings,
    cancelAt: CancelAt = 'never',
    samplePixels = false,
    points = centrePoints,
  ): Promise<ConvertResult> {
    try {
      const { input, info: source } = await readSource(selectedFile());
      if (settings.targetSizeMB) {
        const caps = await probeCapabilities();
        settings = applyTargetSize(settings, autoSettings(source, caps), source);
      }
      await ensureAudioEncoder(settings);
      const mime = settings.container === 'webm' ? 'video/webm' : 'video/mp4';
      const sink = await openSink({ kind: 'memory', warn: false }, 'out', mime);
      let reportedBytes = 0;
      let lastProgress = 0;
      const job = startConversion({
        input,
        job: shrinkJob(settings, source),
        format: createOutputFormat(settings.container, 'memory'),
        target: sink.target,
        onProgress(p, bytes) {
          lastProgress = p;
          reportedBytes = bytes;
          if ((cancelAt === 'at-start' && p === 0) || (cancelAt === 'mid-run' && p > 0 && p < 1))
            void job.cancel();
        },
      });
      if (cancelAt === 'immediately') void job.cancel();
      await job.done;
      const blob = await sink.finish();
      if (!blob) throw new Error('Memory sink returned no blob');
      const { info } = await readSource(new File([blob], 'out', { type: mime }));
      const pixelSamples = samplePixels ? await sampleVideoPixels(blob, points) : undefined;
      return {
        ok: true,
        output: info,
        outputBytes: blob.size,
        reportedBytes,
        lastProgress,
        ...(pixelSamples ? { pixelSamples } : {}),
      };
    } catch (err) {
      return failure(err);
    }
  },

  // Converts into a StreamTarget over a counting WritableStream, standing in for the
  // file picker's FileSystemWritableFileStream, which Playwright cannot drive.
  async convertToCountingStream(settings: Settings): Promise<StreamResult> {
    let closeCalls = 0;
    let abortCalls = 0;
    const chunks: StreamTargetChunk[] = [];
    const writable = new WritableStream<StreamTargetChunk>({
      write(chunk) {
        chunks.push(chunk);
      },
      close() {
        closeCalls++;
      },
      abort() {
        abortCalls++;
      },
    });
    try {
      const { input, info: source } = await readSource(selectedFile());
      if (settings.targetSizeMB) {
        const caps = await probeCapabilities();
        settings = applyTargetSize(settings, autoSettings(source, caps), source);
      }
      await ensureAudioEncoder(settings);
      let reportedBytes = 0;
      let lastProgress = 0;
      const job = startConversion({
        input,
        job: shrinkJob(settings, source),
        format: createOutputFormat(settings.container, 'file-stream'),
        target: new StreamTarget(writable, { chunked: true }),
        onProgress(p, bytes) {
          lastProgress = p;
          reportedBytes = bytes;
        },
      });
      await job.done;
      // Replay the positioned writes the way a file would apply them.
      const size = Math.max(0, ...chunks.map((c) => c.position + c.data.byteLength));
      const bytes = new Uint8Array(size);
      for (const c of chunks) bytes.set(c.data, c.position);
      const mime = settings.container === 'webm' ? 'video/webm' : 'video/mp4';
      const { info } = await readSource(new File([bytes], 'out', { type: mime }));
      return {
        ok: true,
        output: info,
        outputBytes: size,
        reportedBytes,
        lastProgress,
        closeCalls,
        abortCalls,
      };
    } catch (err) {
      return { ...failure(err), closeCalls, abortCalls };
    }
  },

  async extractAudio(
    fixture: File,
    settings: AudioExtractSettings,
    sinkKind: 'memory' | 'file-stream',
  ): Promise<StreamResult> {
    let closeCalls = 0;
    let abortCalls = 0;
    try {
      if (settings.format === 'mp3') await ensureMp3Encoder();
      if (settings.format === 'm4a' && !settings.copy && !(await canEncodeAudio('aac')))
        await registerAacFallback();
      const { input } = await readSource(fixture);
      const mime = AUDIO_FORMATS[settings.format].mime;
      const chunks: StreamTargetChunk[] = [];
      const writable = new WritableStream<StreamTargetChunk>({
        write(chunk) {
          chunks.push(chunk);
        },
        close() {
          closeCalls++;
        },
        abort() {
          abortCalls++;
        },
      });
      const sink =
        sinkKind === 'memory' ? await openSink({ kind: 'memory', warn: false }, 'out', mime) : null;
      let reportedBytes = 0;
      let lastProgress = 0;
      const job = startConversion({
        input,
        job: audioExtractJob(settings),
        format: createAudioOutputFormat(settings.format, sinkKind),
        target: sink?.target ?? new StreamTarget(writable, { chunked: true }),
        onProgress(p, bytes) {
          lastProgress = p;
          reportedBytes = bytes;
        },
      });
      await job.done;
      const blob = sink
        ? await sink.finish()
        : (() => {
            const size = Math.max(0, ...chunks.map((c) => c.position + c.data.byteLength));
            const bytes = new Uint8Array(size);
            for (const chunk of chunks) bytes.set(chunk.data, chunk.position);
            return new Blob([bytes], { type: mime });
          })();
      if (!blob) throw new Error('Memory sink returned no blob');
      const { info } = await readSource(
        new File([blob], `out${AUDIO_FORMATS[settings.format].ext}`, { type: mime }),
      );
      return {
        ok: true,
        output: info,
        outputBytes: blob.size,
        reportedBytes,
        lastProgress,
        closeCalls,
        abortCalls,
      };
    } catch (err) {
      return { ...failure(err), closeCalls, abortCalls };
    }
  },
};

declare global {
  interface Window {
    vrHarness: typeof harness;
  }
}
window.vrHarness = harness;
