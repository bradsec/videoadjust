import { keptDuration, normalizeCuts, type Cut } from '../core/cuts';
import { el } from './dom';
import { formatDuration } from './format';
import { parseTimecode } from './timelineTicks';
import type { Trim } from './trimBar';

export type { Cut };

export function mountCutControls(
  video: HTMLVideoElement,
  duration: number,
  initialTrim: Trim,
  initialCuts: Cut[],
  onChange?: (cuts: Cut[]) => void,
) {
  let trim = initialTrim;
  let cuts = initialCuts;
  const section = el('section', 'cut-sections');
  section.setAttribute('aria-label', 'Cut sections');
  const heading = el('h3', undefined, 'Cut sections');
  const help = el(
    'p',
    'setting-help',
    'Remove ranges inside the trim. Export joins the kept parts. Cuts require exact encoding.',
  );
  const list = el('div', 'cut-list');
  const marks = el('div', 'trim-cut-marks');
  marks.setAttribute('aria-hidden', 'true');
  const add = el('button', 'btn btn-cue', 'Add cut');
  add.type = 'button';
  add.title = 'Add a one-second cut at the playhead';
  add.addEventListener('click', () => {
    if (!onChange || cuts.length >= 20) return;
    const start = Math.min(Math.max(video.currentTime, trim.start), trim.end - 0.1);
    onChange(normalizeCuts([...cuts, { start, end: Math.min(trim.end, start + 1) }], trim));
  });
  section.append(heading, help, list, add);

  function render() {
    marks.replaceChildren(
      ...cuts.map((cut) => {
        const mark = el('span', 'trim-cut-mark');
        mark.style.left = `${duration > 0 ? (cut.start / duration) * 100 : 0}%`;
        mark.style.width = `${duration > 0 ? ((cut.end - cut.start) / duration) * 100 : 0}%`;
        return mark;
      }),
    );
    list.replaceChildren();
    cuts.forEach((cut, index) => {
      const row = el('div', 'cut-row');
      row.append(el('span', 'cut-row-label', `Cut ${index + 1}`));
      for (const side of ['start', 'end'] as const) {
        const input = el('input', 'trim-input num') as HTMLInputElement;
        input.type = 'text';
        input.inputMode = 'text';
        input.value = formatDuration(cut[side], { tenths: true });
        input.setAttribute('aria-label', `Cut ${index + 1} ${side}`);
        const error = el(
          'span',
          'setting-reason trim-error',
          'Enter a time inside the trim, keeping this cut at least 0.1 seconds.',
        );
        error.hidden = true;
        const commit = (time: number | null) => {
          const next = { ...cut, [side]: time };
          if (
            time === null ||
            time < trim.start ||
            time > trim.end ||
            next.end - next.start < 0.1
          ) {
            input.setAttribute('aria-invalid', 'true');
            error.hidden = false;
            return;
          }
          error.hidden = true;
          input.setAttribute('aria-invalid', 'false');
          onChange?.(
            normalizeCuts(
              cuts.map((item, at) => (at === index ? (next as Cut) : item)),
              trim,
            ),
          );
        };
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit(parseTimecode(input.value));
          }
          if (event.key === 'Escape') {
            input.value = formatDuration(cut[side], { tenths: true });
            input.blur();
          }
        });
        input.addEventListener('blur', () => {
          if (input.getAttribute('aria-invalid') !== 'true') commit(parseTimecode(input.value));
        });
        input.addEventListener('input', () => {
          error.hidden = true;
          input.setAttribute('aria-invalid', 'false');
        });
        const set = el('button', 'btn btn-cue', 'Set');
        set.type = 'button';
        set.title = `Set cut ${index + 1} ${side} to playhead`;
        set.setAttribute('aria-label', set.title);
        set.addEventListener('click', () => commit(video.currentTime));
        row.append(el('span', 'trim-label', side === 'start' ? 'Start' : 'End'), input, set, error);
      }
      const remove = el('button', 'btn btn-cue', 'Remove');
      remove.type = 'button';
      remove.setAttribute('aria-label', `Remove cut ${index + 1}`);
      remove.addEventListener('click', () => onChange?.(cuts.filter((_, at) => at !== index)));
      row.append(remove);
      list.append(row);
    });
    add.disabled = !onChange || cuts.length >= 20 || trim.end - trim.start < 0.2;
  }
  render();
  return {
    node: section,
    marks,
    cuts: () => cuts,
    kept: () => keptDuration(trim, cuts),
    update(nextTrim: Trim, nextCuts: Cut[] = cuts) {
      if (JSON.stringify([trim, cuts]) === JSON.stringify([nextTrim, nextCuts])) return;
      trim = nextTrim;
      cuts = nextCuts;
      render();
    },
  };
}

export function previewSkip(time: number, trim: Trim, cuts: Cut[]): number | null {
  if (time >= trim.end || time < trim.start) return trim.start;
  const cut = cuts.find((item) => time >= item.start && time < item.end);
  return cut ? (cut.end < trim.end ? cut.end : trim.start) : null;
}
