import {
  gifBudgetError,
  gifDimensions,
  gifFrameCount,
  gifFrameSize,
  type GifSettings,
} from '../core/gifExport';
import type { Settings, SourceInfo } from '../core/types';
import { el, icon } from './dom';
import { formatDuration } from './format';

export function mountGifPanel(
  host: HTMLElement,
  opts: {
    value: GifSettings;
    source: SourceInfo;
    transform: Settings['transform'];
    onChange(value: GifSettings): void;
    onExport(): void;
  },
): {
  update(value: GifSettings, transform: Settings['transform']): void;
  setBusy(value: boolean): void;
} {
  let value = opts.value;
  let transform = opts.transform;
  const card = el('section', 'card export-summary');
  card.setAttribute('aria-label', 'GIF summary');
  const spec = el('div', 'spec');
  const heading = el('h2', 'num');
  const sub = el('p', 'export-sub num');
  spec.append(el('span', 'overline', 'Ready to export'), heading, sub);
  const dock = el('div', 'dock');
  const count = el('div', 'export-estimate');
  const big = el('strong', 'export-estimate-big num');
  const advice = el('span', 'export-from', 'GIF file size depends on the video colours.');
  count.append(big, advice);
  const button = el('button', 'btn btn-primary btn-go');
  button.type = 'button';
  button.append(icon('i-down'), 'Export GIF');
  button.addEventListener('click', () => {
    if (button.getAttribute('aria-disabled') !== 'true') opts.onExport();
  });
  dock.append(count, button);

  const details = el('details', 'adjust');
  const disclosure = el('summary');
  disclosure.append('Adjust', icon('i-chev'));
  const controls = el('div', 'settings-controls');
  details.append(disclosure, controls);

  function select<T extends string>(
    label: string,
    choices: { value: T; label: string }[],
    change: (choice: T) => void,
  ): HTMLSelectElement {
    const section = el('div', 'setting');
    const fieldLabel = el('label', 'setting-label', label);
    const wrapper = el('span', 'field');
    const field = el('select', 'setting-select');
    field.setAttribute('aria-label', label);
    for (const choice of choices) {
      const option = el('option', undefined, choice.label);
      option.value = choice.value;
      field.append(option);
    }
    field.addEventListener('change', () => change(field.value as T));
    wrapper.append(field, icon('i-chev'));
    fieldLabel.append(wrapper);
    section.append(fieldLabel);
    controls.append(section);
    return field;
  }
  const width = select('Width', [], (n) => opts.onChange({ ...value, width: Number(n) }));
  const fps = select('Frame rate', [], (n) => opts.onChange({ ...value, fps: Number(n) }));
  const loop = select(
    'Loop',
    [
      { value: 'forever', label: 'Loop forever' },
      { value: 'once', label: 'Play once' },
    ],
    (next) => opts.onChange({ ...value, loop: next }),
  );
  const colors = select(
    'Colours',
    [
      { value: '256', label: '256 colours' },
      { value: '128', label: '128 colours' },
      { value: '64', label: '64 colours' },
    ],
    (n) => opts.onChange({ ...value, colors: Number(n) as GifSettings['colors'] }),
  );
  const compression = select(
    'File size',
    [
      { value: 'quality', label: 'Best quality' },
      { value: 'balanced', label: 'Balanced' },
      { value: 'small', label: 'Smallest file' },
    ],
    (next) => opts.onChange({ ...value, compression: next }),
  );
  compression
    .closest('.setting')
    ?.append(
      el(
        'p',
        'setting-help',
        'Smaller files reuse more of the previous frame, which can leave faint trails in fast motion.',
      ),
    );
  const warning = el('p', 'setting-reason');
  warning.setAttribute('role', 'status');
  controls.append(warning);
  card.append(spec, dock, details);
  host.replaceChildren(card);

  function update(next: GifSettings, nextTransform: Settings['transform']): void {
    value = next;
    transform = nextTransform;
    const frame = gifFrameSize(opts.source, transform);
    const widths = [
      ...new Set(
        [320, 480, 640].map((n) => Math.max(2, Math.floor(Math.min(n, frame.width) / 2) * 2)),
      ),
    ];
    width.replaceChildren(
      ...widths.map((n) => {
        const option = el('option', undefined, `${n} px`);
        option.value = String(n);
        return option;
      }),
    );
    if (!widths.includes(next.width)) {
      const option = el('option', undefined, `${next.width} px`);
      option.value = String(next.width);
      width.append(option);
    }
    width.value = String(next.width);
    const rates = [
      ...new Set([5, 10, 15, 20].map((n) => Math.min(n, opts.source.video?.fps ?? n))),
    ];
    fps.replaceChildren(
      ...rates.map((n) => {
        const option = el('option', undefined, `${Number(n.toFixed(2))} fps`);
        option.value = String(n);
        return option;
      }),
    );
    fps.value = String(next.fps);
    loop.value = next.loop;
    colors.value = String(next.colors);
    compression.value = next.compression;
    const dimensions = gifDimensions(next, opts.source, transform);
    const frames = gifFrameCount(next.trim, next.fps);
    heading.textContent = `${dimensions.width}x${dimensions.height} GIF`;
    sub.textContent = `${frames} frames · ${Number(next.fps.toFixed(2))} fps · ${formatDuration(next.trim.end - next.trim.start)}`;
    big.textContent = `${frames} frames · ${dimensions.width}x${dimensions.height}`;
    warning.textContent = gifBudgetError(dimensions.width, dimensions.height, frames) ?? '';
    warning.hidden = !warning.textContent;
    button.disabled = !!warning.textContent;
  }
  function setBusy(busy: boolean): void {
    if (busy) button.setAttribute('aria-disabled', 'true');
    else button.removeAttribute('aria-disabled');
    button.replaceChildren(icon('i-down'), busy ? 'Exporting GIF...' : 'Export GIF');
  }
  update(value, transform);
  return { update, setBusy };
}
