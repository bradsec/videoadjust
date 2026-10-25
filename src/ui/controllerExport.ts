import { ConversionCanceledError, type OutputFormat } from 'mediabunny';
import {
  AUDIO_FORMATS,
  audioOutputName,
  estimateAudioBytes,
  type AudioExtractSettings,
} from '../core/audioExtract';
import {
  audioExtractJob,
  ConversionInvalidError,
  createAudioOutputFormat,
  createOutputFormat,
  shrinkJob,
  type ConversionJob,
} from '../core/convert';
import { estimateBytes } from '../core/estimate';
import {
  exportGif,
  gifBudgetError,
  gifDimensions,
  gifFrameCount,
  gifOutputName,
} from '../core/gifExport';
import { chooseSink, openGifSink, type OpenSink, type SinkPlan } from '../core/sink';
import type { SourceInfo } from '../core/types';
import { formatBytes } from './format';
import { audioMixSource, codecLabel, outputNameFor } from './controllerSettings';
import { describeAudioWritten, describeWritten } from './exportDescription';
import type { AppDeps, AppState, Loaded, Notice } from './controllerTypes';

const isAbortError = (err: unknown) => err instanceof DOMException && err.name === 'AbortError';
export const PARTIAL_FILE =
  'A partial file may remain at the location you chose. You can delete it.';

/** What differs between the Shrink and audio exports; startExport runs the rest for both. */
interface ExportSpec {
  outputName: string;
  mime: string;
  estimate: { low: number; high: number; mid: number };
  job: ConversionJob;
  format(sinkKind: SinkPlan['kind']): OutputFormat;
  /** Runs before the sink opens; a notice stops the export there. */
  preflight(): Promise<Notice | undefined>;
  /** Result info from the settings, for when no Blob can be read back. */
  describe(bytes: number): SourceInfo;
  /** Notice for an unexpected conversion failure. */
  failure: { title: string; message: string };
  /** Notice title when the settings cannot convert this source. */
  invalidTitle: string;
  /** Closes the in-memory size warning: what the user can change to need less memory. */
  memoryAdvice: string;
}

/** Runs video, GIF, and audio exports, owns the export token and cancellation, and reports progress through `setState`. */
export function createExportFlow(
  deps: AppDeps,
  getState: () => AppState,
  setState: (next: AppState) => void,
  toPrepare: (from: Loaded & { addingAudio?: boolean }, notice?: Notice) => void,
) {
  let exportToken = 0;
  let cancelExport: (() => void) | undefined;

  function cancel(): void {
    exportToken++;
    cancelExport?.();
    cancelExport = undefined;
  }

  function supersede(): void {
    exportToken++;
  }

  async function startExport(
    prep: Extract<AppState, { kind: 'prepare' }>,
    confirmed: boolean,
  ): Promise<void> {
    if (prep.tool === 'gif' && prep.gifSettings) {
      await startGifExport(prep);
      return;
    }
    const { source, caps: c } = prep;
    // Tool 'audio' always has audioSettings (see Loaded).
    const spec =
      prep.tool === 'audio' && prep.audioSettings
        ? audioSpec(prep, prep.audioSettings)
        : shrinkSpec(prep);
    const { estimate, outputName, mime } = spec;
    const plan = chooseSink({
      estimateBytes: estimate.mid,
      fileStreamSave: c.fileStreamSave,
      deviceMemoryGB: deps.deviceMemoryGB,
    });
    if (plan.kind === 'memory' && plan.warn && !confirmed) {
      setState({
        ...prep,
        notice: {
          tone: 'warn',
          title: `This export may need about ${formatBytes(estimate.high)} of memory`,
          message: `This browser keeps the new file in memory until you save it. Phones and tablets may reload the tab and lose the work. ${spec.memoryAdvice}`,
          confirm: 'memory',
        },
      });
      return;
    }
    const token = ++exportToken;
    const base: Loaded = prep;
    setState({ ...prep, notice: undefined, exporting: true });
    const blocked = await spec.preflight();
    if (token !== exportToken) return;
    if (blocked) {
      toPrepare(base, blocked);
      return;
    }

    let sink: OpenSink;
    try {
      sink = await deps.openSink(plan, outputName, mime);
    } catch (err) {
      if (token !== exportToken) return;
      if (isAbortError(err)) {
        toPrepare(base);
        return;
      }
      console.error('opening the output failed', err);
      toPrepare(base, {
        tone: 'error',
        title: 'The new file could not be created',
        message: 'Choose another place to save it, or try again.',
      });
      return;
    }
    if (token !== exportToken) {
      void sink.abort();
      return;
    }

    let bytes = 0;
    const startedAt = Date.now();
    setState({
      ...base,
      kind: 'working',
      outputName,
      sinkKind: plan.kind,
      estimate,
      progress: 0,
      bytes: 0,
      startedAt,
    });
    try {
      const job = deps.startConversion({
        input: base.input,
        job: spec.job,
        format: spec.format(plan.kind),
        target: sink.target,
        onProgress(p, written, phase) {
          bytes = written;
          if (token === exportToken) {
            const state = getState();
            if (state.kind === 'working')
              setState({ ...state, progress: p, bytes: written, phase });
          }
        },
      });
      cancelExport = () => {
        // The abort has to land before Mediabunny closes the stream, or the partial file is committed.
        void sink.abort();
        void job.cancel();
      };
      await job.done;
      const blob = await sink.finish();
      if (token !== exportToken) return;
      cancelExport = undefined;
      const info = blob
        ? await describeBlob(blob, outputName, mime, () => spec.describe(blob.size))
        : spec.describe(bytes);
      if (token !== exportToken) return;
      const sizeBytes = blob ? blob.size : bytes;
      setState({
        ...base,
        kind: 'result',
        outputName,
        sinkKind: plan.kind,
        elapsedMs: Date.now() - startedAt,
        styleDropped: spec.job.styleDropped,
        notSmaller: sizeBytes >= source.sizeBytes,
        output: { blob, sizeBytes, url: blob ? URL.createObjectURL(blob) : null, info },
      });
    } catch (err) {
      if (plan.kind === 'file-stream') await sink.abort();
      if (token !== exportToken) return;
      cancelExport = undefined;
      const partial = plan.kind === 'file-stream' ? ` ${PARTIAL_FILE}` : '';
      if (err instanceof ConversionCanceledError) {
        toPrepare(
          base,
          partial ? { tone: 'info', title: 'Export canceled', message: PARTIAL_FILE } : undefined,
        );
      } else if (err instanceof ConversionInvalidError) {
        toPrepare(base, {
          tone: 'error',
          title: spec.invalidTitle,
          message: `${err.message}${partial}`,
        });
      } else {
        console.error('export failed', err);
        toPrepare(base, {
          tone: 'error',
          title: spec.failure.title,
          message: `${spec.failure.message}${partial}`,
        });
      }
    }
  }

  async function startGifExport(prep: Extract<AppState, { kind: 'prepare' }>): Promise<void> {
    const settings = prep.gifSettings;
    if (!settings) return;
    const { width, height } = gifDimensions(settings, prep.source, prep.settings.transform);
    const frames = gifFrameCount(settings.trim, settings.fps);
    const budget = gifBudgetError(width, height, frames, settings.trim.end - settings.trim.start);
    if (budget) {
      toPrepare(prep, { tone: 'warn', title: 'GIF is too large', message: budget });
      return;
    }
    const outputName = gifOutputName(prep.file.name);
    const plan: SinkPlan = prep.caps.fileStreamSave
      ? { kind: 'file-stream' }
      : { kind: 'memory', warn: false };
    const token = ++exportToken;
    const base: Loaded = prep;
    setState({ ...prep, notice: undefined, exporting: true });
    let sink;
    try {
      sink = await openGifSink(plan, outputName);
    } catch (err) {
      if (token !== exportToken) return;
      if (isAbortError(err)) {
        toPrepare(base);
        return;
      }
      console.error('opening the GIF output failed', err);
      toPrepare(base, {
        tone: 'error',
        title: 'The GIF file could not be created',
        message: 'Choose another place to save it, or try again.',
      });
      return;
    }
    if (token !== exportToken) {
      void sink.abort();
      return;
    }
    const controller = new AbortController();
    cancelExport = () => {
      controller.abort();
      void sink.abort();
    };
    const startedAt = Date.now();
    setState({
      ...base,
      kind: 'working',
      outputName,
      sinkKind: plan.kind,
      estimate: { low: 0, high: 0 },
      progress: 0,
      bytes: 0,
      startedAt,
    });
    try {
      const { bytes, styleDropped } = await exportGif(
        base.input,
        base.source,
        settings,
        base.settings.transform,
        controller.signal,
        (progress) => {
          if (token === exportToken) {
            const state = getState();
            if (state.kind === 'working') setState({ ...state, progress });
          }
        },
        base.settings.overlays,
        base.overlayAssets,
        base.settings.style,
      );
      if (token !== exportToken) return;
      const blob = await sink.finish(bytes);
      if (token !== exportToken) return;
      cancelExport = undefined;
      const sizeBytes = bytes.byteLength;
      const info: SourceInfo = {
        name: outputName,
        sizeBytes,
        durationSec: settings.trim.end - settings.trim.start,
        containerMime: 'image/gif',
        video: {
          codec: 'gif',
          decodable: true,
          displayWidth: width,
          displayHeight: height,
          rotation: 0,
          fps: settings.fps,
          bitrate: null,
        },
        audio: null,
      };
      setState({
        ...base,
        kind: 'result',
        outputName,
        sinkKind: plan.kind,
        elapsedMs: Date.now() - startedAt,
        styleDropped,
        notSmaller: sizeBytes >= base.source.sizeBytes,
        output: { blob, sizeBytes, url: blob ? URL.createObjectURL(blob) : null, info },
      });
    } catch (err) {
      await sink.abort();
      if (token !== exportToken) return;
      cancelExport = undefined;
      if (isAbortError(err)) {
        toPrepare(base);
        return;
      }
      console.error('GIF export failed', err);
      toPrepare(base, {
        tone: 'error',
        title: 'The GIF export failed',
        message: 'Could not make the GIF. Try a shorter trim, lower frame rate, or smaller size.',
      });
    }
  }

  function shrinkSpec(prep: Loaded): ExportSpec {
    const { settings, source } = prep;
    const mime = settings.container === 'webm' ? 'video/webm' : 'video/mp4';
    const outputName = outputNameFor(prep.file.name, settings.container);
    const job = shrinkJob(settings, source, prep.overlayAssets, prep.addedAudio);
    return {
      outputName,
      mime,
      estimate: estimateBytes(settings, source),
      job,
      format: (sinkKind) => createOutputFormat(settings.container, sinkKind),
      async preflight() {
        const v = settings.video;
        if (!v || job.copiesVideo) return undefined;
        let supported = false;
        try {
          supported = await deps.canEncodeVideo(v.codec, {
            width: v.width,
            height: v.height,
            frameRate: v.fps,
          });
        } catch (err) {
          console.warn('export encoder probe failed', err);
        }
        return supported
          ? undefined
          : {
              tone: 'error',
              title: 'The chosen video encoder is unavailable',
              message: `${codecLabel(v.codec)} cannot encode ${v.width}x${v.height} at ${v.fps} fps in this browser. Choose another setting.`,
            };
      },
      describe: (bytes) => describeWritten(outputName, bytes, settings, source, mime),
      failure: {
        title: 'The export failed',
        message:
          'Something went wrong while making the new file. Try again, or choose a smaller size.',
      },
      invalidTitle: 'This video cannot be exported with these settings',
      memoryAdvice: 'Trim it shorter or choose a smaller size to be safe.',
    };
  }

  function audioSpec(prep: Loaded, a: AudioExtractSettings): ExportSpec {
    const { mime, label } = AUDIO_FORMATS[a.format];
    const outputName = audioOutputName(prep.file.name, a.format);
    return {
      outputName,
      mime,
      estimate: estimateAudioBytes(a, audioMixSource(prep.source, prep.addedAudio)),
      job: audioExtractJob(a, prep.addedAudio),
      format: (sinkKind) => createAudioOutputFormat(a.format, sinkKind),
      async preflight() {
        if (a.format !== 'mp3') return undefined;
        try {
          await deps.ensureMp3Encoder();
          return undefined;
        } catch (err) {
          console.error('loading the MP3 encoder failed', err);
          return {
            tone: 'error',
            title: 'MP3 encoding is unavailable',
            message: 'The MP3 encoder could not be loaded. Choose M4A or WAV, or try again.',
          };
        }
      },
      describe: (bytes) =>
        describeAudioWritten(outputName, bytes, a, audioMixSource(prep.source, prep.addedAudio)),
      failure: {
        title: `The ${label} export failed`,
        message:
          'Something went wrong while making the new file. Try again, or choose another format.',
      },
      invalidTitle: 'This audio cannot be extracted with these settings',
      memoryAdvice: 'Trim it shorter, or choose a lower bitrate or another format, to be safe.',
    };
  }

  /** Read the output back for the result table; `fallback` stands in if this browser cannot read it. */
  async function describeBlob(
    blob: Blob,
    name: string,
    mime: string,
    fallback: () => SourceInfo,
  ): Promise<SourceInfo> {
    try {
      const { info, input } = await deps.readSource(new File([blob], name, { type: mime }));
      input.dispose();
      return info;
    } catch (err) {
      console.warn('reading the new file back failed; showing the requested settings', err);
      return fallback();
    }
  }
  return { startExport, cancel, supersede };
}
