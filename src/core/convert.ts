import {
  Conversion,
  ConversionCanceledError,
  Mp3OutputFormat,
  Mp4OutputFormat,
  Output,
  Quality,
  WavOutputFormat,
  WebMOutputFormat,
  type ConversionOptions,
  type DiscardedTrack,
  type Input,
  type OutputFormat,
  type Target,
  type TrackType,
} from 'mediabunny';
import type { AudioExtractSettings, AudioFormat } from './audioExtract';
import type { SinkPlan } from './sink';
import type { Container, Settings, SourceInfo } from './types';
import { cropRectangle, rotatedSize } from './videoGeometry';

export class ConversionInvalidError extends Error {
  constructor(public readonly discarded: { track: TrackType; reason: DiscardedTrack['reason'] }[]) {
    const list = discarded.map((d) => `${d.track} track: ${d.reason}`).join(', ');
    super(`This video cannot be converted with these settings (${list || 'no usable tracks'}).`);
    this.name = 'ConversionInvalidError';
  }
}

export type ConversionJob = {
  options: Pick<ConversionOptions, 'video' | 'audio' | 'trim' | 'tags'>;
  keeps: { video: boolean; audio: boolean };
};

// Quality rejects non-integer bitrates; source bitrates come from packet statistics and can be fractional.
const quality = (bitrate: number) => new Quality({ bitrate: Math.round(bitrate) });

export function toConversionOptions(
  s: Settings,
  source?: SourceInfo,
): Pick<ConversionOptions, 'video' | 'audio' | 'trim' | 'tags'> {
  const v = s.video;
  const a = s.audio;
  const transform = s.transform;
  const transformed =
    !!transform && (transform.rotate !== 0 || transform.flip || transform.crop !== 'original');
  const reencode = transformed || !!s.keyFrameInterval;
  const rotated =
    source?.video && transform
      ? rotatedSize(source.video.displayWidth, source.video.displayHeight, transform.rotate)
      : null;
  if (transform?.crop !== undefined && transform.crop !== 'original' && !rotated)
    throw new Error('Source video dimensions are required for cropping.');
  const crop =
    rotated && transform ? cropRectangle(rotated.width, rotated.height, transform.crop) : null;
  const title = s.metadata?.title.trim();
  return {
    trim: { start: s.trim.start, end: s.trim.end },
    ...(s.metadata?.strip
      ? { tags: title ? { title } : {} }
      : title
        ? { tags: (inputTags) => ({ ...inputTags, title }) }
        : {}),
    video: v
      ? s.passthrough && !reencode
        ? {}
        : {
            width: v.width,
            height: v.height,
            fit: 'contain',
            frameRate: v.fps,
            codec: v.codec,
            quality: quality(v.bitrate),
            ...(reencode ? { forceTranscode: true } : {}),
            ...(transformed ? { allowTransformationMetadata: false } : {}),
            ...(s.keyFrameInterval ? { keyFrameInterval: s.keyFrameInterval } : {}),
            ...(transform?.rotate ? { rotate: transform.rotate } : {}),
            ...(transform?.flip ? { flip: true } : {}),
            ...(crop ? { crop } : {}),
          }
      : { discard: true },
    audio: !a
      ? { discard: true }
      : s.passthrough
        ? {}
        : a.copy
          ? // Any bitrate or channel option would force a transcode, so copy names only the codec.
            { codec: a.codec, forceTranscode: false }
          : { codec: a.codec, quality: quality(a.bitrate), numberOfChannels: a.channels },
  };
}

export function shrinkJob(s: Settings, source?: SourceInfo): ConversionJob {
  return {
    options: toConversionOptions(s, source),
    keeps: { video: !!s.video, audio: !!s.audio },
  };
}

export function audioExtractJob(s: AudioExtractSettings): ConversionJob {
  return {
    options: {
      trim: { start: s.trim.start, end: s.trim.end },
      video: { discard: true },
      audio:
        s.format === 'wav'
          ? { codec: 'pcm-s16', numberOfChannels: s.channels }
          : s.format === 'm4a' && s.copy
            ? { codec: 'aac', forceTranscode: false }
            : {
                codec: s.format === 'mp3' ? 'mp3' : 'aac',
                quality: quality(s.bitrate),
                numberOfChannels: s.channels,
              },
    },
    keeps: { video: false, audio: true },
  };
}

export function discardedPrimaryTracks(
  keeps: ConversionJob['keeps'],
  primaryVideo: unknown,
  primaryAudio: unknown,
  discarded: readonly { track: unknown; reason: DiscardedTrack['reason'] }[],
): { track: TrackType; reason: DiscardedTrack['reason'] }[] {
  const lost: { track: TrackType; reason: DiscardedTrack['reason'] }[] = [];
  for (const { track, reason } of discarded) {
    if (reason === 'discarded_by_user') continue;
    if (keeps.video && track === primaryVideo) lost.push({ track: 'video', reason });
    if (keeps.audio && track === primaryAudio) lost.push({ track: 'audio', reason });
  }
  return lost;
}

export function createOutputFormat(container: Container, sinkKind: SinkPlan['kind']): OutputFormat {
  if (container === 'webm') return new WebMOutputFormat();
  // A file stream cannot seek back to the start cheaply, so metadata goes at the end there.
  return new Mp4OutputFormat({ fastStart: sinkKind === 'memory' ? 'in-memory' : false });
}

export function createAudioOutputFormat(
  format: AudioFormat,
  sinkKind: SinkPlan['kind'],
): OutputFormat {
  if (format === 'mp3') return new Mp3OutputFormat();
  if (format === 'wav') return new WavOutputFormat();
  return new Mp4OutputFormat({ fastStart: sinkKind === 'memory' ? 'in-memory' : false });
}

export function startConversion(args: {
  input: Input;
  job: ConversionJob;
  format: OutputFormat;
  target: Target;
  onProgress(p: number, bytesWritten: number): void;
}): { done: Promise<void>; cancel(): Promise<void> } {
  let conversion: Conversion | undefined;
  let canceled = false;
  let bytesWritten = 0;

  const done = (async () => {
    const output = new Output({ format: args.format, target: args.target });
    const stopListening = args.target.on('write', ({ end }) => {
      bytesWritten = Math.max(bytesWritten, end);
    });
    try {
      conversion = await Conversion.init({
        input: args.input,
        output,
        ...args.job.options,
        showWarnings: false,
      });
      if (canceled) {
        await conversion.cancel();
        throw new ConversionCanceledError();
      }
      const [primaryVideo, primaryAudio] = await Promise.all([
        args.input.getPrimaryVideoTrack(),
        args.input.getPrimaryAudioTrack(),
      ]);
      const lostPrimary = discardedPrimaryTracks(
        args.job.keeps,
        primaryVideo,
        primaryAudio,
        conversion.discardedTracks,
      );
      if (!conversion.isValid || lostPrimary.length) {
        throw new ConversionInvalidError(
          lostPrimary.length
            ? lostPrimary
            : conversion.discardedTracks.map((d) => ({ track: d.track.type, reason: d.reason })),
        );
      }
      conversion.onProgress = (p) => args.onProgress(p, bytesWritten);
      await conversion.execute();
      args.onProgress(1, bytesWritten);
    } catch (err) {
      // A cancel that lands before the output starts surfaces from Mediabunny as a plain
      // "Output has been canceled." Error; callers get one error type for every cancel.
      if (canceled && !(err instanceof ConversionCanceledError))
        throw new ConversionCanceledError();
      throw err;
    } finally {
      stopListening();
    }
  })();

  return {
    done,
    async cancel() {
      canceled = true;
      await conversion?.cancel();
    },
  };
}
