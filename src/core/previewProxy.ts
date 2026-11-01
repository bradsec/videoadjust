import { BufferTarget, Quality, type Input } from 'mediabunny';
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

/** Build an in-memory playback copy while keeping the original Input for export. */
export function makePreviewProxy(
  input: Input,
  source: SourceInfo,
  caps: Capabilities,
  onProgress: (progress: number) => void,
): { done: Promise<Blob>; cancel(): Promise<void> } {
  const codec = caps.video.avc ? 'avc' : caps.video.vp9 ? 'vp9' : null;
  if (!codec) throw new Error('This browser cannot encode a preview video.');
  if (source.audio?.decodable && !(codec === 'avc' ? caps.audio.aac : caps.audio.opus))
    throw new Error('This browser cannot encode preview audio.');
  const target = new BufferTarget();
  const size = scaleToLongEdge(source.video!.displayWidth, source.video!.displayHeight, 1280);
  const job = startConversion({
    input,
    target,
    format: createOutputFormat(codec === 'avc' ? 'mp4' : 'webm', 'memory'),
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
      if (!target.buffer) throw new Error('The preview copy has no output.');
      return new Blob([target.buffer], { type: codec === 'avc' ? 'video/mp4' : 'video/webm' });
    }),
  };
}
