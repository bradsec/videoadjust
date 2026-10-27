import {
  DEFAULT_CAPTIONS,
  MAX_CAPTIONS,
  normalizeCaptions,
  parseSubtitles,
  type Caption,
  type CaptionSettings,
} from '../core/captions';
import { el, icon, INSPECTOR_GROUP } from './dom';
import { formatDuration } from './format';
import { parseTimecode } from './timelineTicks';

const MAX_FILE_BYTES = 2_000_000;

function select<T extends string>(label: string, options: [T, string][], hint: string) {
  const node = el('select', 'setting-select');
  node.setAttribute('aria-label', `Caption ${label.toLowerCase()}`);
  for (const [value, text] of options) {
    const option = el('option', undefined, text);
    option.value = value;
    node.append(option);
  }
  const wrap = el('label', 'setting-label');
  wrap.title = hint;
  wrap.append(el('span', undefined, label), node);
  return { node, wrap };
}

export function mountCaptionPanel(
  video: HTMLVideoElement,
  duration: number,
  onChange: (captions: CaptionSettings) => void,
) {
  const details = el('details', 'adjust caption-adjust');
  details.name = INSPECTOR_GROUP;
  const heading = el('summary');
  const state = el('span', 'adjust-state');
  heading.append('Captions', state, icon('i-chev'));
  const controls = el('div', 'settings-controls');
  const reset = el('button', 'setting-reset', 'Clear');
  reset.type = 'button';
  reset.setAttribute('aria-label', 'Clear captions');
  reset.prepend(icon('i-reset'));
  const head = el('div', 'setting-head');
  head.append(el('strong', undefined, 'Captions'), el('span', 'setting-auto', 'Auto: Off'), reset);
  const setting = el('div', 'setting');
  setting.title = 'Burn timed captions into Shrink and GIF exports';
  const help = el(
    'p',
    'setting-help',
    'Import an SRT or WebVTT file, or add captions at the playhead. Times follow the source video.',
  );
  const file = el('input');
  file.type = 'file';
  file.accept = '.srt,.vtt,text/vtt,application/x-subrip';
  file.setAttribute('aria-label', 'Import captions file');
  const status = el('p', 'setting-reason');
  status.setAttribute('role', 'status');
  status.hidden = true;
  const add = el('button', 'btn caption-add', 'Add caption');
  add.type = 'button';
  add.title = 'Add a two-second caption at the playhead';
  const size = select(
    'Size',
    [
      ['small', 'Small'],
      ['medium', 'Medium'],
      ['large', 'Large'],
    ],
    'Caption text size, scaled to the output frame',
  );
  const position = select(
    'Position',
    [
      ['bottom', 'Bottom'],
      ['top', 'Top'],
    ],
    'Where captions sit in the frame',
  );
  const background = select(
    'Background',
    [
      ['outline', 'Outline'],
      ['box', 'Box'],
    ],
    'Outline the text, or draw a dark box behind it',
  );
  const list = el('div', 'caption-list');
  setting.append(head, help, file, status, add, size.wrap, position.wrap, background.wrap, list);
  controls.append(setting);
  details.append(heading, controls);

  let current = DEFAULT_CAPTIONS;
  let shown = '';
  const commit = (next: Partial<CaptionSettings>) =>
    onChange(normalizeCaptions({ ...current, ...next }));
  const report = (text: string) => {
    status.textContent = text;
    status.hidden = !text;
  };
  reset.addEventListener('click', () => {
    report('');
    onChange(DEFAULT_CAPTIONS);
  });
  file.addEventListener('change', async () => {
    const selected = file.files?.[0];
    file.value = '';
    if (!selected) return;
    if (selected.size > MAX_FILE_BYTES) return report('Choose a captions file under 2 MB.');
    try {
      const cues = parseSubtitles(await selected.text());
      if (!cues.length) return report('No captions found in that file.');
      report(
        cues.length > MAX_CAPTIONS
          ? `Imported the first ${MAX_CAPTIONS} of ${cues.length} captions.`
          : `Imported ${cues.length} caption${cues.length === 1 ? '' : 's'}.`,
      );
      commit({ cues });
    } catch {
      report('Could not read that captions file.');
    }
  });
  add.addEventListener('click', () => {
    const start = Math.min(video.currentTime || 0, Math.max(0, duration - 0.1));
    commit({
      cues: [...current.cues, { start, end: Math.min(duration, start + 2), text: 'Caption' }],
    });
  });
  size.node.addEventListener('change', () =>
    commit({ size: size.node.value as CaptionSettings['size'] }),
  );
  position.node.addEventListener('change', () =>
    commit({ position: position.node.value as CaptionSettings['position'] }),
  );
  background.node.addEventListener('change', () =>
    commit({ background: background.node.value as CaptionSettings['background'] }),
  );

  function replaceCue(index: number, cue: Caption | null) {
    commit({
      cues: cue
        ? current.cues.map((item, at) => (at === index ? cue : item))
        : current.cues.filter((_, at) => at !== index),
    });
  }

  function row(cue: Caption, index: number) {
    const node = el('div', 'caption-row');
    const label = `Caption ${index + 1}`;
    node.append(el('span', 'caption-row-label', label));
    for (const side of ['start', 'end'] as const) {
      const input = el('input', 'trim-input num');
      input.type = 'text';
      const shownTime = formatDuration(cue[side], { tenths: true });
      input.value = shownTime;
      input.setAttribute('aria-label', `${label} ${side}`);
      const apply = () => {
        // Imported cues keep millisecond times until their field is edited.
        if (input.value === shownTime) return;
        const time = parseTimecode(input.value);
        const next = { ...cue, [side]: time };
        if (time === null || time > duration || next.end <= next.start) {
          input.setAttribute('aria-invalid', 'true');
          return;
        }
        replaceCue(index, next);
      };
      input.addEventListener('change', apply);
      input.addEventListener('input', () => input.removeAttribute('aria-invalid'));
      node.append(el('span', 'trim-label', side === 'start' ? 'Start' : 'End'), input);
    }
    const text = el('textarea', 'caption-text');
    text.rows = 2;
    text.maxLength = 500;
    text.value = cue.text;
    text.setAttribute('aria-label', `${label} text`);
    text.addEventListener('change', () => {
      if (text.value.trim()) replaceCue(index, { ...cue, text: text.value });
      else replaceCue(index, null);
    });
    const remove = el('button', 'btn btn-cue', 'Remove');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Remove ${label.toLowerCase()}`);
    remove.addEventListener('click', () => replaceCue(index, null));
    node.append(text, remove);
    return node;
  }

  return {
    node: details,
    update(value: CaptionSettings | undefined, visible: boolean) {
      current = normalizeCaptions(value);
      details.hidden = !visible;
      size.node.value = current.size;
      position.node.value = current.position;
      background.node.value = current.background;
      add.disabled = current.cues.length >= MAX_CAPTIONS;
      const count = current.cues.length;
      state.textContent = count ? `${count} caption${count === 1 ? '' : 's'}` : 'Off';
      state.classList.toggle('is-changed', count > 0);
      const key = JSON.stringify(current.cues);
      if (key === shown) return;
      shown = key;
      list.replaceChildren(...current.cues.map(row));
    },
  };
}
