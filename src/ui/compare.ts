import type { SourceInfo } from '../core/types';
import { el, icon } from './dom';
import { formatDuration } from './format';

/** Largest gap between the two videos, in seconds, before the follower is seeked back into step. */
export const DRIFT_SEC = 0.1;

export function needsResync(masterT: number, slaveT: number): boolean {
  return Math.abs(masterT - slaveT) > DRIFT_SEC;
}

export function canPlaySource(video: HTMLVideoElement, mime: string): boolean {
  const playbackMime = mime.replace(/^video\/quicktime(?=\s*(?:;|$))/i, 'video/mp4');
  return video.canPlayType(playbackMime) !== '';
}

export interface CompareOptions {
  /** Object URLs; the caller owns and revokes them. */
  original: string;
  output: string;
  originalInfo: SourceInfo;
  outputInfo: SourceInfo;
  /** Where the output starts in the original (the trim start), in seconds. */
  offsetSec?: number;
}

const KEY_STEP = 5;
const PAGE_STEP = 10;

const shortEdge = (info: SourceInfo) =>
  info.video ? `${Math.min(info.video.displayWidth, info.video.displayHeight)}p` : '';

/**
 * Wipe comparison: the new video stacked over the original and clipped to the right of the
 * divider. The new video leads; the original follows it, offset by the trim start.
 */
export function mountCompare(host: HTMLElement, opts: CompareOptions): { destroy(): void } {
  const offset = opts.offsetSec ?? 0;
  const fps = opts.outputInfo.video?.fps || 30;

  const stage = el('div', 'stage compare-stage');
  stage.setAttribute('role', 'group');
  stage.setAttribute('aria-label', 'Compare original and new');
  const ov = opts.outputInfo.video;
  if (ov) stage.style.aspectRatio = `${ov.displayWidth} / ${ov.displayHeight}`;

  const original = el('video', 'compare-video');
  original.muted = true;
  original.playsInline = true;
  original.preload = 'auto';
  original.setAttribute('aria-label', 'Original video');
  const output = el('video', 'compare-video compare-new');
  output.playsInline = true;
  output.preload = 'auto';
  output.loop = true;
  output.setAttribute('aria-label', 'New video');

  const tagOriginal = el('span', 'side-tag l', `Original · ${shortEdge(opts.originalInfo)}`);
  const tagNew = el('span', 'side-tag r', `New · ${shortEdge(opts.outputInfo)}`);
  const line = el('span', 'wipe-line');
  const knob = el('div', 'wipe-knob');
  knob.tabIndex = 0;
  knob.setAttribute('role', 'slider');
  knob.setAttribute('aria-label', 'Wipe position');
  knob.setAttribute('aria-valuemin', '0');
  knob.setAttribute('aria-valuemax', '100');
  knob.append(icon('i-wipe'));
  stage.append(original, output, tagOriginal, tagNew, line, knob);

  const note = el(
    'p',
    'compare-note',
    'This browser cannot play the original for comparison, so only the new video is shown. The table still compares both.',
  );
  note.hidden = true;

  const bar = el('div', 'compare-bar');
  const seg = el('div', 'seg');
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'Compare mode');
  const playbackMode = el('button', undefined, 'Playback');
  const frameMode = el('button', undefined, 'Frame');
  for (const b of [playbackMode, frameMode]) b.type = 'button';
  seg.append(playbackMode, frameMode);

  const scrub = el('div', 'scrub');
  const play = el('button', 'btn');
  play.type = 'button';
  const prev = el('button', 'btn', 'Previous frame');
  const next = el('button', 'btn', 'Next frame');
  for (const b of [prev, next]) b.type = 'button';
  const range = el('input', 'scrub-range');
  range.type = 'range';
  range.min = '0';
  range.step = 'any';
  range.value = '0';
  range.setAttribute('aria-label', 'Position');
  const time = el('span', 'num scrub-time');
  scrub.append(play, prev, range, next, time);
  bar.append(seg, scrub);
  host.replaceChildren(stage, note, bar);

  let position = 50;
  let originalPlayable = true;

  function setPosition(value: number): void {
    position = Math.min(100, Math.max(0, value));
    output.style.clipPath = originalPlayable ? `inset(0 0 0 ${position}%)` : 'none';
    line.style.left = `${position}%`;
    knob.style.left = `${position}%`;
    knob.setAttribute('aria-valuenow', String(Math.round(position)));
    knob.setAttribute(
      'aria-valuetext',
      `${Math.round(position)}% original, ${100 - Math.round(position)}% new`,
    );
  }

  function showOriginalUnplayable(): void {
    if (!originalPlayable) return;
    originalPlayable = false;
    original.pause();
    original.removeAttribute('src');
    original.load();
    original.hidden = true;
    for (const node of [tagOriginal, line, knob]) node.hidden = true;
    note.hidden = false;
    setPosition(position);
  }

  function setMode(frames: boolean): void {
    playbackMode.setAttribute('aria-pressed', String(!frames));
    frameMode.setAttribute('aria-pressed', String(frames));
    play.hidden = frames;
    prev.hidden = !frames;
    next.hidden = !frames;
    if (frames) output.pause();
  }

  function renderClock(): void {
    const duration = Number.isFinite(output.duration)
      ? output.duration
      : opts.outputInfo.durationSec;
    range.max = String(duration);
    range.value = String(output.currentTime);
    time.textContent = `${formatDuration(output.currentTime, { tenths: true })} / ${formatDuration(duration, { tenths: true })}`;
    const paused = output.paused;
    play.replaceChildren(icon(paused ? 'i-play' : 'i-pause'));
    play.setAttribute('aria-label', paused ? 'Play' : 'Pause');
  }

  function follow(exact: boolean): void {
    if (!originalPlayable || original.readyState === 0) return;
    const target = output.currentTime + offset;
    if (exact ? original.currentTime !== target : needsResync(target, original.currentTime))
      original.currentTime = target;
    if (output.paused && !original.paused) original.pause();
    if (!output.paused && original.paused) void original.play().catch(() => {});
  }

  // requestVideoFrameCallback checks drift on every presented frame; timeupdate (about 4 Hz) is the fallback.
  let frameHandle: number | undefined;
  const onFrame = () => {
    follow(false);
    renderClock();
    frameHandle = output.requestVideoFrameCallback(onFrame);
  };
  const onTimeUpdate = () => {
    follow(false);
    renderClock();
  };
  // Older Safari and Firefox lack requestVideoFrameCallback even though the DOM types always declare it.
  if (typeof HTMLVideoElement.prototype.requestVideoFrameCallback === 'function')
    frameHandle = output.requestVideoFrameCallback(onFrame);
  else output.addEventListener('timeupdate', onTimeUpdate);

  output.addEventListener('play', () => {
    follow(false);
    renderClock();
  });
  output.addEventListener('pause', () => {
    follow(true);
    renderClock();
  });
  output.addEventListener('seeked', () => {
    follow(true);
    renderClock();
  });
  output.addEventListener('loadedmetadata', renderClock);
  original.addEventListener('loadedmetadata', () => follow(true));
  original.addEventListener('error', showOriginalUnplayable);

  play.addEventListener('click', () => {
    if (output.paused)
      void output.play().catch((err: unknown) => console.warn('playback did not start', err));
    else output.pause();
  });
  const step = (frames: number) => {
    output.pause();
    const duration = Number.isFinite(output.duration)
      ? output.duration
      : opts.outputInfo.durationSec;
    output.currentTime = Math.min(duration, Math.max(0, output.currentTime + frames / fps));
  };
  prev.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));
  range.addEventListener('input', () => {
    output.currentTime = Number(range.value);
  });
  playbackMode.addEventListener('click', () => setMode(false));
  frameMode.addEventListener('click', () => setMode(true));

  knob.addEventListener('keydown', (e) => {
    const moves: Record<string, number> = {
      ArrowLeft: position - KEY_STEP,
      ArrowDown: position - KEY_STEP,
      ArrowRight: position + KEY_STEP,
      ArrowUp: position + KEY_STEP,
      PageDown: position - PAGE_STEP,
      PageUp: position + PAGE_STEP,
      Home: 0,
      End: 100,
    };
    const value = moves[e.key];
    if (value === undefined) return;
    e.preventDefault();
    setPosition(value);
  });

  const fromPointer = (e: PointerEvent) => {
    const rect = stage.getBoundingClientRect();
    if (rect.width > 0) setPosition(((e.clientX - rect.left) / rect.width) * 100);
  };
  stage.addEventListener('pointerdown', (e) => {
    if (!originalPlayable || e.button !== 0) return;
    stage.setPointerCapture(e.pointerId);
    fromPointer(e);
    knob.focus({ preventScroll: true });
  });
  stage.addEventListener('pointermove', (e) => {
    if (stage.hasPointerCapture(e.pointerId)) fromPointer(e);
  });

  // The MIME type carries the codecs, so an empty answer catches e.g. HEVC on Chromium before
  // any bytes load; the error listener catches the rest.
  if (!canPlaySource(original, opts.originalInfo.containerMime)) showOriginalUnplayable();
  else original.src = opts.original;
  output.src = opts.output;
  setPosition(50);
  setMode(false);
  renderClock();

  return {
    destroy() {
      if (frameHandle !== undefined) output.cancelVideoFrameCallback(frameHandle);
      output.removeEventListener('timeupdate', onTimeUpdate);
      for (const v of [original, output]) {
        v.pause();
        v.removeAttribute('src');
        v.load();
      }
    },
  };
}
