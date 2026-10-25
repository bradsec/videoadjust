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
  type ConversionAudioOptions,
  type DiscardedTrack,
  type Input,
  type OutputFormat,
  type Target,
  type TrackType,
  type VideoSample,
} from 'mediabunny';
import type { AudioExtractSettings, AudioFormat } from './audioExtract';
import { processedAudioOptions, hasAudioProcessing } from './audioProcess';
import { registerFrameCrop } from './frameCrop';
import { hasOverlays, renderOverlayLayer, type OverlayAssets } from './overlays';
import { createStyleRenderer, hasStyleEffects } from './style';
import type { SinkPlan } from './sink';
import type { Container, Settings, SourceInfo } from './types';
import { normalizeCrop, rotatedSize } from './videoGeometry';

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
  cleanup?: () => void;
  readonly styleDropped?: boolean;
  prepare?: (input: Input, signal: AbortSignal, progress: (p: number) => void) => Promise<void>;
};

// Quality rejects non-integer bitrates; source bitrates come from packet statistics and can be fractional.
const quality = (bitrate: number) => new Quality({ bitrate: Math.round(bitrate) });

export function shrinkJob(
  s: Settings,
  source?: SourceInfo,
  assets: OverlayAssets = {},
): ConversionJob & { copiesVideo: boolean } {
  const v = s.video;
  const a = s.audio;
  const audioProcessor =
    a && hasAudioProcessing(s.audioProcessing)
      ? processedAudioOptions(s.audioProcessing!, s.trim, a.channels, {
          codec: a.codec,
          quality: quality(a.bitrate),
          numberOfChannels: a.channels,
        })
      : undefined;
  const transform = s.transform;
  const rotated =
    source?.video && transform
      ? rotatedSize(source.video.displayWidth, source.video.displayHeight, transform.rotate)
      : null;
  if (transform && (transform.crop !== 'original' || transform.rect) && !rotated)
    throw new Error('Source video dimensions are required for cropping.');
  const crop =
    rotated && transform
      ? normalizeCrop(rotated.width, rotated.height, transform.crop, transform.rect)
      : null;
  const transformed =
    !!transform &&
    (transform.rotate !== 0 || transform.flip || transform.crop !== 'original' || !!crop);
  const overlay = s.overlays && hasOverlays(s.overlays) ? s.overlays : undefined;
  const styled = hasStyleEffects(s.style);
  const reencode =
    transformed || s.trimPrecision === 'exact' || !!s.keyFrameInterval || !!overlay || styled;
  const copiesVideo = !!v && s.passthrough && !reencode;
  let canvas: OffscreenCanvas | undefined;
  let styleCanvas: OffscreenCanvas | undefined;
  let styleRenderer: ReturnType<typeof createStyleRenderer> | undefined;
  let styleUnavailable = false;
  let layer: Promise<OffscreenCanvas | null> | undefined;
  const title = s.metadata?.title.trim();
  const options: ConversionJob['options'] = {
    trim: { start: s.trim.start, end: s.trim.end },
    ...(s.metadata?.strip
      ? { tags: title ? { title } : {} }
      : title
        ? { tags: (inputTags) => ({ ...inputTags, title }) }
        : {}),
    video: v
      ? copiesVideo
        ? {}
        : {
            width: v.width,
            height: v.height,
            fit: 'contain',
            frameRate: v.fps,
            codec: v.codec,
            // A target keeps the default variable bitrate mode: Mediabunny offers the encoder
            // no fallback config for an explicit mode, so an unsupported 'constant' would fail
            // the export. The target's headroom and Try again smaller cover any overshoot.
            quality: quality(v.bitrate),
            ...(reencode || s.targetSizeMB ? { forceTranscode: true } : {}),
            ...(transformed || overlay || styled ? { allowTransformationMetadata: false } : {}),
            ...(overlay || styled
              ? {
                  processedWidth: v.width,
                  processedHeight: v.height,
                  // Samples arrive rotated, flipped, cropped and resized, so overlays land in
                  // output space. sample.draw reads the whole frame, which WebKit handles.
                  process: async (sample: VideoSample) => {
                    const overlayLayer = overlay
                      ? await (layer ??= renderOverlayLayer(v.width, v.height, overlay, assets))
                      : null;
                    canvas ??= new OffscreenCanvas(v.width, v.height);
                    const context = canvas.getContext('2d');
                    if (!context) throw new Error('Canvas is unavailable for overlay export.');
                    context.clearRect(0, 0, v.width, v.height);
                    sample.draw(context, 0, 0, v.width, v.height);
                    if (styled && s.style && !styleUnavailable) {
                      try {
                        styleCanvas ??= new OffscreenCanvas(v.width, v.height);
                        styleRenderer ??= createStyleRenderer(styleCanvas);
                        styleRenderer.draw(
                          canvas,
                          v.width,
                          v.height,
                          sample.timestamp + s.trim.start,
                          s.style,
                        );
                        context.drawImage(styleCanvas, 0, 0);
                      } catch (error) {
                        styleUnavailable = true;
                        console.warn('Video Style disabled during export:', error);
                      }
                    }
                    if (overlayLayer) context.drawImage(overlayLayer, 0, 0);
                    return canvas;
                  },
                }
              : {}),
            ...(s.keyFrameInterval ? { keyFrameInterval: s.keyFrameInterval } : {}),
            ...(transform?.rotate ? { rotate: transform.rotate } : {}),
            ...(transform?.flip ? { flip: true } : {}),
            ...(crop ? { crop } : {}),
          }
      : { discard: true },
    audio: !a
      ? { discard: true }
      : audioProcessor
        ? audioProcessor.audio
        : s.passthrough
          ? {}
          : a.copy
            ? // Any bitrate or channel option would force a transcode, so copy names only the codec.
              { codec: a.codec, forceTranscode: false }
            : { codec: a.codec, quality: quality(a.bitrate), numberOfChannels: a.channels },
  };
  return {
    options,
    keeps: { video: !!v, audio: !!a },
    copiesVideo,
    ...(audioProcessor ? { prepare: audioProcessor.prepare } : {}),
    get styleDropped() {
      return styleUnavailable;
    },
    ...(styled ? { cleanup: () => styleRenderer?.destroy() } : {}),
  };
}

export function toConversionOptions(
  s: Settings,
  source?: SourceInfo,
  assets?: OverlayAssets,
): Pick<ConversionOptions, 'video' | 'audio' | 'trim' | 'tags'> {
  return shrinkJob(s, source, assets).options;
}

export function audioExtractJob(s: AudioExtractSettings): ConversionJob {
  const active = hasAudioProcessing(s.audioProcessing);
  const audio: ConversionAudioOptions =
    s.format === 'wav'
      ? { codec: 'pcm-s16', numberOfChannels: s.channels }
      : s.format === 'm4a' && s.copy && !active
        ? { codec: 'aac', forceTranscode: false }
        : {
            codec: s.format === 'mp3' ? 'mp3' : 'aac',
            quality: quality(s.bitrate),
            numberOfChannels: s.channels,
          };
  const processor = active
    ? processedAudioOptions(s.audioProcessing!, s.trim, s.channels, audio)
    : undefined;
  return {
    options: {
      trim: { start: s.trim.start, end: s.trim.end },
      video: { discard: true },
      audio: processor?.audio ?? audio,
    },
    keeps: { video: false, audio: true },
    ...(processor ? { prepare: processor.prepare } : {}),
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

/**
 * In memory, MP4 and M4A use fast start: Mediabunny holds the whole file and writes it when
 * the export finishes, so only the header's bytes are reported while it encodes.
 */
export function writesWhileEncoding(
  output: Container | AudioFormat,
  sinkKind: SinkPlan['kind'],
): boolean {
  return !(sinkKind === 'memory' && (output === 'mp4' || output === 'm4a'));
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
  onProgress(p: number, bytesWritten: number, phase?: 'analysis' | 'encoding'): void;
}): { done: Promise<void>; cancel(): Promise<void> } {
  let conversion: Conversion | undefined;
  let canceled = false;
  let bytesWritten = 0;
  const controller = new AbortController();

  registerFrameCrop();
  const done = (async () => {
    const output = new Output({ format: args.format, target: args.target });
    const stopListening = args.target.on('write', ({ end }) => {
      bytesWritten = Math.max(bytesWritten, end);
    });
    try {
      await args.job.prepare?.(args.input, controller.signal, (p) =>
        args.onProgress(p, 0, 'analysis'),
      );
      if (canceled) throw new ConversionCanceledError();
      args.onProgress(0, 0, 'encoding');
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
      conversion.onProgress = (p) => args.onProgress(p, bytesWritten, 'encoding');
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
      args.job.cleanup?.();
    }
  })();

  return {
    done,
    async cancel() {
      canceled = true;
      controller.abort();
      await conversion?.cancel();
    },
  };
}
