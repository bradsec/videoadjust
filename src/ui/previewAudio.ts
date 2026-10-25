import type { Input } from 'mediabunny';
import {
  createMixProcessor,
  hasAudioMix,
  normalizeAudioMix,
  type AddedAudio,
  type AudioMix,
} from '../core/audioMix';
import {
  createAudioProcessor,
  dbGain,
  fadeEnvelope,
  hasAudioProcessing,
  normalizeAudioProcessing,
  SAMPLE_CEILING,
  type AudioProcessing,
} from '../core/audioProcess';

export type PreviewAudioTarget = {
  processing?: Partial<AudioProcessing>;
  mix?: AudioMix;
  added?: AddedAudio;
  trim: { start: number; end: number };
  channels: number;
} | null;

/** Linear gain the preview applies at source time `time`, matching export processing. */
export function previewGain(
  target: PreviewAudioTarget,
  normalizationDb: number,
  time: number,
): number {
  if (!target) return 1;
  const duration = target.trim.end - target.trim.start;
  const s = normalizeAudioProcessing(target.processing, duration);
  return dbGain(s.gainDb + normalizationDb) * fadeEnvelope(s, time - target.trim.start, duration);
}

export function previewTrackGains(target: PreviewAudioTarget): { original: number; added: number } {
  if (!target) return { original: 1, added: 0 };
  const mix = normalizeAudioMix(target.mix, target.trim.end - target.trim.start);
  return {
    original: mix.original.include ? dbGain(mix.original.volumeDb) : 0,
    added: mix.added ? dbGain(mix.added.volumeDb) : 0,
  };
}

export function addedAudioTime(
  time: number,
  trim: { start: number; end: number },
  added: { offset: number; loop: boolean },
  duration: number,
): number | null {
  const elapsed = time - trim.start - added.offset;
  if (duration <= 0 || elapsed < 0 || time >= trim.end || (!added.loop && elapsed >= duration))
    return null;
  return added.loop ? elapsed % duration : elapsed;
}

export function previewCeilingCurve(): Float32Array<ArrayBuffer> {
  return Float32Array.from({ length: 4097 }, (_, i) =>
    Math.max(-SAMPLE_CEILING, Math.min(SAMPLE_CEILING, i / 2048 - 1)),
  );
}

// Normalization re-decodes the kept range, so wait for trim drags to settle.
const ANALYSIS_DELAY_MS = 400;
const DRIFT_SEC = 0.05;

/** Creates the route on first play because createMediaElementSource permanently takes over audio. */
export function mountPreviewAudio(
  video: HTMLVideoElement,
  input: Input,
  onNormalization: (db: number) => void = () => {},
  onUnavailable: (message: string) => void = () => {},
) {
  let context: AudioContext | undefined;
  let originalGain: GainNode | undefined;
  let addedGain: GainNode | undefined;
  let masterGain: GainNode | undefined;
  let ceiling: WaveShaperNode | undefined;
  let ceilingCurve: Float32Array<ArrayBuffer> | undefined;
  let addedElement: HTMLAudioElement | undefined;
  let addedSource: MediaElementAudioSourceNode | undefined;
  let addedFile: File | undefined;
  let addedUrl: string | undefined;
  let pendingPlay: Promise<void> | undefined;
  let addedFailed = false;
  let target: PreviewAudioTarget = null;
  let normalizationDb = 0;
  let analysisKey = '';
  let analysisInput: Input | undefined;
  let analysis: AbortController | undefined;
  let analysisTimer: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;
  let destroyed = false;

  function apply(): void {
    if (!context || !originalGain || !addedGain || !masterGain) return;
    if (ceiling) {
      const active = target && (hasAudioProcessing(target.processing) || hasAudioMix(target.mix));
      if (active && !ceiling.curve) ceiling.curve = ceilingCurve ??= previewCeilingCurve();
      else if (!active && ceiling.curve) ceiling.curve = null;
    }
    const tracks = previewTrackGains(target);
    originalGain.gain.setTargetAtTime(tracks.original, context.currentTime, 0.01);
    addedGain.gain.setTargetAtTime(target?.added ? tracks.added : 0, context.currentTime, 0.01);
    masterGain.channelCount = target?.channels ?? 2;
    masterGain.gain.setTargetAtTime(
      previewGain(target, normalizationDb, video.currentTime),
      context.currentTime,
      0.01,
    );
  }

  function stopAdded(): void {
    addedElement?.pause();
    addedSource?.disconnect();
    if (addedElement) {
      addedElement.removeEventListener('loadedmetadata', onSeek);
      addedElement.removeEventListener('error', onAddedError);
      addedElement.removeAttribute('src');
      addedElement.load();
    }
    if (addedUrl) URL.revokeObjectURL(addedUrl);
    addedElement = undefined;
    addedSource = undefined;
    addedFile = undefined;
    addedUrl = undefined;
    pendingPlay = undefined;
    addedFailed = false;
  }

  function markAddedUnavailable(): void {
    if (destroyed || !addedElement || addedFailed) return;
    addedFailed = true;
    pendingPlay = undefined;
    addedElement.pause();
    onUnavailable('This browser cannot preview the added audio. You can still export the mix.');
  }

  function onAddedError(): void {
    if (addedElement?.error?.code !== 1) markAddedUnavailable();
  }

  function syncAdded(force = false): void {
    if (!addedElement || !target?.added || !target.mix?.added) return;
    const position = addedAudioTime(
      video.currentTime,
      target.trim,
      normalizeAudioMix(target.mix, target.trim.end - target.trim.start).added!,
      target.added.duration,
    );
    addedElement.volume = video.volume;
    addedElement.muted = video.muted;
    addedElement.playbackRate = video.playbackRate;
    addedElement.loop = target.mix.added.loop;
    if (position === null || video.seeking) {
      addedElement.pause();
      return;
    }
    if (
      addedElement.readyState > 0 &&
      (force || Math.abs(addedElement.currentTime - position) > DRIFT_SEC)
    )
      addedElement.currentTime = position;
    if (video.paused) addedElement.pause();
    else if (addedElement.paused && !pendingPlay && !addedFailed) {
      const element = addedElement;
      const attempt = element.play();
      pendingPlay = attempt;
      void attempt
        .then(() => {
          if (!destroyed && element === addedElement && !addedFailed) onUnavailable('');
        })
        .catch((error: unknown) => {
          if (
            destroyed ||
            element !== addedElement ||
            video.paused ||
            (error instanceof DOMException && error.name === 'AbortError')
          )
            return;
          markAddedUnavailable();
        })
        .finally(() => {
          if (pendingPlay === attempt) pendingPlay = undefined;
        });
    }
  }

  function connectAdded(): void {
    const added = target?.added;
    if (addedFile === added?.file) return;
    stopAdded();
    onUnavailable('');
    if (!added || !context || !addedGain) return;
    addedFile = added.file;
    addedUrl = URL.createObjectURL(added.file);
    addedElement = new Audio(addedUrl);
    addedElement.preload = 'auto';
    addedElement.addEventListener('loadedmetadata', onSeek);
    addedElement.addEventListener('error', onAddedError);
    addedSource = context.createMediaElementSource(addedElement);
    addedSource.connect(addedGain);
    syncAdded(true);
  }

  function tick(): void {
    apply();
    syncAdded();
    frame = video.paused ? 0 : requestAnimationFrame(tick);
  }

  function connect(): void {
    if (!context && target && (hasAudioProcessing(target.processing) || hasAudioMix(target.mix))) {
      try {
        context = new AudioContext();
        originalGain = context.createGain();
        addedGain = context.createGain();
        masterGain = context.createGain();
        masterGain.channelCountMode = 'explicit';
        context.createMediaElementSource(video).connect(originalGain).connect(masterGain);
        addedGain.connect(masterGain);
        ceiling = context.createWaveShaper();
        ceiling.oversample = 'none';
        masterGain.connect(ceiling).connect(context.destination);
      } catch (error) {
        console.warn('Preview audio processing is unavailable.', error);
        void context?.close();
        context = undefined;
        originalGain = undefined;
        addedGain = undefined;
        masterGain = undefined;
        ceiling = undefined;
      }
    }
    connectAdded();
  }

  function onPlay(): void {
    addedFailed = false;
    pendingPlay = undefined;
    connect();
    void context?.resume();
    cancelAnimationFrame(frame);
    tick();
  }

  function onPause(): void {
    addedElement?.pause();
    cancelAnimationFrame(frame);
    frame = 0;
  }

  function onSeek(): void {
    apply();
    syncAdded(true);
  }

  function syncVolume(): void {
    syncAdded();
  }

  function analyse(): void {
    const normalize = target ? normalizeAudioProcessing(target.processing, 1).normalize : null;
    const key =
      target && normalize !== null
        ? `${normalize}|${target.trim.start}|${target.trim.end}|${target.channels}|${JSON.stringify(target.mix)}`
        : '';
    const addedInput = target?.added?.input;
    if (key === analysisKey && addedInput === analysisInput) return;
    analysisKey = key;
    analysisInput = addedInput;
    analysis?.abort();
    clearTimeout(analysisTimer);
    normalizationDb = 0;
    onNormalization(0);
    if (!key || !target) return;
    const { processing, trim, channels, mix, added } = target;
    analysisTimer = setTimeout(() => {
      const controller = new AbortController();
      analysis = controller;
      const measure = async () => {
        if (hasAudioMix(mix)) {
          const processor = createMixProcessor(
            input,
            added,
            mix,
            trim,
            channels,
            48000,
            processing,
          );
          await processor.prepare(controller.signal, () => {});
          return processor.normalizationDb();
        }
        const processor = createAudioProcessor(processing ?? {}, trim, channels);
        await processor.prepare(input, controller.signal, () => {});
        return processor.normalizationDb();
      };
      measure()
        .then((db) => {
          if (controller.signal.aborted) return;
          normalizationDb = db;
          onNormalization(normalizationDb);
          apply();
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted)
            console.warn('Preview loudness analysis failed; preview is not normalized.', error);
        });
    }, ANALYSIS_DELAY_MS);
  }

  video.addEventListener('play', onPlay);
  video.addEventListener('pause', onPause);
  video.addEventListener('seeking', onSeek);
  video.addEventListener('seeked', onSeek);
  video.addEventListener('ratechange', onSeek);
  video.addEventListener('volumechange', syncVolume);

  return {
    update(next: PreviewAudioTarget): void {
      target = next;
      analyse();
      if (context || !video.paused) connect();
      if (!video.paused) void context?.resume();
      apply();
      syncAdded();
    },
    destroy(): void {
      destroyed = true;
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('seeking', onSeek);
      video.removeEventListener('seeked', onSeek);
      video.removeEventListener('ratechange', onSeek);
      video.removeEventListener('volumechange', syncVolume);
      cancelAnimationFrame(frame);
      clearTimeout(analysisTimer);
      analysis?.abort();
      stopAdded();
      void context?.close();
    },
  };
}
