import {
  hasAudioProcessing,
  normalizeAudioProcessing,
  type AudioProcessing,
} from '../core/audioProcess';
import { el, icon } from './dom';

// Fades past 10 s are rare; a shorter range keeps 0.1 s steps usable on long clips.
const fadeMax = (duration: number) => Math.min(10, Math.max(0, duration));

const format = (key: 'gainDb' | 'fadeIn' | 'fadeOut', value: number) =>
  key === 'gainDb' ? `${value > 0 ? '+' : ''}${value.toFixed(1)} dB` : `${value.toFixed(1)} s`;

export function mountAudioProcessing(
  host: HTMLElement,
  value: Partial<AudioProcessing> | undefined,
  duration: number,
  onChange: (value: AudioProcessing) => void,
) {
  let settings = normalizeAudioProcessing(value, Number.MAX_VALUE);
  const section = el('div', 'setting audio-processing-setting');
  const head = el('div', 'setting-head');
  const reset = el('button', 'setting-reset', 'Reset audio processing');
  reset.type = 'button';
  reset.prepend(icon('i-reset'));
  reset.addEventListener('click', () => {
    onChange(normalizeAudioProcessing({}, duration));
    fields.get('gainDb')?.input.focus();
  });
  head.append(el('strong', undefined, 'Master'), reset);
  section.append(head);
  const fields = new Map<
    'gainDb' | 'fadeIn' | 'fadeOut',
    { input: HTMLInputElement; output: HTMLElement }
  >();
  for (const [key, name, min, max, step] of [
    ['gainDb', 'Gain (dB)', -20, 20, 0.5],
    ['fadeIn', 'Fade in (seconds)', 0, fadeMax(duration), 0.1],
    ['fadeOut', 'Fade out (seconds)', 0, fadeMax(duration), 0.1],
  ] as const) {
    const label = el('label', 'setting-label', name);
    const output = el('output', 'num');
    const input = el('input', 'setting-range');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.setAttribute('aria-label', name);
    input.addEventListener('input', () => onChange({ ...settings, [key]: input.valueAsNumber }));
    label.append(output, input);
    section.append(label);
    fields.set(key, { input, output });
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
    onChange({ ...settings, normalize: Number(normalize.value) as AudioProcessing['normalize'] }),
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
    settings = normalizeAudioProcessing(value, Number.MAX_VALUE);
    const active = normalizeAudioProcessing(settings, duration);
    for (const [key, { input, output }] of fields) {
      if (key !== 'gainDb') input.max = String(fadeMax(duration));
      input.value = String(active[key]);
      input.setAttribute('aria-valuetext', format(key, active[key]));
      output.textContent = format(key, active[key]);
    }
    normalize.value = String(settings.normalize ?? 'off');
    reset.hidden = !hasAudioProcessing(settings);
  }
  update(value, duration);
  return { update };
}
