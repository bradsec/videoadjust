import { el, icon } from './dom';
import { formatDuration } from './format';

export interface AudioPlayerOptions {
  /** Null when the file went straight to disk and cannot be played back here. */
  url: string | null;
  name: string;
  detail: string;
  peaks: Promise<Float32Array | null>;
}

const SEEK_STEP_SEC = 5;
const MIN_BAR = 0.06;

function bars(peaks: Float32Array): HTMLElement {
  const row = el('div', 'wave-bars');
  for (const peak of peaks) {
    const bar = el('span');
    bar.style.height = `${Math.max(MIN_BAR, peak) * 100}%`;
    row.append(bar);
  }
  return row;
}

/** Name, codec detail, and for a playable file a play button and a seekable waveform. */
export function mountAudioPlayer(host: HTMLElement, opts: AudioPlayerOptions): { destroy(): void } {
  const card = el('section', 'card audio-player');
  card.setAttribute('aria-label', 'Audio player');
  const top = el('div', 'audio-top');
  const text = el('div', 'audio-text');
  text.append(el('b', 'audio-name', opts.name), el('span', 'audio-detail num', opts.detail));

  if (!opts.url) {
    top.append(text);
    card.append(top, el('p', 'note', 'Saved where you chose. Open it from there to play.'));
    host.replaceChildren(card);
    return { destroy() {} };
  }

  const audio = el('audio');
  audio.preload = 'metadata';
  audio.src = opts.url;

  const play = el('button', 'play-btn');
  play.type = 'button';
  top.append(play, text);

  const wave = el('div', 'wave');
  wave.tabIndex = 0;
  wave.setAttribute('role', 'slider');
  wave.setAttribute('aria-label', 'Seek');
  wave.setAttribute('aria-valuemin', '0');
  const shape = el('div', 'wave-shape');
  shape.setAttribute('aria-hidden', 'true');
  const track = el('div', 'wave-track');
  const head = el('span', 'wave-head');
  shape.append(track, head);
  wave.append(shape);

  const times = el('div', 'audio-times num');
  const now = el('span');
  const total = el('span');
  times.append(now, total);
  times.setAttribute('aria-hidden', 'true');

  card.append(top, wave, times, audio);
  host.replaceChildren(card);

  const length = () => (Number.isFinite(audio.duration) ? audio.duration : 0);

  function renderPlay(): void {
    const playing = !audio.paused;
    play.replaceChildren(icon(playing ? 'i-pause' : 'i-play'));
    play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  }

  function renderPosition(): void {
    const d = length();
    const t = Math.min(audio.currentTime, d || audio.currentTime);
    const fraction = d > 0 ? t / d : 0;
    wave.style.setProperty('--played', `${fraction * 100}%`);
    wave.setAttribute('aria-valuemax', String(Math.round(d)));
    wave.setAttribute('aria-valuenow', String(Math.round(t)));
    wave.setAttribute('aria-valuetext', `${formatDuration(t)} of ${formatDuration(d)}`);
    now.textContent = formatDuration(Math.floor(t));
    total.textContent = formatDuration(d);
  }

  function seek(sec: number): void {
    const d = length();
    if (d <= 0) return;
    audio.currentTime = Math.min(d, Math.max(0, sec));
    renderPosition();
  }

  play.addEventListener('click', () => {
    if (!audio.paused) {
      audio.pause();
      return;
    }
    audio.play().catch((err: unknown) => console.error('playing the audio failed', err));
  });
  for (const type of ['play', 'pause', 'ended'] as const) audio.addEventListener(type, renderPlay);
  for (const type of ['timeupdate', 'durationchange', 'loadedmetadata', 'seeked'] as const) {
    audio.addEventListener(type, renderPosition);
  }

  wave.addEventListener('keydown', (e) => {
    const steps: Record<string, number> = {
      ArrowRight: audio.currentTime + SEEK_STEP_SEC,
      ArrowUp: audio.currentTime + SEEK_STEP_SEC,
      ArrowLeft: audio.currentTime - SEEK_STEP_SEC,
      ArrowDown: audio.currentTime - SEEK_STEP_SEC,
      Home: 0,
      End: length(),
    };
    const target = steps[e.key];
    if (target === undefined) return;
    e.preventDefault();
    seek(target);
  });

  const seekToPointer = (e: PointerEvent) => {
    const box = shape.getBoundingClientRect();
    if (box.width > 0) seek(((e.clientX - box.left) / box.width) * length());
  };
  wave.addEventListener('pointerdown', (e) => {
    wave.setPointerCapture(e.pointerId);
    seekToPointer(e);
  });
  wave.addEventListener('pointermove', (e) => {
    if (wave.hasPointerCapture(e.pointerId)) seekToPointer(e);
  });

  let gone = false;
  void opts.peaks.then((peaks) => {
    if (gone || !peaks) return;
    track.replaceChildren(bars(peaks));
    track.classList.add('has-peaks');
    const played = bars(peaks);
    played.classList.add('wave-played');
    track.append(played);
  });

  renderPlay();
  renderPosition();
  return {
    destroy() {
      gone = true;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    },
  };
}
