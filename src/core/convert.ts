import {
  Conversion,
  ConversionCanceledError,
  Mp4OutputFormat,
  Output,
  Quality,
  WebMOutputFormat,
  type ConversionOptions,
  type DiscardedTrack,
  type Input,
  type OutputFormat,
  type Target,
  type TrackType,
} from 'mediabunny';
import type { SinkPlan } from './sink';
import type { Container, Settings } from './types';

export class ConversionInvalidError extends Error {
  constructor(public readonly discarded: { track: TrackType; reason: DiscardedTrack['reason'] }[]) {
    const list = discarded.map((d) => `${d.track} track: ${d.reason}`).join(', ');
    super(`This video cannot be converted with these settings (${list || 'no usable tracks'}).`);
    this.name = 'ConversionInvalidError';
  }
}

// Quality rejects non-integer bitrates; source bitrates come from packet statistics and can be fractional.
const quality = (bitrate: number) => new Quality({ bitrate: Math.round(bitrate) });

export function toConversionOptions(
  s: Settings,
): Pick<ConversionOptions, 'video' | 'audio' | 'trim'> {
  const v = s.video;
  const a = s.audio;
  return {
    trim: { start: s.trim.start, end: s.trim.end },
    video: v
      ? s.passthrough
        ? {}
        : {
            width: v.width,
            height: v.height,
            fit: 'contain',
            frameRate: v.fps,
            codec: v.codec,
            quality: quality(v.bitrate),
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

export function createOutputFormat(container: Container, sinkKind: SinkPlan['kind']): OutputFormat {
  if (container === 'webm') return new WebMOutputFormat();
  // A file stream cannot seek back to the start cheaply, so metadata goes at the end there.
  return new Mp4OutputFormat({ fastStart: sinkKind === 'memory' ? 'in-memory' : false });
}

export function startConversion(args: {
  input: Input;
  settings: Settings;
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
        ...toConversionOptions(args.settings),
        showWarnings: false,
      });
      if (canceled) {
        await conversion.cancel();
        throw new ConversionCanceledError();
      }
      if (!conversion.isValid) {
        throw new ConversionInvalidError(
          conversion.discardedTracks.map((d) => ({ track: d.track.type, reason: d.reason })),
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
