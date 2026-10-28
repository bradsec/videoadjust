import {
  Conversion,
  ConversionCanceledError,
  AudioSampleSource,
  VideoSample,
  Mp3OutputFormat,
  Mp4OutputFormat,
  Output,
  Quality,
  WavOutputFormat,
  WebMOutputFormat,
  type ConversionOptions,
  type AudioEncodingConfig,
  type AudioSample,
  type ConversionAudioOptions,
  type DiscardedTrack,
  type Input,
  type OutputFormat,
  type Target,
  type TrackType,
} from 'mediabunny';
import type { AudioExtractSettings, AudioFormat } from './audioExtract';
import { createJoinFade, keptRanges, normalizeCutFade, normalizeCuts, type Cut } from './cuts';
import { processedAudioOptions, hasAudioProcessing, type AudioProcessing } from './audioProcess';
import {
  createMixProcessor,
  hasAudioMix,
  mixHasAudio,
  type AddedAudio,
  type AudioMix,
} from './audioMix';
import { registerFrameCrop } from './frameCrop';
import { createCaptionRenderer, hasCaptions, normalizeCaptions } from './captions';
import { fitGeometry, paintFit } from './fit';
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
  customAudio?: {
    encoding: AudioEncodingConfig;
    samples(input: Input, signal: AbortSignal): AsyncGenerator<AudioSample>;
  };
};

// Quality rejects non-integer bitrates; source bitrates come from packet statistics and can be fractional.
const quality = (bitrate: number) => new Quality({ bitrate: Math.round(bitrate) });

export function cutVideoFrameTiming(
  sourceTime: number,
  duration: number,
  ranges: readonly Cut[],
): { timestamp: number; duration: number } | null {
  let timestamp = 0;
  for (const range of ranges) {
    if (sourceTime >= range.start && sourceTime < range.end)
      return {
        timestamp: timestamp + sourceTime - range.start,
        duration: Math.min(duration, range.end - sourceTime),
      };
    timestamp += range.end - range.start;
  }
  return null;
}

function mixedAudioJob(
  encoding: AudioEncodingConfig,
  channels: number,
  trim: { start: number; end: number },
  mix: AudioMix | undefined,
  processing: Partial<AudioProcessing> | undefined,
  added: AddedAudio | undefined,
  cuts?: readonly Cut[],
  cutFade = 0,
): Pick<ConversionJob, 'customAudio' | 'prepare'> {
  let processor: ReturnType<typeof createMixProcessor>;
  return {
    customAudio: {
      encoding,
      samples: (_input, signal) => processor.samples(signal),
    },
    async prepare(input, signal, progress) {
      processor = createMixProcessor(
        input,
        added,
        mix,
        trim,
        channels,
        48000,
        processing,
        cuts,
        cutFade,
      );
      await processor.prepare(signal, progress);
    },
  };
}

export function shrinkJob(
  s: Settings,
  source?: SourceInfo,
  assets: OverlayAssets = {},
  added?: AddedAudio,
): ConversionJob & { copiesVideo: boolean } {
  const v = s.video;
  const a = s.audio;
  const cuts = normalizeCuts(s.cuts, s.trim);
  const ranges = cuts.length ? keptRanges(s.trim, cuts) : [];
  const cutFade = normalizeCutFade(s.cutFade);
  const fadeAt = createJoinFade(s.trim, cuts, cutFade);
  const keepsAudio = !!a && mixHasAudio(s.mix, true);
  const mixed =
    keepsAudio && (hasAudioMix(s.mix) || !!added || cuts.length > 0)
      ? mixedAudioJob(
          { codec: a!.codec, quality: quality(a!.bitrate) },
          a!.channels,
          s.trim,
          s.mix,
          s.audioProcessing,
          added,
          cuts,
          cutFade,
        )
      : undefined;
  const audioProcessor =
    keepsAudio && !mixed && a && hasAudioProcessing(s.audioProcessing)
      ? processedAudioOptions(s.audioProcessing!, s.trim, a.channels, {
          codec: a.codec,
          quality: quality(a.bitrate),
          numberOfChannels: a.channels,
        })
      : undefined;
  const transform = s.transform;
  const rotated = source?.video
    ? rotatedSize(source.video.displayWidth, source.video.displayHeight, transform?.rotate ?? 0)
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
  const fitted = s.fit?.aspect !== undefined && s.fit.aspect !== 'off';
  if (fitted && !source?.video) throw new Error('Source video dimensions are required for Fit.');
  const frame = crop ?? rotated;
  const fit =
    fitted && frame && v ? fitGeometry(frame, s.fit!.aspect, Math.max(v.width, v.height)) : null;
  const captionLayerAt =
    hasCaptions(s.captions) && v
      ? createCaptionRenderer(v.width, v.height, normalizeCaptions(s.captions))
      : undefined;
  const decorated = !!overlay || styled || fitted || !!captionLayerAt;
  const reencode =
    transformed ||
    fitted ||
    s.trimPrecision === 'exact' ||
    cuts.length > 0 ||
    !!s.keyFrameInterval ||
    decorated;
  const copiesVideo = !!v && s.passthrough && !reencode;
  let canvas: OffscreenCanvas | undefined;
  let fittedCanvas: OffscreenCanvas | undefined;
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
            width: fit?.content.width ?? v.width,
            height: fit?.content.height ?? v.height,
            fit: 'contain',
            frameRate: v.fps,
            codec: v.codec,
            // A target keeps the default variable bitrate mode: Mediabunny offers the encoder
            // no fallback config for an explicit mode, so an unsupported 'constant' would fail
            // the export. The target's headroom and Try again smaller cover any overshoot.
            quality: quality(v.bitrate),
            ...(reencode || s.targetSizeMB ? { forceTranscode: true } : {}),
            ...(transformed || decorated || cuts.length
              ? { allowTransformationMetadata: false }
              : {}),
            ...(decorated || cuts.length
              ? {
                  ...(decorated ? { processedWidth: v.width, processedHeight: v.height } : {}),
                  // Samples arrive rotated, flipped, cropped and resized, so overlays land in
                  // output space. sample.draw reads the whole frame, which WebKit handles.
                  process: async (sample: VideoSample) => {
                    const sourceTime = sample.timestamp + s.trim.start;
                    const timing = cuts.length
                      ? cutVideoFrameTiming(sourceTime, sample.duration, ranges)
                      : null;
                    if (cuts.length && !timing) return null;
                    const level = timing ? fadeAt(timing.timestamp) : 1;
                    if (!decorated && level === 1) {
                      // Mediabunny closes the input sample itself, so retime it in place.
                      sample.setTimestamp(timing!.timestamp);
                      sample.setDuration(timing!.duration);
                      return sample;
                    }
                    const overlayLayer = overlay
                      ? await (layer ??= renderOverlayLayer(v.width, v.height, overlay, assets))
                      : null;
                    canvas ??= new OffscreenCanvas(
                      fit?.content.width ?? v.width,
                      fit?.content.height ?? v.height,
                    );
                    const context = canvas.getContext('2d');
                    if (!context) throw new Error('Canvas is unavailable for overlay export.');
                    context.clearRect(0, 0, canvas.width, canvas.height);
                    sample.draw(context, 0, 0, canvas.width, canvas.height);
                    if (styled && s.style && !styleUnavailable) {
                      try {
                        styleCanvas ??= new OffscreenCanvas(canvas.width, canvas.height);
                        styleRenderer ??= createStyleRenderer(styleCanvas);
                        styleRenderer.draw(
                          canvas,
                          canvas.width,
                          canvas.height,
                          sourceTime,
                          s.style,
                        );
                        context.drawImage(styleCanvas, 0, 0);
                      } catch (error) {
                        styleUnavailable = true;
                        console.warn('Video Style disabled during export:', error);
                      }
                    }
                    let target = context;
                    if (fit) {
                      fittedCanvas ??= new OffscreenCanvas(v.width, v.height);
                      const fittedContext = fittedCanvas.getContext('2d');
                      if (!fittedContext) throw new Error('Canvas is unavailable for Fit export.');
                      paintFit(fittedContext, canvas, fit, s.fit!);
                      target = fittedContext;
                    }
                    // Fade the picture through black at cuts; overlays and captions stay on top.
                    if (level < 1) {
                      target.fillStyle = `rgba(0, 0, 0, ${1 - level})`;
                      target.fillRect(0, 0, target.canvas.width, target.canvas.height);
                    }
                    if (overlayLayer) target.drawImage(overlayLayer, 0, 0);
                    const captionLayer = await captionLayerAt?.(sourceTime);
                    if (captionLayer) target.drawImage(captionLayer, 0, 0);
                    return timing ? new VideoSample(target.canvas, timing) : target.canvas;
                  },
                }
              : {}),
            ...(s.keyFrameInterval ? { keyFrameInterval: s.keyFrameInterval } : {}),
            ...(transform?.rotate ? { rotate: transform.rotate } : {}),
            ...(transform?.flip ? { flip: true } : {}),
            ...(crop ? { crop } : {}),
          }
      : { discard: true },
    audio:
      !keepsAudio || mixed
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
    keeps: { video: !!v, audio: keepsAudio },
    copiesVideo,
    ...(audioProcessor ? { prepare: audioProcessor.prepare } : {}),
    ...mixed,
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

export function audioExtractJob(s: AudioExtractSettings, added?: AddedAudio): ConversionJob {
  const active = hasAudioProcessing(s.audioProcessing);
  const cuts = normalizeCuts(s.cuts, s.trim);
  const mixed =
    (hasAudioMix(s.mix) || !!added || cuts.length > 0) && mixHasAudio(s.mix, true)
      ? mixedAudioJob(
          {
            codec: s.format === 'wav' ? 'pcm-s16' : s.format === 'mp3' ? 'mp3' : 'aac',
            ...(s.format === 'wav' ? {} : { quality: quality(s.bitrate) }),
          },
          s.channels,
          s.trim,
          s.mix,
          s.audioProcessing,
          added,
          cuts,
          normalizeCutFade(s.cutFade),
        )
      : undefined;
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
  const processor =
    active && !mixed
      ? processedAudioOptions(s.audioProcessing!, s.trim, s.channels, audio)
      : undefined;
  return {
    options: {
      trim: { start: s.trim.start, end: s.trim.end },
      // Extracted audio never carries source tags (location, device, dates); there is no keep option.
      tags: {},
      video: { discard: true },
      audio: mixed || !mixHasAudio(s.mix, true) ? { discard: true } : (processor?.audio ?? audio),
    },
    keeps: { video: false, audio: true },
    ...(processor ? { prepare: processor.prepare } : {}),
    ...mixed,
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
  let output: Output | undefined;
  let canceled = false;
  let bytesWritten = 0;
  const controller = new AbortController();

  registerFrameCrop();
  const done = (async () => {
    output = new Output({ format: args.format, target: args.target });
    const stopListening = args.target.on('write', ({ end }) => {
      bytesWritten = Math.max(bytesWritten, end);
    });
    try {
      await args.job.prepare?.(args.input, controller.signal, (p) =>
        args.onProgress(p, 0, 'analysis'),
      );
      if (canceled) throw new ConversionCanceledError();
      args.onProgress(0, 0, 'encoding');
      const custom = args.job.customAudio;
      const { tags, ...trackOptions } = args.job.options;
      const audioSource = custom ? new AudioSampleSource(custom.encoding) : undefined;
      if (audioSource) output.addAudioTrack(audioSource);
      conversion = await Conversion.init({
        input: args.input,
        output,
        ...(custom ? trackOptions : args.job.options),
        showWarnings: false,
        ...(custom ? { composable: true, tracks: 'primary' } : {}),
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
      if (custom && audioSource) {
        const inputTags = await args.input.getMetadataTags();
        output.setMetadataTags(
          typeof tags === 'function' ? await tags(inputTags) : (tags ?? inputTags),
        );
        await output.start();
        for await (const sample of custom.samples(args.input, controller.signal)) {
          try {
            controller.signal.throwIfAborted();
            // Advance both tracks together so neither the decoder nor muxer accumulates the whole clip.
            await Promise.all([
              conversion.execute({ until: sample.timestamp + sample.duration }),
              audioSource.add(sample),
            ]);
          } finally {
            sample.close();
          }
        }
        audioSource.close();
        await conversion.execute();
        controller.signal.throwIfAborted();
        await output.finalize();
      } else {
        await conversion.execute();
      }
      args.onProgress(1, bytesWritten);
    } catch (err) {
      controller.abort();
      if (args.job.customAudio) {
        const cleanups = await Promise.allSettled([conversion?.cancel(), output.cancel()]);
        for (const result of cleanups)
          if (result.status === 'rejected') console.warn('Export cleanup failed:', result.reason);
      }
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
      if (args.job.customAudio) await output?.cancel();
    },
  };
}
