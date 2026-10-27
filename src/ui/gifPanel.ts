import { mountResetAll } from './resetAll';
import {
  gifBudgetError,
  gifDimensions,
  gifFrameCount,
  gifFrameRates,
  gifFrameSize,
  gifPlaybackSeconds,
  type GifSettings,
} from '../core/gifExport';
import type { Settings, SourceInfo } from '../core/types';
import { el, icon, INSPECTOR_GROUP } from './dom';
import { formatDuration } from './format';

export function mountGifPanel(
  host: HTMLElement,
  opts: {
    value: GifSettings;
    source: SourceInfo;
    transform: Settings['transform'];
    fit?: Settings['fit'];
    onChange(value: GifSettings): void;
    onExport(): void;
    onResetAll?: () => void;
  },
): {
  resetAll: ReturnType<typeof mountResetAll>;
  update(value: GifSettings, transform: Settings['transform'], fit?: Settings['fit']): void;
  setBusy(value: boolean): void;
} {
  let value = opts.value;
  let transform = opts.transform;
  let fit = opts.fit;
  const card = el('section', 'card export-summary');
  card.setAttribute('aria-label', 'GIF summary');
  const spec = el('div', 'spec');
  const heading = el('h2', 'num');
  const sub = el('p', 'export-sub num');
  spec.append(el('span', 'overline', 'Ready to export'), heading, sub);
  const resetAll = mountResetAll(spec, opts.onResetAll);
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
  // Where the dock floats over the page (phone and tablet), the warning above can be off
  // screen while Export GIF is disabled, so the dock says why in one line with a way to reach it.
  const dockNote = el('div', 'dock-note');
  dockNote.hidden = true;
  const seeWhy = el('button', 'btn-link', 'See why');
  seeWhy.type = 'button';
  seeWhy.addEventListener('click', () => {
    warning.scrollIntoView({ block: 'center' });
    warning.focus({ preventScroll: true });
  });
  dockNote.append(icon('i-warn'), el('span', undefined, 'This GIF is too long or large.'), seeWhy);
  dock.append(dockNote, count, button);

  const details = el('details', 'adjust');
  details.name = INSPECTOR_GROUP;
  const disclosure = el('summary');
  disclosure.append('Output', icon('i-chev'));
  const controls = el('div', 'settings-controls');
  details.append(disclosure, controls);

  function select<T extends string>(
    label: string,
    tip: string,
    choices: { value: T; label: string }[],
    change: (choice: T) => void,
  ): HTMLSelectElement {
    const section = el('div', 'setting');
    const fieldLabel = el('label', 'setting-label', label);
    fieldLabel.title = tip;
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
  const size = select(
    'Size',
    'Set the long edge in pixels while keeping the frame proportions. Lower for a smaller GIF; frames are never upscaled',
    [],
    (n) => opts.onChange({ ...value, size: Number(n) }),
  );
  const fps = select(
    'Frame rate',
    'Frames per second in the GIF, never above the source rate. Lower for a smaller file; raise for smoother motion',
    [],
    (n) => opts.onChange({ ...value, fps: Number(n) }),
  );
  const loop = select(
    'Loop',
    'Choose whether the GIF repeats forward, plays once, or repeats forward and backward',
    [
      { value: 'forever', label: 'Loop forever' },
      { value: 'once', label: 'Play once' },
      { value: 'boomerang', label: 'Boomerang' },
    ],
    (next) => opts.onChange({ ...value, loop: next }),
  );
  const colors = select(
    'Colours',
    'Maximum colours per frame. Fewer colours can make a smaller file but lose subtle shades',
    [
      { value: '256', label: '256 colours' },
      { value: '128', label: '128 colours' },
      { value: '64', label: '64 colours' },
    ],
    (n) => opts.onChange({ ...value, colors: Number(n) as GifSettings['colors'] }),
  );
  const compression = select(
    'File size',
    'Best quality writes full frames; Balanced stores changed pixels. Smallest file reuses more pixels and can leave faint trails in fast motion',
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
  // Beside the action, not inside Adjust, so a blocked export always says why.
  const warning = el('p', 'export-warning');
  warning.setAttribute('role', 'status');
  warning.tabIndex = -1;
  spec.append(warning);
  card.append(spec, dock, details);
  host.replaceChildren(card);

  function update(
    next: GifSettings,
    nextTransform: Settings['transform'],
    nextFit?: Settings['fit'],
  ): void {
    value = next;
    transform = nextTransform;
    fit = nextFit;
    const frame = gifFrameSize(opts.source, transform);
    const longEdge = Math.max(frame.width, frame.height);
    const sizes = [
      ...new Set(
        [320, 480, 640, next.size].map((n) =>
          Math.max(2, Math.floor(Math.min(n, longEdge) / 2) * 2),
        ),
      ),
    ].sort((a, b) => a - b);
    size.replaceChildren(
      ...sizes.map((n) => {
        const dims = gifDimensions({ ...next, size: n }, opts.source, transform, fit);
        const option = el('option', undefined, `${n} px long edge (${dims.width}x${dims.height})`);
        option.value = String(n);
        return option;
      }),
    );
    size.value = String(next.size);
    const rates = gifFrameRates(opts.source.video?.fps);
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
    const dimensions = gifDimensions(next, opts.source, transform, fit);
    const frames = gifFrameCount(next.trim, next.fps, next.loop);
    const seconds = gifPlaybackSeconds(next.trim, next.fps, next.loop);
    heading.textContent = `${dimensions.width}x${dimensions.height} GIF`;
    sub.textContent = `${frames} frames · ${Number(next.fps.toFixed(2))} fps · ${formatDuration(seconds)}`;
    big.textContent = `${frames} frames · ${dimensions.width}x${dimensions.height}`;
    warning.textContent =
      gifBudgetError(dimensions.width, dimensions.height, frames, seconds) ?? '';
    warning.hidden = !warning.textContent;
    dockNote.hidden = !warning.textContent;
    button.disabled = !!warning.textContent;
  }
  function setBusy(busy: boolean): void {
    if (busy) button.setAttribute('aria-disabled', 'true');
    else button.removeAttribute('aria-disabled');
    button.replaceChildren(icon('i-down'), busy ? 'Exporting GIF...' : 'Export GIF');
  }
  update(value, transform, fit);
  return { update, setBusy, resetAll };
}
