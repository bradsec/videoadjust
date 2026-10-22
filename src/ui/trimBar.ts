import { el, icon } from './dom';
import { formatDuration } from './format';

export const MIN_TRIM_SPAN = 0.1;
export type Trim = { start: number; end: number };

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
  value: Trim;
  video: HTMLVideoElement;
  thumbnails: (count: number, signal: AbortSignal) => Promise<HTMLCanvasElement[]>;
  previewPlayable?: boolean;
  onChange: (t: Trim) => void;
}

export function mountTrimBar(
  host: HTMLElement,
  opts: TrimBarOptions,
): { update(value: Trim): void; setPreviewPlayable(value: boolean): void; destroy(): void } {
  const { duration, video } = opts;
  let value = opts.value;
  let destroyed = false;
  let previewPlayable = opts.previewPlayable ?? true;
  const thumbnailAbort = new AbortController();
  const section = el('section', 'trim');
  section.setAttribute('aria-label', 'Trim');
  const head = el('div', 'trim-head');
  const kept = el('span', 'num');
  head.append(el('h2', undefined, 'Trim'), kept);
  const strip = el('div', 'trim-strip');
  strip.setAttribute('aria-label', 'Trim range');
  const thumbs = el('div', 'trim-thumbs');
  const before = el('span', 'trim-out');
  const after = el('span', 'trim-out');
  const selection = el('span', 'trim-selection');
  const playhead = el('span', 'trim-playhead');
  const handles = (['start', 'end'] as const).map((side) => {
    const handle = el('button', `trim-handle ${side}`);
    handle.type = 'button';
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
  const values: HTMLElement[] = [];
  const playheadButtons: HTMLButtonElement[] = [];
  for (const side of ['start', 'end'] as const) {
    const group = el('div', 'trim-readout');
    const label = el('span', 'trim-label', side === 'start' ? 'Start' : 'End');
    const output = el('output', 'trim-value num');
    const button = el('button', 'btn btn-cue', side === 'start' ? 'Start here' : 'End here');
    button.type = 'button';
    button.prepend(icon(side === 'start' ? 'i-start' : 'i-end'));
    button.addEventListener('click', () => change(side, video.currentTime));
    group.append(label, output, button);
    readouts.append(group);
    values.push(output);
    playheadButtons.push(button);
  }
  section.append(head, strip, readouts);
  host.replaceChildren(section);

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
    values[0]!.textContent = formatDuration(next.start, { tenths: true });
    values[1]!.textContent = formatDuration(next.end, { tenths: true });
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
    for (const button of playheadButtons) {
      button.disabled = !previewPlayable;
      button.title = previewPlayable ? '' : 'Requires a playable preview';
    }
  }
  function onTimeUpdate(): void {
    if (!video.paused && (video.currentTime >= value.end || video.currentTime < value.start))
      video.currentTime = value.start;
    setPercent(playhead, 'left', video.currentTime);
  }
  video.addEventListener('timeupdate', onTimeUpdate);
  video.addEventListener('seeked', onTimeUpdate);
  video.addEventListener('play', onTimeUpdate);
  update(value);
  setPreviewPlayable(previewPlayable);
  onTimeUpdate();
  const count = window.matchMedia('(max-width: 719px)').matches ? 8 : 12;
  void opts
    .thumbnails(count, thumbnailAbort.signal)
    .then((canvases) => {
      if (destroyed) return;
      thumbs.replaceChildren(...canvases);
    })
    .catch((error: unknown) => {
      if (!destroyed) console.warn('Could not render video thumbnails', error);
    });
  return {
    update,
    setPreviewPlayable,
    destroy() {
      destroyed = true;
      thumbnailAbort.abort();
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('seeked', onTimeUpdate);
      video.removeEventListener('play', onTimeUpdate);
    },
  };
}
