import { el, icon } from './dom';
import { formatDuration } from './format';
import { formatTimelineLabel, parseTimecode, pickTickStep } from './timelineTicks';

export const MIN_TRIM_SPAN = 0.1;
export type Trim = { start: number; end: number };

export function thumbnailCount({
  stripWidth,
  stripHeight,
  aspect,
  duration,
}: {
  stripWidth: number;
  stripHeight: number;
  aspect: number;
  duration: number;
}): number {
  return Math.min(
    Math.max(4, Math.min(40, Math.ceil(stripWidth / (stripHeight * aspect)))),
    Math.ceil(duration / 0.5),
  );
}

export function clampTrim(t: Trim, duration: number, moved: 'start' | 'end'): Trim {
  if (!Number.isFinite(duration) || duration <= 0) return { start: 0, end: 0 };
  if (duration < MIN_TRIM_SPAN) return { start: 0, end: duration };
  const bound = (n: number, low: number, high: number) =>
    Math.min(high, Math.max(low, Number.isFinite(n) ? n : low));
  if (moved === 'start') {
    const end = bound(t.end, MIN_TRIM_SPAN, duration);
    return { start: bound(t.start, 0, end - MIN_TRIM_SPAN), end };
  }
  const start = bound(t.start, 0, duration - MIN_TRIM_SPAN);
  return { start, end: bound(t.end, start + MIN_TRIM_SPAN, duration) };
}

export interface TrimBarOptions {
  duration: number;
  aspect: number;
  value: Trim;
  video: HTMLVideoElement;
  thumbnails: (
    count: number,
    width: number,
    height: number,
    signal: AbortSignal,
  ) => Promise<HTMLCanvasElement[]>;
  previewPlayable?: boolean;
  onChange: (t: Trim) => void;
}

export function mountTrimBar(
  host: HTMLElement,
  opts: TrimBarOptions,
): {
  waveformSlot: HTMLElement;
  update(value: Trim): void;
  setPreviewPlayable(value: boolean): void;
  destroy(): void;
} {
  const { duration, video } = opts;
  let value = opts.value;
  let destroyed = false;
  let previewPlayable = opts.previewPlayable ?? true;
  let thumbnailAbort: AbortController | undefined;
  let requestedCount = 0;
  let thumbnailResizeTimer: ReturnType<typeof setTimeout> | undefined;
  const section = el('section', 'trim');
  section.setAttribute('aria-label', 'Trim');
  const head = el('div', 'trim-head');
  const kept = el('span', 'num');
  head.append(el('h2', undefined, 'Trim'), kept);
  const strip = el('div', 'trim-strip');
  strip.setAttribute('aria-label', 'Trim range');
  const ruler = el('div', 'trim-ruler');
  ruler.setAttribute('aria-hidden', 'true');
  const ticks = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  ruler.append(ticks);
  const thumbs = el('div', 'trim-thumbs');
  const before = el('span', 'trim-out');
  const after = el('span', 'trim-out');
  const selection = el('span', 'trim-selection');
  const playhead = el('button', 'trim-playhead');
  playhead.type = 'button';
  playhead.setAttribute('role', 'slider');
  playhead.setAttribute('aria-label', 'Playback position');
  playhead.setAttribute('aria-valuemin', '0');
  playhead.setAttribute('aria-valuemax', String(duration));
  const handles = (['start', 'end'] as const).map((side) => {
    const handle = el('button', `trim-handle ${side}`);
    handle.type = 'button';
    handle.title = `Set the ${side} of the kept clip. Drag to trim, or use arrow keys for 0.1-second steps; hold Shift for 1-second steps`;
    handle.setAttribute('role', 'slider');
    handle.setAttribute('aria-label', side === 'start' ? 'Start' : 'End');
    handle.addEventListener('keydown', (event) => {
      const direction =
        event.key === 'ArrowLeft' || event.key === 'ArrowDown'
          ? -1
          : event.key === 'ArrowRight' || event.key === 'ArrowUp'
            ? 1
            : 0;
      if (!direction) return;
      event.preventDefault();
      const step = event.shiftKey ? 1 : 0.1;
      change(
        side,
        Math.round(((side === 'start' ? value.start : value.end) + direction * step) * 10) / 10,
      );
    });
    let activePointer: number | null = null;
    handle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      activePointer = event.pointerId;
      if (event.isTrusted) handle.setPointerCapture(event.pointerId);
      move(side, event);
    });
    handle.addEventListener('pointermove', (event) => {
      if (activePointer === event.pointerId) move(side, event);
    });
    handle.addEventListener('pointerup', () => {
      activePointer = null;
    });
    handle.addEventListener('pointercancel', () => {
      activePointer = null;
    });
    return handle;
  });
  strip.append(thumbs, before, after, selection, ...handles, playhead);

  const readouts = el('div', 'trim-readouts');
  if (duration >= 3600) readouts.classList.add('trim-hours');
  const inputs: HTMLInputElement[] = [];
  const errors: HTMLParagraphElement[] = [];
  const playheadButtons: HTMLButtonElement[] = [];
  for (const side of ['start', 'end'] as const) {
    const group = el('div', 'trim-readout');
    const label = el('span', 'trim-label', side === 'start' ? 'Start' : 'End');
    const input = el('input', 'trim-input num') as HTMLInputElement;
    input.type = 'text';
    input.inputMode = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.disabled = duration < MIN_TRIM_SPAN;
    input.setAttribute('aria-label', side === 'start' ? 'Trim start' : 'Trim end');
    const error = el(
      'p',
      'setting-reason trim-error',
      'Enter a time within the clip, keeping at least 0.1 seconds.',
    );
    error.id = `trim-${side}-error`;
    error.hidden = true;
    input.setAttribute('aria-describedby', error.id);
    const clearError = () => {
      input.setAttribute('aria-invalid', 'false');
      error.hidden = true;
    };
    const revert = () => {
      input.value = formatDuration(value[side], { tenths: true });
      clearError();
    };
    const commit = () => {
      const time = parseTimecode(input.value);
      if (
        time === null ||
        time < 0 ||
        time > duration ||
        (side === 'start' ? time > value.end - MIN_TRIM_SPAN : time < value.start + MIN_TRIM_SPAN)
      ) {
        input.setAttribute('aria-invalid', 'true');
        error.hidden = false;
        return;
      }
      clearError();
      input.value = formatDuration(time, { tenths: true });
      change(side, time);
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commit();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        revert();
        input.blur();
      }
    });
    input.addEventListener('blur', () => {
      if (input.getAttribute('aria-invalid') !== 'true') commit();
    });
    input.addEventListener('input', clearError);
    const button = el('button', 'btn btn-cue', 'Set');
    button.type = 'button';
    button.title = `Set ${side} to playhead`;
    button.setAttribute('aria-label', button.title);
    button.prepend(icon(side === 'start' ? 'i-start' : 'i-end'));
    button.addEventListener('click', () => change(side, video.currentTime));
    group.append(label, input, error, button);
    readouts.append(group);
    inputs.push(input);
    errors.push(error);
    playheadButtons.push(button);
  }
  // Audio lanes sit directly under the filmstrip so they share its timeline.
  const waveformSlot = el('div', 'trim-lanes');
  section.append(head, ruler, strip, waveformSlot, readouts);
  host.replaceChildren(section);

  function renderRuler(): void {
    const width = strip.clientWidth;
    if (!width || !duration) return;
    const { major, minor } = pickTickStep(duration, width);
    ticks.setAttribute('viewBox', `0 0 ${width} 28`);
    const lines: string[] = [];
    if (minor) {
      for (let n = 0; n * minor <= duration + 1e-8; n++) {
        const x = (n * minor * width) / duration;
        lines.push(`M${x} 20v8`);
      }
    }
    const labels: SVGTextElement[] = [];
    for (let n = 0; n * major <= duration + 1e-8; n++) {
      const time = n * major;
      const x = (time * width) / duration;
      lines.push(`M${x} 16v12`);
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', String(x));
      label.setAttribute('y', '12');
      label.setAttribute('text-anchor', x < 30 ? 'start' : x > width - 30 ? 'end' : 'middle');
      label.textContent = formatTimelineLabel(time, duration, major < 1);
      labels.push(label);
    }
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', lines.join(''));
    ticks.replaceChildren(path, ...labels);
  }
  function requestThumbnails(): void {
    if (!strip.clientWidth || !strip.clientHeight || !duration) return;
    const count = thumbnailCount({
      stripWidth: strip.clientWidth,
      stripHeight: strip.clientHeight,
      aspect: opts.aspect,
      duration,
    });
    if (count === requestedCount) return;
    requestedCount = count;
    thumbnailAbort?.abort();
    const controller = new AbortController();
    thumbnailAbort = controller;
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    void opts
      .thumbnails(
        count,
        Math.ceil((strip.clientWidth / count) * scale),
        Math.ceil(strip.clientHeight * scale),
        controller.signal,
      )
      .then((canvases) => {
        if (!destroyed && !controller.signal.aborted) thumbs.replaceChildren(...canvases);
      })
      .catch((error: unknown) => {
        if (!destroyed && !controller.signal.aborted)
          console.warn('Could not render video thumbnails', error);
      });
  }
  const rulerResize = new ResizeObserver(() => {
    renderRuler();
    clearTimeout(thumbnailResizeTimer);
    thumbnailResizeTimer = setTimeout(requestThumbnails, 200);
  });
  rulerResize.observe(strip);

  let activeScrub: number | null = null;
  let resumeAfterScrub = false;
  let seekFrame = 0;
  let pendingSeek = 0;
  function positionAt(event: PointerEvent): number {
    const rect = strip.getBoundingClientRect();
    return rect.width
      ? Math.min(duration, Math.max(0, ((event.clientX - rect.left) / rect.width) * duration))
      : 0;
  }
  function seek(position: number, exact: boolean): void {
    if (exact || !video.fastSeek) video.currentTime = position;
    else video.fastSeek(position);
    setPercent(playhead, 'left', position);
    playhead.setAttribute('aria-valuenow', String(position));
    playhead.setAttribute('aria-valuetext', formatDuration(position));
  }
  function startScrub(event: PointerEvent): void {
    if (
      !previewPlayable ||
      (event.target instanceof Element && event.target.closest('.trim-handle'))
    )
      return;
    event.preventDefault();
    activeScrub = event.pointerId;
    resumeAfterScrub = !video.paused;
    if (resumeAfterScrub) video.pause();
    if (event.isTrusted) (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    pendingSeek = positionAt(event);
    seek(pendingSeek, true);
  }
  function moveScrub(event: PointerEvent): void {
    if (activeScrub !== event.pointerId) return;
    pendingSeek = positionAt(event);
    if (!seekFrame)
      seekFrame = requestAnimationFrame(() => {
        seekFrame = 0;
        seek(pendingSeek, false);
      });
  }
  function endScrub(event: PointerEvent, cancelled = false): void {
    if (activeScrub !== event.pointerId) return;
    if (seekFrame) cancelAnimationFrame(seekFrame);
    seekFrame = 0;
    seek(cancelled ? pendingSeek : positionAt(event), true);
    activeScrub = null;
    if (resumeAfterScrub)
      void video.play().catch((error: unknown) => console.warn('Could not resume preview', error));
    resumeAfterScrub = false;
  }
  for (const target of [ruler, strip]) {
    target.addEventListener('pointerdown', startScrub);
    target.addEventListener('pointermove', moveScrub);
    target.addEventListener('pointerup', endScrub);
    target.addEventListener('pointercancel', (event) => endScrub(event, true));
    target.addEventListener('lostpointercapture', (event) => {
      if (activeScrub === event.pointerId) endScrub(event, true);
    });
  }
  playhead.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 5 : 1;
    const position =
      event.key === 'Home'
        ? value.start
        : event.key === 'End'
          ? value.end
          : event.key === 'PageUp'
            ? video.currentTime + 10
            : event.key === 'PageDown'
              ? video.currentTime - 10
              : event.key === 'ArrowRight'
                ? video.currentTime + step
                : event.key === 'ArrowLeft'
                  ? video.currentTime - step
                  : null;
    if (position === null || !previewPlayable) return;
    event.preventDefault();
    seek(Math.min(duration, Math.max(0, position)), true);
  });

  function move(side: 'start' | 'end', event: PointerEvent): void {
    const rect = strip.getBoundingClientRect();
    if (rect.width) change(side, ((event.clientX - rect.left) / rect.width) * duration);
  }
  function change(side: 'start' | 'end', position: number): void {
    const next = clampTrim({ ...value, [side]: position }, duration, side);
    if (next.start !== value.start || next.end !== value.end) opts.onChange(next);
  }
  function setPercent(
    node: HTMLElement,
    property: 'left' | 'right' | 'width',
    seconds: number,
  ): void {
    node.style[property] = `${duration > 0 ? (seconds / duration) * 100 : 0}%`;
  }
  function update(next: Trim): void {
    value = next;
    kept.textContent = `${formatDuration(next.end - next.start, { tenths: true })} of ${formatDuration(duration, { tenths: true })} kept`;
    for (const [index, side] of (['start', 'end'] as const).entries()) {
      const input = inputs[index]!;
      if (document.activeElement !== input) {
        input.value = formatDuration(next[side], { tenths: true });
        input.setAttribute('aria-invalid', 'false');
        errors[index]!.hidden = true;
      }
    }
    setPercent(before, 'width', next.start);
    setPercent(after, 'left', next.end);
    setPercent(selection, 'left', next.start);
    setPercent(selection, 'width', next.end - next.start);
    for (const [index, side] of (['start', 'end'] as const).entries()) {
      const position = next[side];
      const handle = handles[index]!;
      setPercent(handle, 'left', position);
      handle.setAttribute(
        'aria-valuemin',
        String(side === 'start' ? 0 : Math.min(duration, next.start + MIN_TRIM_SPAN)),
      );
      handle.setAttribute(
        'aria-valuemax',
        String(side === 'start' ? Math.max(0, next.end - MIN_TRIM_SPAN) : duration),
      );
      handle.setAttribute('aria-valuenow', String(position));
      handle.setAttribute('aria-valuetext', formatDuration(position));
      handle.disabled = duration < MIN_TRIM_SPAN;
    }
  }
  function setPreviewPlayable(next: boolean): void {
    previewPlayable = next;
    playhead.disabled = !next;
    for (const button of playheadButtons) {
      button.disabled = !previewPlayable;
    }
  }
  function onTimeUpdate(): void {
    if (activeScrub !== null) return;
    if (!video.paused && (video.currentTime >= value.end || video.currentTime < value.start))
      video.currentTime = value.start;
    setPercent(playhead, 'left', video.currentTime);
    playhead.setAttribute('aria-valuenow', String(video.currentTime));
    playhead.setAttribute('aria-valuetext', formatDuration(video.currentTime));
  }
  video.addEventListener('timeupdate', onTimeUpdate);
  video.addEventListener('seeked', onTimeUpdate);
  video.addEventListener('play', onTimeUpdate);
  update(value);
  setPreviewPlayable(previewPlayable);
  onTimeUpdate();
  requestThumbnails();
  return {
    waveformSlot,
    update,
    setPreviewPlayable,
    destroy() {
      destroyed = true;
      thumbnailAbort?.abort();
      clearTimeout(thumbnailResizeTimer);
      rulerResize.disconnect();
      if (seekFrame) cancelAnimationFrame(seekFrame);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('seeked', onTimeUpdate);
      video.removeEventListener('play', onTimeUpdate);
    },
  };
}
