import type { Input } from 'mediabunny';
import {
  createAudioProcessor,
  dbGain,
  fadeEnvelope,
  hasAudioProcessing,
  normalizeAudioProcessing,
  type AudioProcessing,
} from '../core/audioProcess';

export type PreviewAudioTarget = {
  processing?: Partial<AudioProcessing>;
  trim: { start: number; end: number };
  channels: number;
} | null;

/** Linear gain the preview applies at source time `time`, matching export processing. */
export function previewGain(target: PreviewAudioTarget, normalizationDb: number, time: number): number {
  if (!target) return 1;
  const duration = target.trim.end - target.trim.start;
  const s = normalizeAudioProcessing(target.processing, duration);
  return dbGain(s.gainDb + normalizationDb) * fadeEnvelope(s, time - target.trim.start, duration);
}

// Normalization re-decodes the kept range, so wait for trim drags to settle.
const ANALYSIS_DELAY_MS = 400;

/**
 * Routes the preview element through Web Audio so gain, fades and normalization are audible
 * before export. The route is created on the first play with processing active, because
 * createMediaElementSource takes over the element's output permanently.
 */
export function mountPreviewAudio(video: HTMLVideoElement, input: Input) {
  let context: AudioContext | undefined;
  let gain: GainNode | undefined;
  let target: PreviewAudioTarget = null;
  let normalizationDb = 0;
  let analysisKey = '';
  let analysis: AbortController | undefined;
  let analysisTimer: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;

  function apply(): void {
    if (!context || !gain) return;
    gain.gain.setTargetAtTime(
      previewGain(target, normalizationDb, video.currentTime),
      context.currentTime,
      0.01,
    );
  }

  function tick(): void {
    apply();
    frame = video.paused ? 0 : requestAnimationFrame(tick);
  }

  function connect(): void {
    if (context || !target || !hasAudioProcessing(target.processing)) return;
    try {
      context = new AudioContext();
      gain = context.createGain();
      context.createMediaElementSource(video).connect(gain).connect(context.destination);
    } catch (error) {
      console.warn('Preview audio processing is unavailable; playing original audio.', error);
      void context?.close();
      context = undefined;
      gain = undefined;
    }
  }

  function onPlay(): void {
    connect();
    void context?.resume();
    cancelAnimationFrame(frame);
    tick();
  }

  function analyse(): void {
    const normalize = target ? normalizeAudioProcessing(target.processing, 1).normalize : null;
    const key =
      target && normalize !== null
        ? `${normalize}|${target.trim.start}|${target.trim.end}|${target.channels}`
        : '';
    if (key === analysisKey) return;
    analysisKey = key;
    analysis?.abort();
    clearTimeout(analysisTimer);
    normalizationDb = 0;
    if (!key || !target) return;
    const { processing, trim, channels } = target;
    analysisTimer = setTimeout(() => {
      const controller = new AbortController();
      analysis = controller;
      const processor = createAudioProcessor(processing ?? {}, trim, channels);
      processor
        .prepare(input, controller.signal, () => {})
        .then(() => {
          if (controller.signal.aborted) return;
          normalizationDb = processor.normalizationDb();
          apply();
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted)
            console.warn('Preview loudness analysis failed; preview is not normalized.', error);
        });
    }, ANALYSIS_DELAY_MS);
  }

  video.addEventListener('play', onPlay);
  video.addEventListener('seeked', apply);

  return {
    update(next: PreviewAudioTarget): void {
      target = next;
      analyse();
      if (!video.paused) connect();
      apply();
    },
    destroy(): void {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('seeked', apply);
      cancelAnimationFrame(frame);
      clearTimeout(analysisTimer);
      analysis?.abort();
      void context?.close();
    },
  };
}
