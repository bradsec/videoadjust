import {
  hasColorCorrection,
  normalizeStyle,
  STYLE_PRESETS,
  type ColorCorrection,
  type StyleSettings,
} from '../core/style';
import { el, icon } from './dom';

export function mountStylePanel(
  host: HTMLElement,
  initial: StyleSettings | undefined,
  onChange: (style: StyleSettings) => void,
): { update(style: StyleSettings | undefined, unavailable?: string): void } {
  let value = normalizeStyle(initial);
  const heading = el('summary');
  const state = el('span', 'adjust-state');
  heading.append('Style Filter', state, icon('i-chev'));
  const controls = el('div', 'settings-controls style-controls');
  const correction = el('div', 'setting');
  const correctionHead = el('div', 'setting-head');
  const reset = el('button', 'setting-reset', 'Reset colour correction');
  reset.type = 'button';
  reset.prepend(icon('i-reset'));
  reset.addEventListener('click', () => {
    onChange({ ...value, correction: normalizeStyle().correction });
    corrections.get('exposure')?.input.focus();
  });
  correctionHead.append(el('strong', undefined, 'Colour correction'), reset);
  correction.append(correctionHead);
  const corrections = new Map<
    keyof ColorCorrection,
    { input: HTMLInputElement; output: HTMLElement }
  >();
  for (const [key, name, min, max, step] of [
    ['exposure', 'Exposure (stops)', -3, 3, 0.1],
    ['contrast', 'Contrast', 0, 2, 0.01],
    ['saturation', 'Saturation', 0, 2, 0.01],
    ['temperature', 'Temperature', -1, 1, 0.01],
  ] as const) {
    const label = el('label', 'setting-label', name);
    const output = el('output', 'num');
    const input = el('input', 'setting-range');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.setAttribute('aria-label', name);
    input.addEventListener('input', () =>
      onChange({ ...value, correction: { ...value.correction, [key]: input.valueAsNumber } }),
    );
    label.append(output, input);
    correction.append(label);
    corrections.set(key, { input, output });
  }
  correction.append(
    el('p', 'setting-help', 'Applied before the creative style. Works with Style set to None.'),
  );
  const unavailableNote = el('p', 'setting-reason');
  unavailableNote.setAttribute('role', 'status');
  const preset = el('select', 'setting-select');
  preset.setAttribute('aria-label', 'Video style');
  for (const style of STYLE_PRESETS) {
    const option = el('option', undefined, style.label);
    option.value = style.id;
    preset.append(option);
  }
  const presetLabel = el('label', 'setting-label', 'Style');
  presetLabel.append(preset);
  const intensity = el('input', 'setting-range');
  intensity.type = 'range';
  intensity.min = '0';
  intensity.max = '100';
  intensity.step = '1';
  intensity.setAttribute('aria-label', 'Style intensity');
  const intensityLabel = el('label', 'setting-label', 'Intensity');
  intensityLabel.append(intensity);
  const detail = el('input', 'setting-range');
  detail.type = 'range';
  detail.setAttribute('aria-label', 'Style detail');
  const detailLabel = el('label', 'setting-label');
  const detailText = document.createTextNode('Detail');
  detailLabel.append(detailText, detail);
  const colors = el('div', 'style-colors');
  function color(name: string, key: 'colorA' | 'colorB'): void {
    const input = el('input');
    input.type = 'color';
    input.setAttribute('aria-label', name);
    input.addEventListener('input', () => onChange({ ...value, [key]: input.value }));
    const label = el('label', 'setting-label', name);
    label.append(input);
    colors.append(label);
  }
  color('Shadow color', 'colorA');
  color('Highlight color', 'colorB');
  preset.addEventListener('change', () => {
    const selected = STYLE_PRESETS.find((style) => style.id === preset.value)!;
    onChange({ ...value, id: selected.id, detail: selected.defaultDetail });
  });
  intensity.addEventListener('input', () =>
    onChange({ ...value, intensity: intensity.valueAsNumber / 100 }),
  );
  detail.addEventListener('input', () => onChange({ ...value, detail: detail.valueAsNumber }));
  controls.append(correction, presetLabel, intensityLabel, detailLabel, colors, unavailableNote);
  host.append(heading, controls);

  return {
    update(next, unavailable) {
      value = normalizeStyle(next);
      const selected = STYLE_PRESETS.find((style) => style.id === value.id)!;
      state.textContent = `${selected.label}${hasColorCorrection(value) ? ' · Corrected' : ''}`;
      state.classList.toggle('is-changed', value.id !== 'none' || hasColorCorrection(value));
      reset.hidden = !hasColorCorrection(value);
      reset.disabled = !!unavailable;
      for (const [key, { input, output }] of corrections) {
        input.value = String(value.correction[key]);
        input.disabled = !!unavailable;
        output.textContent = value.correction[key].toFixed(key === 'exposure' ? 1 : 2);
      }
      preset.value = value.id;
      preset.disabled = !!unavailable;
      intensityLabel.hidden = value.id === 'none';
      intensity.value = String(Math.round(value.intensity * 100));
      intensity.setAttribute('aria-valuetext', `${intensity.value}%`);
      detailLabel.hidden = value.id === 'none' || !selected.detailLabel;
      detailText.textContent = selected.detailLabel;
      detail.setAttribute('aria-label', selected.detailLabel || 'Style detail');
      detail.min = String(selected.detailMin);
      detail.max = String(selected.detailMax);
      detail.step = String(selected.detailStep);
      detail.value = String(value.detail);
      colors.hidden = value.id !== 'duotone';
      (colors.querySelectorAll('input')[0] as HTMLInputElement).value = value.colorA;
      (colors.querySelectorAll('input')[1] as HTMLInputElement).value = value.colorB;
      unavailableNote.hidden = !unavailable;
      unavailableNote.textContent = unavailable ?? '';
    },
  };
}
