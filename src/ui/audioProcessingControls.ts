import {
  hasAudioProcessing,
  normalizeAudioProcessing,
  type AudioProcessing,
} from '../core/audioProcess';
import { el, icon } from './dom';

export function mountAudioProcessing(
  host: HTMLElement,
  value: Partial<AudioProcessing> | undefined,
  duration: number,
  onChange: (value: AudioProcessing) => void,
) {
  let settings = normalizeAudioProcessing(value, duration);
  const section = el('div', 'setting audio-processing-setting');
  const head = el('div', 'setting-head');
  const reset = el('button', 'setting-reset', 'Reset audio processing');
  reset.type = 'button';
  reset.prepend(icon('i-reset'));
  reset.addEventListener('click', () => {
    onChange(normalizeAudioProcessing({}, duration));
    fields.get('gainDb')?.focus();
  });
  head.append(el('strong', undefined, 'Audio processing'), reset);
  section.append(head);
  const fields = new Map<'gainDb' | 'fadeIn' | 'fadeOut', HTMLInputElement>();
  for (const [key, name, min, max, step] of [
    ['gainDb', 'Gain (dB)', -20, 20, 0.5],
    ['fadeIn', 'Fade in (seconds)', 0, duration, 0.1],
    ['fadeOut', 'Fade out (seconds)', 0, duration, 0.1],
  ] as const) {
    const label = el('label', 'setting-label', name);
    const input = el('input', 'setting-select num');
    input.type = 'number';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.setAttribute('aria-label', name);
    input.addEventListener('change', () =>
      onChange(normalizeAudioProcessing({ ...settings, [key]: input.valueAsNumber }, duration)),
    );
    label.append(input);
    section.append(label);
    fields.set(key, input);
  }
  const label = el('label', 'setting-label', 'Normalize loudness');
  const normalize = el('select', 'setting-select');
  normalize.setAttribute('aria-label', 'Normalize loudness');
  for (const [value, name] of [
    ['off', 'Off'],
    ['-14', '-14 LUFS (streaming)'],
    ['-16', '-16 LUFS (podcast)'],
    ['-23', '-23 LUFS (EBU R128)'],
  ]) {
    const option = el('option', undefined, name);
    option.value = value!;
    normalize.append(option);
  }
  normalize.addEventListener('change', () =>
    onChange(
      normalizeAudioProcessing(
        { ...settings, normalize: Number(normalize.value) as AudioProcessing['normalize'] },
        duration,
      ),
    ),
  );
  const field = el('span', 'field');
  field.append(normalize, icon('i-chev'));
  label.append(field);
  section.append(
    label,
    el(
      'p',
      'setting-help',
      'Processing re-encodes audio. Normalization analyses the kept range first. Fades fit the kept duration. Ceiling: -1 dBFS sample peak, not true peak.',
    ),
  );
  host.append(section);
  function update(value: Partial<AudioProcessing> | undefined, span: number): void {
    duration = span;
    settings = normalizeAudioProcessing(value, duration);
    for (const [key, input] of fields) {
      input.value = String(settings[key]);
      if (key !== 'gainDb') input.max = String(duration);
    }
    normalize.value = String(settings.normalize ?? 'off');
    reset.hidden = !hasAudioProcessing(settings);
  }
  update(value, duration);
  return { update };
}
