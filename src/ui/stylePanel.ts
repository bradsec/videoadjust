import { normalizeStyle, STYLE_PRESETS, type StyleSettings } from '../core/style';
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
  controls.append(presetLabel, intensityLabel, detailLabel, colors, unavailableNote);
  host.append(heading, controls);

  return {
    update(next, unavailable) {
      value = normalizeStyle(next);
      const selected = STYLE_PRESETS.find((style) => style.id === value.id)!;
      state.textContent = selected.label;
      state.classList.toggle('is-changed', value.id !== 'none');
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
