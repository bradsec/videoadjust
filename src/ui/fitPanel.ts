import { DEFAULT_FIT, normalizeFit, type FitAspect, type FitSettings } from '../core/fit';
import { el, icon, INSPECTOR_GROUP } from './dom';

export function mountFitPanel(onChange: (fit: FitSettings) => void) {
  const details = el('details', 'adjust fit-adjust');
  details.name = INSPECTOR_GROUP;
  const heading = el('summary');
  const state = el('span', 'adjust-state');
  heading.append('Fit to aspect', state, icon('i-chev'));
  const controls = el('div', 'settings-controls');
  const reset = el('button', 'setting-reset', 'Reset to auto');
  reset.type = 'button';
  reset.setAttribute('aria-label', 'Reset to auto: Fit to aspect');
  reset.prepend(icon('i-reset'));
  const head = el('div', 'setting-head');
  head.append(
    el('strong', undefined, 'Fit to aspect'),
    el('span', 'setting-auto', 'Auto: Off'),
    reset,
  );
  const setting = el('div', 'setting');
  setting.title = 'Add blurred or solid bands around the cropped frame to match an output aspect';
  setting.append(head);
  const aspect = el('select', 'setting-select');
  aspect.setAttribute('aria-label', 'Fit aspect');
  for (const value of ['off', '9:16', '1:1', '4:5', '16:9'] as FitAspect[]) {
    const option = el('option', undefined, value === 'off' ? 'Off' : value);
    option.value = value;
    aspect.append(option);
  }
  const aspectLabel = el('label', 'setting-label');
  aspectLabel.append(el('span', undefined, 'Aspect'), aspect);
  const background = el('select', 'setting-select');
  background.setAttribute('aria-label', 'Fit background');
  for (const [value, label] of [
    ['blur', 'Blur'],
    ['black', 'Black'],
    ['color', 'Solid colour'],
  ]) {
    const option = el('option', undefined, label);
    option.value = value;
    background.append(option);
  }
  const backgroundLabel = el('label', 'setting-label');
  backgroundLabel.append(el('span', undefined, 'Background'), background);
  const color = el('input') as HTMLInputElement;
  color.type = 'color';
  color.setAttribute('aria-label', 'Fit solid colour');
  const colorLabel = el('label', 'setting-label');
  colorLabel.append(el('span', undefined, 'Solid colour'), color);
  setting.append(aspectLabel, backgroundLabel, colorLabel);
  controls.append(setting);
  details.append(heading, controls);
  let current = DEFAULT_FIT;
  reset.addEventListener('click', () => onChange(DEFAULT_FIT));
  aspect.addEventListener('change', () =>
    onChange({ ...current, aspect: aspect.value as FitAspect }),
  );
  background.addEventListener('change', () =>
    onChange({ ...current, background: background.value as FitSettings['background'] }),
  );
  color.addEventListener('input', () => onChange({ ...current, color: color.value }));
  return {
    node: details,
    update(value: FitSettings | undefined, visible: boolean) {
      current = normalizeFit(value);
      const changed = JSON.stringify(current) !== JSON.stringify(DEFAULT_FIT);
      aspect.value = current.aspect;
      background.value = current.background;
      color.value = current.color;
      backgroundLabel.hidden = current.aspect === 'off';
      colorLabel.hidden = current.aspect === 'off' || current.background !== 'color';
      details.hidden = !visible;
      state.textContent = changed ? '1 change' : 'Unchanged';
      state.classList.toggle('is-changed', changed);
    },
  };
}
