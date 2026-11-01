import {
  BufferTarget,
  Mp4OutputFormat,
  Quality,
  StreamTarget,
  type Input,
  type StreamTargetChunk,
} from 'mediabunny';
import { scaleToLongEdge } from './autoSettings';
import { createOutputFormat, startConversion } from './convert';
import type { Capabilities, SourceInfo } from './types';

/** Metadata that makes a browser preview unreliable despite a decodable source. */
export function needsPreviewProxy(
  source: SourceInfo,
  canPlayType: (mime: string) => string,
): boolean {
  if (!source.video?.decodable) return false;
  const codec = source.video.codecString ?? '';
  const depth = /^(?:av01|vp09)\.[^.]+\.[^.]+\.(\d+)/i.exec(codec)?.[1];
  const main10 = /^(?:hvc1|hev1)\.2\./i.test(codec);
  const high10 = /^avc[13]\.6e/i.test(codec);
  return !!(
    source.video.hdr ||
    (depth && Number(depth) > 8) ||
    main10 ||
    high10 ||
    (source.audio?.decodable && canPlayType(source.containerMime) === '')
  );
}

/**
 * MediaSource type for a streamed H.264 copy, or null when the copy will be VP9. The level is
 * a broad one: the copy's own init segment tells the decoder its exact profile and level.
 */
export function previewStreamType(source: SourceInfo, caps: Capabilities): string | null {
  if (!caps.video.avc) return null;
  return `video/mp4; codecs="avc1.640028${source.audio?.decodable ? ',mp4a.40.2' : ''}"`;
}

/**
 * Build a playback copy while keeping the original Input for export. With onData, an H.264
 * copy is written as fragmented MP4 and each piece is handed over as soon as it exists, so it
 * can play while the rest converts; done still resolves to the whole copy.
 */
export function makePreviewProxy(
  input: Input,
  source: SourceInfo,
  caps: Capabilities,
  onProgress: (progress: number) => void,
  onData?: (data: Uint8Array<ArrayBuffer>) => void,
): { done: Promise<Blob>; cancel(): Promise<void> } {
  const codec = caps.video.avc ? 'avc' : caps.video.vp9 ? 'vp9' : null;
  if (!codec) throw new Error('This browser cannot encode a preview video.');
  if (source.audio?.decodable && !(codec === 'avc' ? caps.audio.aac : caps.audio.opus))
    throw new Error('This browser cannot encode preview audio.');
  const streaming = codec === 'avc' && !!onData;
  const buffer = new BufferTarget();
  const pieces: Uint8Array<ArrayBuffer>[] = [];
  let written = 0;
  const target = streaming
    ? new StreamTarget(
        new WritableStream<StreamTargetChunk>({
          write({ data, position }) {
            // Fragmented MP4 is written in order; joining the pieces rebuilds the file.
            if (position !== written) throw new Error('The preview copy was written out of order.');
            const piece = data.slice();
            written += piece.byteLength;
            pieces.push(piece);
            onData?.(piece);
          },
        }),
      )
    : buffer;
  const size = scaleToLongEdge(source.video!.displayWidth, source.video!.displayHeight, 1280);
  const job = startConversion({
    input,
    target,
    format: streaming
      ? new Mp4OutputFormat({ fastStart: 'fragmented' })
      : createOutputFormat(codec === 'avc' ? 'mp4' : 'webm', 'memory'),
    job: {
      options: {
        video: {
          codec,
          ...size,
          fit: 'contain',
          quality: new Quality({ bitrate: 2_500_000 }),
          forceTranscode: true,
        },
        audio: source.audio?.decodable
          ? {
              codec: codec === 'avc' ? 'aac' : 'opus',
              numberOfChannels: 2,
              sampleRate: 48000,
              quality: new Quality({ bitrate: 128_000 }),
              forceTranscode: true,
            }
          : { discard: true },
      },
      keeps: { video: true, audio: !!source.audio?.decodable },
    },
    onProgress: onProgress,
  });
  return {
    cancel: job.cancel,
    done: job.done.then(() => {
      const type = codec === 'avc' ? 'video/mp4' : 'video/webm';
      if (streaming) return new Blob(pieces, { type });
      if (!buffer.buffer) throw new Error('The preview copy has no output.');
      return new Blob([buffer.buffer], { type });
    }),
  };
}
