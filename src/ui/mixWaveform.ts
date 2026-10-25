import type { Input } from 'mediabunny';
import {
  addedOffsetRange,
  describeAddedOffset,
  type AddedAudio,
  type AudioMix,
} from '../core/audioMix';
import {
  dbGain,
  fadeEnvelope,
  normalizeAudioProcessing,
  SAMPLE_CEILING,
  type AudioProcessing,
} from '../core/audioProcess';
import { el } from './dom';
import type { Trim } from './trimBar';
import { computePeaks } from './waveform';
import '../styles/audioMix.css';

export function scaledWaveformPeak(
  peak: number,
  trackDb: number,
  processing: Partial<AudioProcessing> | undefined,
  time: number,
  duration: number,
  normalizationDb = 0,
): number {
  const master = normalizeAudioProcessing(processing, duration);
  return (
    peak * dbGain(trackDb + master.gainDb + normalizationDb) * fadeEnvelope(master, time, duration)
  );
}

export function addedWaveformTime(
  sourceTime: number,
  trim: Trim,
  offset: number,
  duration: number,
  loop: boolean,
): number | null {
  const time = sourceTime - trim.start - offset;
  if (sourceTime >= trim.end || time < 0 || duration <= 0 || (!loop && time >= duration))
    return null;
  return loop ? time % duration : time;
}

export function waveformRangePeak(
  peaks: Float32Array,
  duration: number,
  start: number,
  end: number,
): number {
  if (duration <= 0 || !peaks.length || end <= start) return 0;
  const span = Math.min(duration, end - start);
  const at = ((start % duration) + duration) % duration;
  const first = Math.floor((at / duration) * peaks.length);
  const last = Math.ceil(((at + span) / duration) * peaks.length);
  let peak = 0;
  for (let i = first; i < last; i++) peak = Math.max(peak, peaks[i % peaks.length]!);
  return peak;
}

interface WaveformValue {
  trim: Trim;
  mix?: AudioMix;
  added?: AddedAudio;
  processing?: Partial<AudioProcessing>;
  normalizationDb?: number;
}

const PEAK_BINS = 2048;
const cache = new WeakMap<Input, { duration: number; peaks: Float32Array | null }>();

export function mountMixWaveform(
  host: HTMLElement,
  input: Input,
  sourceDuration: number,
  video?: HTMLVideoElement,
  onAddedOffset?: (offset: number) => void,
  // Reserve the original lane while its peaks decode, so the trim controls below never jump.
  sourceHasAudio = true,
) {
  let destroyed = false;
  let value: WaveformValue = { trim: { start: 0, end: sourceDuration } };
  let originalPeaks: Float32Array | null = null;
  let addedPeaks: Float32Array | null = null;
  let addedInput: Input | undefined;
  let addedAbort: AbortController | undefined;
  const sourceAbort = new AbortController();
  const section = el('section', 'mix-waveforms');
  section.setAttribute('aria-label', 'Audio waveform: original and added tracks');
  const lanes = (['Original', 'Added'] as const).map((name) => {
    const node = el('div', 'mix-waveform-lane');
    const label = el('span', 'mix-waveform-label', name);
    const canvas = el('canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `${name} audio waveform`);
    canvas.dataset.track = name.toLowerCase();
    node.append(label, canvas);
    section.append(node);
    return { node, label, canvas };
  });
  // The added lane doubles as a slider: drag or use arrow keys to choose which part plays.
  const addedCanvas = lanes[1]!.canvas;
  addedCanvas.setAttribute('role', 'slider');
  addedCanvas.setAttribute('aria-label', 'Added audio position');
  addedCanvas.tabIndex = 0;
  addedCanvas.classList.add('mix-waveform-drag');
  function offsetRange() {
    return addedOffsetRange(value.added?.duration ?? 0, value.trim.end - value.trim.start);
  }
  function moveAdded(offset: number): void {
    const added = value.mix?.added;
    if (!added || !onAddedOffset) return;
    const { min, max } = offsetRange();
    const next = Math.round(Math.min(max, Math.max(min, offset)) * 100) / 100;
    if (next !== added.offset) onAddedOffset(next);
  }
  let drag: { pointer: number; x: number; offset: number } | null = null;
  addedCanvas.addEventListener('pointerdown', (event) => {
    if (!value.mix?.added || !onAddedOffset) return;
    drag = { pointer: event.pointerId, x: event.clientX, offset: value.mix.added.offset };
    addedCanvas.setPointerCapture(event.pointerId);
    addedCanvas.classList.add('is-dragging');
  });
  addedCanvas.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointer || !addedCanvas.clientWidth) return;
    const seconds = ((event.clientX - drag.x) / addedCanvas.clientWidth) * sourceDuration;
    moveAdded(drag.offset + seconds);
  });
  const endDrag = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    drag = null;
    addedCanvas.classList.remove('is-dragging');
  };
  addedCanvas.addEventListener('pointerup', endDrag);
  addedCanvas.addEventListener('pointercancel', endDrag);
  addedCanvas.addEventListener('keydown', (event) => {
    const offset = value.mix?.added?.offset;
    if (offset === undefined) return;
    const step = event.shiftKey ? 1 : 0.1;
    const { min, max } = offsetRange();
    const next =
      event.key === 'ArrowLeft' || event.key === 'ArrowDown'
        ? offset - step
        : event.key === 'ArrowRight' || event.key === 'ArrowUp'
          ? offset + step
          : event.key === 'Home'
            ? min
            : event.key === 'End'
              ? max
              : null;
    if (next === null) return;
    event.preventDefault();
    moveAdded(next);
  });
  let drawFrame = 0;
  const status = el('p', 'setting-help mix-waveform-status');
  status.setAttribute('role', 'status');
  status.hidden = true;
  section.append(status);
  const clipHelp = el(
    'p',
    'setting-help',
    'Orange marks possible peaks above the -1 dBFS ceiling before limiting.',
  );
  section.append(clipHelp);
  host.replaceChildren(section);

  async function peaksFor(source: Input, duration: number, signal: AbortSignal) {
    const previous = cache.get(source);
    if (previous?.duration === duration) return previous.peaks;
    const peaks = await computePeaks(source, { start: 0, end: duration }, PEAK_BINS, signal);
    if (!signal.aborted) cache.set(source, { duration, peaks });
    return peaks;
  }

  function draw(): void {
    if (destroyed) return;
    const { trim } = value;
    const span = trim.end - trim.start;
    const master = normalizeAudioProcessing(value.processing, span);
    const normalizationDb = value.normalizationDb ?? 0;
    const original = value.mix?.original ?? { include: true, volumeDb: 0 };
    const added = value.mix?.added;
    section.hidden = !sourceHasAudio && !value.added;
    const theme = getComputedStyle(section);
    const accent = theme.getPropertyValue('--accent').trim();
    const muted = theme.getPropertyValue('--text-3').trim();
    const warning = theme.getPropertyValue('--warn').trim();
    const surface = theme.getPropertyValue('--raised').trim();
    const line = theme.getPropertyValue('--line').trim();
    const text = theme.getPropertyValue('--text').trim();
    let clipping = false;
    for (const [index, lane] of lanes.entries()) {
      const isAdded = index === 1;
      const peaks = isAdded ? addedPeaks : originalPeaks;
      const duration = isAdded ? (value.added?.duration ?? 0) : sourceDuration;
      const volumeDb = isAdded ? (added?.volumeDb ?? 0) : original.volumeDb;
      const included = isAdded || original.include;
      lane.node.hidden = isAdded ? !value.added : !sourceHasAudio;
      lane.label.textContent = isAdded ? 'Added' : included ? 'Original' : 'Original · Removed';
      if (isAdded && added) {
        const range = offsetRange();
        lane.canvas.setAttribute('aria-valuemin', String(range.min));
        lane.canvas.setAttribute('aria-valuemax', String(range.max));
        lane.canvas.setAttribute('aria-valuenow', String(added.offset));
        lane.canvas.setAttribute('aria-valuetext', describeAddedOffset(added.offset));
      }
      lane.canvas.dataset.ready = String(!!peaks);
      lane.canvas.dataset.gain = String(
        included ? dbGain(volumeDb + master.gainDb + normalizationDb) : 0,
      );
      lane.canvas.dataset.removed = String(!included);
      const width = lane.canvas.clientWidth;
      const height = lane.canvas.clientHeight || 56;
      if (!width) continue;
      const scale = window.devicePixelRatio || 1;
      lane.canvas.width = Math.round(width * scale);
      lane.canvas.height = Math.round(height * scale);
      const context = lane.canvas.getContext('2d');
      if (!context) continue;
      context.scale(scale, scale);
      context.fillStyle = surface;
      context.fillRect(0, 0, width, height);
      context.fillStyle = line;
      context.fillRect(0, height / 2, width, 1);
      let max = 0;
      if (peaks && duration > 0 && sourceDuration > 0) {
        for (let x = 0; x < width; x++) {
          const sourceTime = ((x + 0.5) / width) * sourceDuration;
          // Added audio only exists in the export inside the kept range; drawing a slid track's
          // earlier part over the trimmed-away source would suggest it plays there.
          if (isAdded && (sourceTime < trim.start || sourceTime >= trim.end)) continue;
          const time = isAdded
            ? addedWaveformTime(
                sourceTime,
                trim,
                added?.offset ?? 0,
                duration,
                added?.loop ?? false,
              )
            : sourceTime;
          if (time === null) continue;
          const from =
            (x / width) * sourceDuration - (isAdded ? trim.start + (added?.offset ?? 0) : 0);
          const to = from + sourceDuration / width;
          const peak = waveformRangePeak(
            peaks,
            duration,
            Math.max(0, from),
            isAdded && added?.loop ? to : Math.min(duration, to),
          );
          const inTrim = sourceTime >= trim.start && sourceTime < trim.end;
          const scaled = inTrim
            ? scaledWaveformPeak(
                peak,
                volumeDb,
                master,
                sourceTime - trim.start,
                span,
                normalizationDb,
              )
            : peak * dbGain(volumeDb + master.gainDb + normalizationDb);
          let combined = included ? scaled : 0;
          const otherPeaks = isAdded ? originalPeaks : addedPeaks;
          const otherIncluded = isAdded ? original.include : !!value.added;
          const otherDuration = isAdded ? sourceDuration : (value.added?.duration ?? 0);
          const otherTime = isAdded
            ? sourceTime
            : addedWaveformTime(
                sourceTime,
                trim,
                added?.offset ?? 0,
                otherDuration,
                added?.loop ?? false,
              );
          if (inTrim && otherIncluded && otherPeaks && otherTime !== null) {
            const otherFrom =
              (x / width) * sourceDuration - (isAdded ? 0 : trim.start + (added?.offset ?? 0));
            const otherTo = otherFrom + sourceDuration / width;
            const otherPeak = waveformRangePeak(
              otherPeaks,
              otherDuration,
              Math.max(0, otherFrom),
              !isAdded && added?.loop ? otherTo : Math.min(otherDuration, otherTo),
            );
            combined += scaledWaveformPeak(
              otherPeak,
              isAdded ? original.volumeDb : (added?.volumeDb ?? 0),
              master,
              sourceTime - trim.start,
              span,
              normalizationDb,
            );
          }
          if (included && inTrim) max = Math.max(max, scaled);
          context.globalAlpha = included && inTrim ? 1 : 0.25;
          const over = included && inTrim && combined > SAMPLE_CEILING;
          clipping ||= over;
          context.fillStyle = over ? warning : included ? accent : muted;
          const amplitude = Math.min(1, scaled) * (height / 2 - 2);
          context.fillRect(x, height / 2 - amplitude, 1, Math.max(1, amplitude * 2));
        }
      }
      context.globalAlpha = 1;
      lane.canvas.dataset.peak = String(max);
      // Explain orange only when some is drawn.
      clipHelp.hidden = !clipping;
      if (video && sourceDuration > 0) {
        context.fillStyle = text;
        context.fillRect((video.currentTime / sourceDuration) * width, 0, 1, height);
      }
    }
  }

  void peaksFor(input, sourceDuration, sourceAbort.signal).then((peaks) => {
    if (destroyed || sourceAbort.signal.aborted) return;
    originalPeaks = peaks;
    draw();
  });
  const resize = new ResizeObserver(draw);
  resize.observe(section);
  video?.addEventListener('timeupdate', draw);
  video?.addEventListener('seeked', draw);
  const themeChange = new MutationObserver(draw);
  themeChange.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'data-theme', 'style'],
  });

  return {
    update(next: WaveformValue): void {
      value = next;
      if (next.added?.input !== addedInput) {
        addedAbort?.abort();
        if (addedInput) cache.delete(addedInput);
        addedInput = next.added?.input;
        addedPeaks = null;
        if (next.added) {
          const controller = new AbortController();
          addedAbort = controller;
          void peaksFor(next.added.input, next.added.duration, controller.signal).then((peaks) => {
            if (destroyed || controller.signal.aborted) return;
            addedPeaks = peaks;
            draw();
          });
        }
      }
      // Slider drags update many times per frame; draw once per frame.
      if (!drawFrame)
        drawFrame = requestAnimationFrame(() => {
          drawFrame = 0;
          if (!destroyed) draw();
        });
    },
    /** Shows a short note while preview audio is being measured, or hides it with null. */
    setStatus(message: string | null): void {
      status.textContent = message ?? '';
      status.hidden = !message;
      section.setAttribute('aria-busy', String(!!message));
    },
    destroy(): void {
      destroyed = true;
      cancelAnimationFrame(drawFrame);
      sourceAbort.abort();
      addedAbort?.abort();
      if (addedInput) cache.delete(addedInput);
      resize.disconnect();
      themeChange.disconnect();
      video?.removeEventListener('timeupdate', draw);
      video?.removeEventListener('seeked', draw);
    },
  };
}
