import { writesWhileEncoding } from '../core/convert';
import type { AppState } from './controller';
import { el } from './dom';
import { formatDuration } from './format';
import { mountProgress } from './progress';
import { screenHeading, summaryAudio, summaryGif, summaryOutput } from './viewSummaries';

type Of<K extends AppState['kind']> = Extract<AppState, { kind: K }>;
interface Mounted {
  update(value: AppState): void;
  destroy(): void;
}

/** Working screen: what is being made, a still of the source near the encode position, and progress. */
export function renderWorking(
  container: HTMLElement,
  state: Of<'working'>,
  onCancel: () => void,
): Mounted {
  const head = el('div', 'file-line');
  const fileText = el('div', 'file-text');
  const title = screenHeading('file-name');
  title.textContent = `${state.tool === 'audio' ? 'Extracting audio' : 'Exporting'} ${state.outputName}`;
  head.append(fileText);
  fileText.append(
    title,
    el(
      'p',
      'file-summary num',
      state.tool === 'audio' && state.audioSettings
        ? summaryAudio(state.audioSettings)
        : state.tool === 'gif' && state.gifSettings
          ? `${summaryGif(state.gifSettings, state.source, state.settings.transform)} · ${state.gifSettings.fps} fps GIF`
          : summaryOutput(state.settings),
    ),
  );

  const stage = el('div', 'stage working-stage');
  const video = el('video', 'stage-video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';
  video.setAttribute('aria-hidden', 'true');
  const url = URL.createObjectURL(state.file);
  video.src = url;
  // Seeking once makes the browser decode and show a frame; preload alone may leave it black.
  video.addEventListener(
    'loadedmetadata',
    () => {
      video.currentTime = state.settings.trim.start;
    },
    { once: true },
  );
  const overlay = el('span', 'overlay-time num');
  stage.append(video, overlay);

  const progressHost = el('div');
  const progress = mountProgress(progressHost, {
    onCancel,
    originalBytes: state.tool === 'gif' ? undefined : state.source.sizeBytes,
    expected: state.tool === 'gif' ? undefined : state.estimate,
    showBytes: state.tool !== 'gif',
    liveBytes: writesWhileEncoding(
      state.tool === 'audio' && state.audioSettings
        ? state.audioSettings.format
        : state.settings.container,
      state.sinkKind,
    ),
  });
  const note = el(
    'p',
    'note',
    'Keep this tab open until it finishes. Your phone may get warm; that is normal for video work.',
  );
  const canvas = el('div', 'canvas');
  canvas.append(stage, head);
  const inspector = el('div', 'inspector run');
  inspector.append(progressHost, note);
  const work = el('div', 'work working');
  work.append(canvas, inspector);
  container.replaceChildren(work);
  title.focus();

  const { start, end } = state.settings.trim;
  const span = Math.max(0, end - start);
  let lastSeek = -Infinity;
  // Seeking the preview competes with the encoder for decode time, so it moves rarely.
  const SEEK_EVERY_MS = 2000;
  function update(value: AppState): void {
    if (value.kind !== 'working') return;
    const analysing = value.phase === 'analysis';
    title.textContent = `${analysing ? 'Analysing loudness for' : state.tool === 'audio' ? 'Extracting audio' : 'Exporting'} ${state.outputName}`;
    const elapsed = Date.now() - value.startedAt;
    progress.update(value.progress, value.bytes, elapsed);
    const at = span * value.progress;
    overlay.textContent = `${analysing ? 'Analysing loudness' : 'Encoding'} ${formatDuration(at, { tenths: true })} of ${formatDuration(span, { tenths: true })}`;
    if (elapsed - lastSeek >= SEEK_EVERY_MS && video.readyState > 0) {
      lastSeek = elapsed;
      video.currentTime = start + at;
    }
  }
  update(state);
  return {
    update,
    destroy() {
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
    },
  };
}
