import {
  addedOffsetRange,
  describeAddedOffset,
  normalizeAudioMix,
  type AddedAudio,
  type AudioMix,
} from '../core/audioMix';
import { el, icon } from './dom';
import { formatDuration } from './format';
import '../styles/audioMix.css';

export interface AudioTracksValue {
  busy?: boolean;
  sourceHasAudio: boolean;
  mix?: AudioMix;
  added?: AddedAudio;
  duration: number;
}

export function mountAudioTracks(
  host: HTMLElement,
  opts: AudioTracksValue & {
    onChange(mix: AudioMix): void;
    onAdd(file: File): void;
    onRemove(): void;
  },
) {
  let value: AudioTracksValue = opts;
  let mix = normalizeAudioMix(value.mix, value.duration);
  // The Audio section's summary is the visible heading; the region label stays for assistive tech.
  const section = el('section', 'audio-tracks');
  section.setAttribute('aria-label', 'Audio tracks');

  const original = el('div', 'audio-track-row');
  const originalHead = el('div', 'setting-head');
  const includeLabel = el('label', 'audio-track-toggle');
  const include = el('input');
  include.type = 'checkbox';
  include.setAttribute('aria-label', 'Original audio');
  include.addEventListener('change', () =>
    opts.onChange({ ...mix, original: { ...mix.original, include: include.checked } }),
  );
  includeLabel.append(include, document.createTextNode('Original audio'));
  const reset = el('button', 'setting-reset', 'Reset original audio');
  reset.type = 'button';
  reset.prepend(icon('i-reset'));
  reset.addEventListener('click', () => {
    opts.onChange({ ...mix, original: { include: true, volumeDb: 0 } });
    originalVolume.input.focus();
  });
  originalHead.append(includeLabel, reset);
  const unavailable = el('p', 'setting-help', 'The source has no usable audio.');
  original.append(originalHead, unavailable);

  function slider(
    host: HTMLElement,
    name: string,
    min: number,
    max: number,
    step: number,
    unit: string,
    onChange: (n: number) => void,
  ) {
    const label = el('label', 'setting-label', name);
    const output = el('output', 'num');
    const input = el('input', 'setting-range');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.setAttribute('aria-label', name);
    input.addEventListener('input', () => onChange(input.valueAsNumber));
    label.append(output, input);
    host.append(label);
    return {
      input,
      update(n: number): void {
        input.value = String(n);
        const text = `${unit === 'dB' && n > 0 ? '+' : ''}${n.toFixed(1)} ${unit}`;
        input.setAttribute('aria-valuetext', text);
        output.textContent = text;
      },
    };
  }
  const originalVolume = slider(original, 'Original volume (dB)', -20, 20, 0.5, 'dB', (n) =>
    opts.onChange({ ...mix, original: { ...mix.original, volumeDb: n } }),
  );

  const added = el('div', 'audio-track-row');
  const addedHead = el('div', 'setting-head');
  const name = el('strong');
  const remove = el('button', 'setting-reset', 'Remove added audio');
  remove.type = 'button';
  remove.addEventListener('click', opts.onRemove);
  addedHead.append(name, remove);
  const duration = el('p', 'setting-help num');
  added.append(addedHead, duration);
  const addedVolume = slider(added, 'Added volume (dB)', -20, 20, 0.5, 'dB', (volumeDb) => {
    if (mix.added) opts.onChange({ ...mix, added: { ...mix.added, volumeDb } });
  });
  const offset = slider(
    added,
    'Added start offset (seconds)',
    0,
    value.duration,
    0.1,
    's',
    (offset) => {
      if (mix.added) opts.onChange({ ...mix, added: { ...mix.added, offset } });
    },
  );
  const offsetOutput = offset.input.previousElementSibling as HTMLElement;
  const loopLabel = el('label', 'audio-track-toggle');
  const loop = el('input');
  loop.type = 'checkbox';
  loop.setAttribute('aria-label', 'Loop added audio');
  loop.addEventListener('change', () => {
    if (mix.added) opts.onChange({ ...mix, added: { ...mix.added, loop: loop.checked } });
  });
  loopLabel.append(loop, document.createTextNode('Loop added audio'));
  added.append(loopLabel);
  const picker = el('input');
  picker.type = 'file';
  picker.accept = 'audio/*,video/*';
  picker.hidden = true;
  picker.setAttribute('aria-label', 'Added audio file');
  picker.addEventListener('change', () => {
    const file = picker.files?.[0];
    picker.value = '';
    if (file) opts.onAdd(file);
  });
  const add = el('button', 'btn', 'Add music or audio');
  add.type = 'button';
  add.addEventListener('click', () => picker.click());
  section.append(original, added, add, picker);
  host.replaceChildren(section);

  function update(next: AudioTracksValue): void {
    value = next;
    mix = normalizeAudioMix(value.mix, value.duration);
    include.checked = value.sourceHasAudio && mix.original.include;
    include.disabled = !value.sourceHasAudio;
    reset.hidden = mix.original.volumeDb === 0 && mix.original.include;
    reset.disabled = value.busy === true;
    unavailable.hidden = value.sourceHasAudio;
    originalVolume.input.disabled = !value.sourceHasAudio || !mix.original.include;
    originalVolume.update(mix.original.volumeDb);
    added.hidden = !value.added;
    add.hidden = !!value.added;
    add.disabled = value.busy === true;
    add.textContent = value.busy ? 'Reading audio...' : 'Add music or audio';
    remove.disabled = value.busy === true;
    name.textContent = value.added ? `Added audio: ${value.added.file.name}` : '';
    duration.textContent = value.added
      ? formatDuration(value.added.duration, { tenths: true })
      : '';
    addedVolume.update(mix.added?.volumeDb ?? 0);
    const range = addedOffsetRange(value.added?.duration ?? 0, value.duration);
    offset.input.min = String(range.min);
    offset.input.max = String(range.max);
    offset.update(mix.added?.offset ?? 0);
    const offsetText = describeAddedOffset(mix.added?.offset ?? 0);
    offset.input.setAttribute('aria-valuetext', offsetText);
    offsetOutput.textContent = offsetText;
    loop.checked = mix.added?.loop ?? false;
  }
  update(value);
  return { update };
}
