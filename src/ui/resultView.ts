import { AUDIO_FORMATS } from '../core/audioExtract';
import type { Settings, SourceInfo } from '../core/types';
import { mountAudioPlayer } from './audioPlayer';
import { mountCompare } from './compare';
import { codecLabel, type AppAction, type AppState } from './controller';
import { el, icon } from './dom';
import { formatBitrate, formatBytes, formatDuration } from './format';
import { sizeMeter } from './progress';
import { computePeaks } from './waveform';
import { audioLabel, clock, containerLabel, screenHeading, theaterToggle } from './viewSummaries';

type Of<K extends AppState['kind']> = Extract<AppState, { kind: K }>;
interface Mounted {
  update(value: AppState): void;
  destroy(): void;
}

function statsTable(
  source: SourceInfo,
  output: SourceInfo,
  trim: Settings['trim'],
  notSmaller: boolean,
  audioOnly: boolean,
  gifOnly = false,
): HTMLTableElement {
  const table = el('table', 'stats');
  const caption = el(
    'caption',
    'sr',
    audioOnly
      ? 'Original video and audio file compared'
      : gifOnly
        ? 'Original video and GIF compared'
        : 'Original and new video compared',
  );
  const thead = el('thead');
  const headRow = el('tr');
  const prop = el('th');
  prop.scope = 'col';
  prop.append(el('span', 'sr', 'Property'));
  const colOrig = el('th', undefined, audioOnly ? 'Original video' : 'Original');
  colOrig.scope = 'col';
  const colNew = el('th', undefined, audioOnly ? 'Audio file' : gifOnly ? 'GIF' : 'New');
  colNew.scope = 'col';
  headRow.append(prop, colOrig, colNew);
  thead.append(headRow);
  const tbody = el('tbody', 'num');

  const resolution = (i: SourceInfo) =>
    i.video ? `${i.video.displayWidth}x${i.video.displayHeight}` : 'No video';
  const fps = (i: SourceInfo) => (i.video ? `${Number(i.video.fps.toFixed(2))} fps` : '-');
  const video = (i: SourceInfo) =>
    `${i.video ? codecLabel(i.video.codec) : 'No video'}, ${containerLabel(i.containerMime)}`;
  const audio = (i: SourceInfo) =>
    i.audio
      ? [audioLabel(i.audio.codec), i.audio.bitrate ? formatBitrate(i.audio.bitrate) : null]
          .filter(Boolean)
          .join(' ')
      : 'None';
  const bitrate = (i: SourceInfo) =>
    i.durationSec > 0 ? formatBitrate((i.sizeBytes * 8) / i.durationSec) : '-';
  const sourceCodecs = (i: SourceInfo) =>
    `${[i.video ? codecLabel(i.video.codec) : null, i.audio ? audioLabel(i.audio.codec) : null]
      .filter(Boolean)
      .join('/')} ${containerLabel(i.containerMime)}`;
  const audioBitrate = (i: SourceInfo) =>
    i.audio?.codec?.startsWith('pcm')
      ? 'Lossless'
      : i.audio?.bitrate
        ? formatBitrate(i.audio.bitrate)
        : bitrate(i);
  const row = (label: string, a: string, b: string | (string | Node)[]) => {
    const tr = el('tr');
    const th = el('th', undefined, label);
    th.scope = 'row';
    const td = el('td', 'new');
    td.append(...(typeof b === 'string' ? [b] : b));
    tr.append(th, el('td', undefined, a), td);
    tbody.append(tr);
  };
  row('Size', formatBytes(source.sizeBytes), formatBytes(output.sizeBytes));
  const trimmed = trim.end - trim.start < source.durationSec - 0.05;
  const durationRow = () =>
    row(
      'Duration',
      formatDuration(source.durationSec),
      trimmed
        ? [formatDuration(output.durationSec), el('span', 'delta', 'trimmed')]
        : formatDuration(output.durationSec),
    );
  if (audioOnly) {
    durationRow();
    row('Codec', sourceCodecs(source), audioLabel(output.audio?.codec ?? null));
    row('Bitrate', bitrate(source), audioBitrate(output));
  } else {
    if (source.video || output.video) {
      row('Resolution', resolution(source), resolution(output));
      row('Frame rate', fps(source), fps(output));
      row('Video', video(source), video(output));
    }
    if (!gifOnly) {
      row('Audio', audio(source), audio(output));
      row('Bitrate', bitrate(source), bitrate(output));
    }
    durationRow();
  }

  const total = el('tr', 'total');
  const th = el('th', undefined, notSmaller ? 'Change' : 'Reduction');
  th.scope = 'row';
  const td = el('td', undefined, reductionText(source.sizeBytes, output.sizeBytes));
  td.colSpan = 2;
  total.append(th, td);
  tbody.append(total);
  table.append(caption, thead, tbody);
  return table;
}

/** "90% smaller", "12% larger", "Same size" */
function reductionText(before: number, after: number): string {
  if (before <= 0) return '-';
  const change = Math.round((1 - after / before) * 100);
  if (after < before) return `${Math.max(1, change)}% smaller`;
  if (change === 0) return 'Same size';
  return `${-change}% larger`;
}

/** Result screen: verdict, wipe comparison, stats and the next actions. */
export function renderResult(
  container: HTMLElement,
  state: Of<'result'>,
  dispatch: (a: AppAction) => void,
): Mounted {
  const { output, source } = state;
  const audioOnly = state.tool === 'audio';
  const gifOnly = state.tool === 'gif';
  // WAV is lossless, so no setting makes it smaller and there is nothing to suggest.
  const lossless = audioOnly && state.audioSettings?.format === 'wav';
  const overTarget =
    state.tool === 'shrink' &&
    !!state.settings.targetSizeMB &&
    output.sizeBytes > state.settings.targetSizeMB * 1e6;
  const showNotSmaller = !overTarget && state.notSmaller && !lossless && !gifOnly;
  // The canvas holds the comparison or the player; the inspector holds the verdict, the
  // delivery actions, the stats and the next steps. Phones keep the same order in one column.
  const work = el('div', 'work result');
  const canvas = el('div', 'canvas');
  const side = el('aside', 'inspector result-rail');
  side.setAttribute('aria-label', 'Details and actions');

  const verdict = el('div', 'verdict');
  const figure = screenHeading('figure num');
  figure.append(
    `${formatBytes(output.sizeBytes)}, `,
    el(
      'em',
      output.sizeBytes > source.sizeBytes ? 'is-larger' : undefined,
      state.notSmaller && !gifOnly
        ? 'not smaller'
        : reductionText(source.sizeBytes, output.sizeBytes),
    ),
  );
  verdict.append(
    el(
      'span',
      'overline ok num',
      // A trimmed copy can finish in well under a second, which the clock would show as 0:00.
      state.elapsedMs < 1000 ? 'Done in under a second' : `Done in ${clock(state.elapsedMs)}`,
    ),
    figure,
    el(
      'p',
      'ready',
      state.sinkKind === 'file-stream'
        ? `${state.outputName} is saved where you chose.`
        : `${state.outputName} is ready to save or share.`,
    ),
  );
  side.append(verdict);

  if (state.styleDropped) {
    const warning = el('div', 'notice warn');
    warning.setAttribute('role', 'status');
    warning.append(
      icon('i-warn'),
      el(
        'p',
        undefined,
        'The export was saved without the selected style or colour correction because the graphics renderer became unavailable.',
      ),
    );
    side.append(warning);
  }

  const meter = sizeMeter(
    audioOnly ? 'Audio file' : 'New',
    audioOnly ? 'Original video' : 'Original',
  );
  meter.origValue.textContent = formatBytes(source.sizeBytes);
  meter.newValue.textContent = formatBytes(output.sizeBytes);
  meter.show(output.sizeBytes, output.sizeBytes, source.sizeBytes);
  side.append(meter.node);

  if (showNotSmaller) {
    const notice = el('div', 'notice warn not-smaller');
    notice.setAttribute('role', 'alert');
    const body = el('div', 'body');
    body.append(
      el(
        'h2',
        undefined,
        audioOnly
          ? 'The audio file is not smaller than the original video'
          : 'The new file is not smaller than the original',
      ),
      el(
        'p',
        undefined,
        audioOnly
          ? 'Lower the bitrate, or choose MP3 or M4A.'
          : 'This video was already compressed well. Make it smaller tries the next smaller size, or lower quality if no smaller size is left.',
      ),
    );
    notice.append(icon('i-warn'), body);
    side.append(notice);
  }

  if (overTarget) {
    const notice = el('div', 'notice warn not-smaller');
    notice.setAttribute('role', 'status');
    const body = el('div');
    body.append(
      el('h2', undefined, 'The output exceeds your target'),
      el(
        'p',
        undefined,
        `${formatBytes(output.sizeBytes)} actual versus ${formatBytes(state.settings.targetSizeMB! * 1e6)} target. Try again smaller lowers the video bitrate. A shorter trim can also help.`,
      ),
    );
    notice.append(icon('i-warn'), body);
    side.append(notice);
  }

  let compare: { destroy(): void } | undefined;
  let originalUrl: string | undefined;
  const peaksAbort = new AbortController();
  if (audioOnly && state.audioSettings) {
    const host = el('div', 'player-host');
    const a = output.info.audio;
    compare = mountAudioPlayer(host, {
      url: output.url,
      name: state.outputName,
      detail: [
        a ? audioLabel(a.codec) : AUDIO_FORMATS[state.audioSettings.format].label,
        a?.codec?.startsWith('pcm') || !a?.bitrate ? null : formatBitrate(a.bitrate),
        a ? (a.channels === 1 ? 'mono' : 'stereo') : null,
      ]
        .filter(Boolean)
        .join(' · '),
      peaks: output.url
        ? computePeaks(state.input, state.audioSettings.trim, 64, peaksAbort.signal)
        : Promise.resolve(null),
    });
    canvas.append(host);
  } else if (gifOnly && output.url) {
    const preview = el('img', 'gif-preview');
    preview.src = output.url;
    preview.alt = 'GIF preview';
    canvas.append(preview);
  } else if (output.url && output.info.video && source.video) {
    const host = el('div', 'compare');
    originalUrl = URL.createObjectURL(state.file);
    compare = mountCompare(host, {
      original: originalUrl,
      output: output.url,
      originalInfo: source,
      outputInfo: output.info,
      offsetSec: state.settings.trim.start,
    });
    canvas.append(host);
  } else if (!output.blob) {
    canvas.append(
      el(
        'p',
        'note compare-skipped',
        gifOnly
          ? 'The GIF was saved where you chose. Open it there to preview it.'
          : 'The new file went straight to the place you chose, so there is no side-by-side preview here. Open it from there to watch it.',
      ),
    );
  }

  const deliver = el('div', 'deliver');
  // A file-stream export is already saved; its url only feeds the preview.
  if (output.url && state.sinkKind !== 'file-stream') {
    const download = el('a', 'btn btn-primary btn-block');
    download.href = output.url;
    download.download = state.outputName;
    // The visible label stays one short verb; the name carries the file so it is announced.
    download.setAttribute('aria-label', `Download ${state.outputName}`);
    download.append(icon('i-down'), 'Download');
    deliver.append(download, el('p', 'file-out', state.outputName));
  }
  const shareNote = el('p', 'note share-note');
  shareNote.hidden = true;
  if (output.blob && state.caps.shareFiles && typeof navigator.share === 'function') {
    const blob = output.blob;
    const share = el('button', 'btn btn-block');
    share.type = 'button';
    share.append(icon('i-share'), 'Share');
    share.addEventListener('click', () => {
      const file = new File([blob], state.outputName, { type: blob.type });
      navigator.share({ files: [file] }).catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        console.error('sharing failed', err);
        shareNote.textContent =
          state.sinkKind === 'file-stream'
            ? 'Sharing did not work here. The file is saved where you chose.'
            : 'Sharing did not work here. Use Download instead.';
        shareNote.hidden = false;
      });
    });
    deliver.append(share);
  }
  if (deliver.childElementCount) side.append(deliver);
  side.append(shareNote);

  const stats = el('div', 'stats-block');
  stats.append(
    statsTable(
      source,
      output.info,
      audioOnly && state.audioSettings ? state.audioSettings.trim : state.settings.trim,
      state.notSmaller,
      audioOnly,
      gifOnly,
    ),
  );
  side.append(stats);

  // The recommended adjustment is a secondary button; starting over is a quiet text action.
  const actions = el('div', 'actions');
  if (!lossless && !gifOnly) {
    const smaller = el('button', showNotSmaller || overTarget ? 'btn is-suggested' : 'btn');
    smaller.type = 'button';
    smaller.append(
      icon('i-smaller'),
      audioOnly ? 'Lower bitrate' : overTarget ? 'Try again smaller' : 'Make it smaller',
    );
    smaller.addEventListener('click', () => dispatch({ type: 'smaller' }));
    actions.append(smaller);
  }
  const restart = el('button', 'btn btn-text');
  restart.type = 'button';
  restart.append(icon('i-restart'), 'Start over');
  restart.addEventListener('click', () => dispatch({ type: 'reset' }));
  actions.append(restart);
  side.append(actions);

  // Only a video comparison benefits from the wide layout.
  if (compare)
    canvas.prepend(theaterToggle('Use a wider comparison with a fixed-width details panel'));
  work.append(canvas, side);
  container.replaceChildren(work);
  figure.focus();

  return {
    update() {},
    destroy() {
      document.body.classList.remove('is-theater');
      peaksAbort.abort();
      compare?.destroy();
      if (originalUrl) URL.revokeObjectURL(originalUrl);
    },
  };
}
