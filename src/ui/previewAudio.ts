import type { Input } from 'mediabunny';
import {
  createJoinFade,
  keptDuration,
  normalizeCutFade,
  normalizeCuts,
  sourceToOutput,
  type Cut,
} from '../core/cuts';
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
  cuts?: Cut[];
  cutFade?: number;
  channels: number;
} | null;

/** Linear gain the preview applies at source time `time`, matching export processing. */
/** Original-audio level for the cut fade at a source time; silent inside a fading cut. */
export function previewCutLevel(target: NonNullable<PreviewAudioTarget>, time: number): number {
  const fade = normalizeCutFade(target.cutFade);
  const output = sourceToOutput(time, target.trim, target.cuts);
  if (output === null) return fade ? 0 : 1;
  return createJoinFade(target.trim, target.cuts, fade)(output);
}

export function previewGain(
  target: PreviewAudioTarget,
  normalizationDb: number,
  time: number,
): number {
  if (!target) return 0;
  const output = sourceToOutput(time, target.trim, target.cuts);
  if (output === null) return 0;
  const duration = keptDuration(target.trim, target.cuts);
  const s = normalizeAudioProcessing(target.processing, duration);
  return dbGain(s.gainDb + normalizationDb) * fadeEnvelope(s, output, duration);
}

export function previewTrackGains(target: PreviewAudioTarget): { original: number; added: number } {
  if (!target) return { original: 1, added: 0 };
  const mix = normalizeAudioMix(target.mix, keptDuration(target.trim, target.cuts));
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
  cuts?: Cut[],
): number | null {
  const output = time < trim.end ? sourceToOutput(time, trim, cuts) : null;
  if (output === null) return null;
  const elapsed = output - added.offset;
  if (duration <= 0 || elapsed < 0 || (!added.loop && elapsed >= duration)) return null;
  return added.loop ? elapsed % duration : elapsed;
}

export function previewCeilingCurve(): Float32Array<ArrayBuffer> {
  return Float32Array.from({ length: 4097 }, (_, i) =>
    Math.max(-SAMPLE_CEILING, Math.min(SAMPLE_CEILING, i / 2048 - 1)),
  );
}

// Normalization re-decodes the kept range, so wait for trim drags to settle.
const ANALYSIS_DELAY_MS = 400;
// The added track plays from a decoded buffer on the AudioContext clock. A second media
// element drifts from the video (and re-seeking it flushes its buffer, which stutters), so
// it is only rescheduled on play, seek, rate change or when the video stalls or drifts.
const DRIFT_CHECK_MS = 1000;
const MAX_DRIFT_SEC = 0.25;

/**
 * When and where the added buffer should start, in video seconds from `time`: `delay` until
 * it becomes active and `offset` into the buffer. Null when it never plays before trim end.
 */
export function addedSchedule(
  time: number,
  trim: { start: number; end: number },
  added: { offset: number; loop: boolean },
  duration: number,
  cuts?: Cut[],
): { delay: number; offset: number; until: number } | null {
  const output = sourceToOutput(time, trim, cuts);
  const kept = keptDuration(trim, cuts);
  if (output === null || duration <= 0 || output >= kept || added.offset >= kept) return null;
  const until = kept - output;
  if (output < added.offset) return { delay: added.offset - output, offset: 0, until };
  const position = addedAudioTime(time, trim, added, duration, cuts);
  return position === null ? null : { delay: 0, offset: position, until };
}

/** Creates the route on first play because createMediaElementSource permanently takes over audio. */
export function mountPreviewAudio(
  video: HTMLVideoElement,
  input: Input,
  onNormalization: (db: number) => void = () => {},
  onUnavailable: (message: string) => void = () => {},
  onAnalysing: (busy: boolean) => void = () => {},
) {
  let context: AudioContext | undefined;
  let originalGain: GainNode | undefined;
  let addedGain: GainNode | undefined;
  let masterGain: GainNode | undefined;
  let ceiling: WaveShaperNode | undefined;
  let ceilingCurve: Float32Array<ArrayBuffer> | undefined;
  let addedFile: File | undefined;
  let addedBuffer: AudioBuffer | undefined;
  let addedNode: AudioBufferSourceNode | undefined;
  // Video and context times when the buffer was scheduled, to detect drift and stalls.
  let anchor: { video: number; context: number; rate: number } | undefined;
  let lastDriftCheck = 0;
  let decodeToken = 0;
  let target: PreviewAudioTarget = null;
  let normalizationDb = 0;
  let analysisKey = '';
  let analysisInput: Input | undefined;
  let analysis: AbortController | undefined;
  let analysisTimer: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;
  let destroyed = false;
  let lastPlacement = '';
  let mutedBeforeSilent: boolean | undefined;

  function apply(): void {
    if (!context || !originalGain || !addedGain || !masterGain) return;
    if (ceiling) {
      const active = target && (hasAudioProcessing(target.processing) || hasAudioMix(target.mix));
      if (active && !ceiling.curve) ceiling.curve = ceilingCurve ??= previewCeilingCurve();
      else if (!active && ceiling.curve) ceiling.curve = null;
    }
    const tracks = previewTrackGains(target);
    originalGain.gain.setTargetAtTime(
      tracks.original * (target ? previewCutLevel(target, video.currentTime) : 1),
      context.currentTime,
      0.01,
    );
    // The buffer bypasses the element, so apply the player's volume and mute to it here.
    const player = video.muted ? 0 : video.volume;
    addedGain.gain.setTargetAtTime(
      target?.added ? tracks.added * player : 0,
      context.currentTime,
      0.01,
    );
    masterGain.channelCount = target?.channels ?? 2;
    if (!target) masterGain.gain.setValueAtTime(0, context.currentTime);
    else
      masterGain.gain.setTargetAtTime(
        previewGain(target, normalizationDb, video.currentTime),
        context.currentTime,
        0.01,
      );
  }

  function stopNode(): void {
    if (addedNode) {
      addedNode.onended = null;
      try {
        addedNode.stop();
      } catch {
        // Not started yet or already stopped.
      }
      addedNode.disconnect();
    }
    addedNode = undefined;
    anchor = undefined;
  }

  function stopAdded(): void {
    stopNode();
    decodeToken++;
    addedFile = undefined;
    addedBuffer = undefined;
  }

  function startAdded(): void {
    stopNode();
    if (!context || !addedGain || !addedBuffer || !target?.added || !target.mix?.added) return;
    if (video.paused || video.seeking) return;
    const added = normalizeAudioMix(target.mix, keptDuration(target.trim, target.cuts)).added!;
    const rate = video.playbackRate || 1;
    const plan = addedSchedule(
      video.currentTime,
      target.trim,
      added,
      addedBuffer.duration,
      target.cuts,
    );
    anchor = { video: video.currentTime, context: context.currentTime, rate };
    lastDriftCheck = performance.now();
    if (!plan) return;
    const node = context.createBufferSource();
    node.buffer = addedBuffer;
    node.loop = added.loop;
    node.playbackRate.value = rate;
    node.connect(addedGain);
    const when = context.currentTime + plan.delay / rate;
    node.start(when, plan.offset);
    node.stop(context.currentTime + plan.until / rate);
    addedNode = node;
  }

  function connectAdded(): void {
    const added = target?.added;
    if (addedFile === added?.file) return;
    stopAdded();
    onUnavailable('');
    if (!added || !context) return;
    addedFile = added.file;
    const token = decodeToken;
    const decoding = context;
    void added.file
      .arrayBuffer()
      .then((bytes) => decoding.decodeAudioData(bytes))
      .then((buffer) => {
        if (destroyed || token !== decodeToken) return;
        addedBuffer = buffer;
        startAdded();
      })
      .catch((error: unknown) => {
        if (destroyed || token !== decodeToken) return;
        console.warn('Could not decode the added audio for preview.', error);
        onUnavailable('This browser cannot preview the added audio. You can still export the mix.');
      });
  }

  /** Restart the buffer if the video stalled or its clock drifted from the audio clock. */
  function checkDrift(): void {
    if (!context || !anchor || video.paused) return;
    const now = performance.now();
    if (now - lastDriftCheck < DRIFT_CHECK_MS) return;
    lastDriftCheck = now;
    const expected = anchor.video + (context.currentTime - anchor.context) * anchor.rate;
    if (Math.abs(video.currentTime - expected) > MAX_DRIFT_SEC) startAdded();
  }

  function tick(): void {
    apply();
    checkDrift();
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
    connect();
    void context?.resume();
    startAdded();
    cancelAnimationFrame(frame);
    tick();
  }

  function onPause(): void {
    stopNode();
    cancelAnimationFrame(frame);
    frame = 0;
  }

  function onSeeking(): void {
    stopNode();
  }

  function onResync(): void {
    apply();
    startAdded();
  }

  function syncVolume(): void {
    if (mutedBeforeSilent !== undefined && !video.muted) video.muted = true;
    apply();
  }

  function analyse(): void {
    const normalize = target ? normalizeAudioProcessing(target.processing, 1).normalize : null;
    const key =
      target && normalize !== null
        ? `${normalize}|${target.trim.start}|${target.trim.end}|${JSON.stringify(target.cuts)}|${target.cutFade ?? 0}|${target.channels}|${JSON.stringify(target.mix)}`
        : '';
    const addedInput = target?.added?.input;
    if (key === analysisKey && addedInput === analysisInput) return;
    analysisKey = key;
    analysisInput = addedInput;
    analysis?.abort();
    clearTimeout(analysisTimer);
    onAnalysing(false);
    normalizationDb = 0;
    onNormalization(0);
    if (!key || !target) return;
    const { processing, trim, cuts, cutFade, channels, mix, added } = target;
    analysisTimer = setTimeout(() => {
      const controller = new AbortController();
      analysis = controller;
      onAnalysing(true);
      const measure = async () => {
        if (hasAudioMix(mix) || normalizeCuts(cuts, trim).length) {
          const processor = createMixProcessor(
            input,
            added,
            mix,
            trim,
            channels,
            48000,
            processing,
            cuts,
            normalizeCutFade(cutFade),
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
        })
        .finally(() => {
          if (analysis === controller) onAnalysing(false);
        });
    }, ANALYSIS_DELAY_MS);
  }

  video.addEventListener('play', onPlay);
  video.addEventListener('pause', onPause);
  video.addEventListener('seeking', onSeeking);
  video.addEventListener('seeked', onResync);
  video.addEventListener('ratechange', onResync);
  video.addEventListener('waiting', onSeeking);
  video.addEventListener('playing', onResync);
  video.addEventListener('volumechange', syncVolume);

  return {
    update(next: PreviewAudioTarget, silent: boolean): void {
      if (silent && mutedBeforeSilent === undefined) {
        mutedBeforeSilent = video.muted;
        video.muted = true;
      }
      target = next;
      if (!silent && mutedBeforeSilent !== undefined) {
        video.muted = mutedBeforeSilent;
        mutedBeforeSilent = undefined;
      }
      analyse();
      if (context || !video.paused) connect();
      if (!video.paused) void context?.resume();
      apply();
      // Offset, loop or trim edits move where the buffer should be.
      const placement = JSON.stringify([next?.trim, next?.cuts, next?.mix?.added]);
      if (placement !== lastPlacement) {
        lastPlacement = placement;
        startAdded();
      }
    },
    destroy(): void {
      destroyed = true;
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('seeking', onSeeking);
      video.removeEventListener('seeked', onResync);
      video.removeEventListener('ratechange', onResync);
      video.removeEventListener('waiting', onSeeking);
      video.removeEventListener('playing', onResync);
      video.removeEventListener('volumechange', syncVolume);
      cancelAnimationFrame(frame);
      clearTimeout(analysisTimer);
      analysis?.abort();
      stopAdded();
      void context?.close();
    },
  };
}
