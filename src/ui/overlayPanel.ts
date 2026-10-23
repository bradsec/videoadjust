import {
  addCustomFont,
  customFontId,
  isCustomFont,
  listCustomFonts,
  removeCustomFont,
} from '../core/customFonts';
import {
  defaultOverlays,
  overlayAnchors,
  overlayFonts,
  type OverlayFont,
  type Overlays,
} from '../core/overlays';
import { el } from './dom';

export function mountOverlayPanel(
  host: HTMLElement,
  initial: Overlays | undefined,
  onChange: (value: Overlays) => void,
  onImage: (file: File) => void,
): { update(value: Overlays | undefined): void } {
  let value = initial ?? defaultOverlays();
  const section = el('div', 'setting overlay-setting');
  const patches: (() => void)[] = [];
  const text = (patch: Partial<Overlays['text']>) =>
    onChange({ ...value, text: { ...value.text, ...patch } });
  const image = (patch: Partial<Overlays['image']>) =>
    onChange({ ...value, image: { ...value.image, ...patch } });
  function field(parent: HTMLElement, name: string, input: HTMLElement): void {
    const label = el('label', 'setting-label', name);
    input.setAttribute('aria-label', name);
    label.append(input);
    parent.append(label);
  }
  function check(
    parent: HTMLElement,
    name: string,
    get: () => boolean,
    set: (v: boolean) => void,
  ): void {
    const input = el('input');
    input.type = 'checkbox';
    input.addEventListener('change', () => set(input.checked));
    field(parent, name, input);
    patches.push(() => {
      input.checked = get();
    });
  }
  function number(
    parent: HTMLElement,
    name: string,
    get: () => number,
    set: (v: number) => void,
    min = 0,
    max = 100,
  ): void {
    const input = el('input', 'setting-select');
    input.type = 'number';
    input.min = String(min);
    input.max = String(max);
    input.step = '1';
    input.addEventListener('change', () => {
      if (Number.isFinite(input.valueAsNumber)) set(input.valueAsNumber / 100);
    });
    field(parent, name, input);
    patches.push(() => {
      if (document.activeElement !== input) input.value = String(Math.round(get() * 100));
    });
  }
  function select<T extends string>(
    parent: HTMLElement,
    name: string,
    choices: readonly T[],
    get: () => T,
    set: (v: T) => void,
    labels: Partial<Record<T, string>> = {},
  ): void {
    const input = el('select', 'setting-select');
    for (const choice of choices) {
      const option = el(
        'option',
        undefined,
        labels[choice] ?? choice.replaceAll('-', ' ').replace(/^./, (s) => s.toUpperCase()),
      );
      option.value = choice;
      input.append(option);
    }
    input.addEventListener('change', () => set(input.value as T));
    field(parent, name, input);
    patches.push(() => {
      input.value = get();
    });
  }
  function color(
    parent: HTMLElement,
    name: string,
    get: () => string,
    set: (v: string) => void,
  ): void {
    const input = el('input');
    input.type = 'color';
    input.addEventListener('input', () => set(input.value));
    field(parent, name, input);
    patches.push(() => {
      input.value = get();
    });
  }
  function position(parent: HTMLElement, kind: 'text' | 'image'): void {
    const name = kind === 'text' ? 'Text' : 'Image';
    select(
      parent,
      name + ' anchor',
      overlayAnchors,
      () => value[kind].anchor,
      (anchor) => {
        const patch = { anchor, position: null };
        if (kind === 'text') text(patch);
        else image(patch);
      },
    );
    number(
      parent,
      name + ' margin (%)',
      () => value[kind].margin,
      (margin) => {
        if (kind === 'text') text({ margin });
        else image({ margin });
      },
      0,
      45,
    );
  }
  check(
    section,
    'Text overlay',
    () => value.text.enabled,
    (enabled) => text({ enabled }),
  );
  const textFields = el('div', 'overlay-fields');
  const content = el('textarea', 'setting-select');
  content.maxLength = 500;
  content.rows = 3;
  content.addEventListener('input', () => text({ content: content.value }));
  field(textFields, 'Overlay text', content);
  patches.push(() => {
    textFields.hidden = !value.text.enabled;
    if (document.activeElement !== content) content.value = value.text.content;
  });
  // Anton is the closest openly licensed match for Impact, the classic meme font.
  const fontLabels: Partial<Record<OverlayFont, string>> = {
    Anton: 'Anton (meme style)',
    Caveat: 'Caveat (handwritten)',
    'JetBrains Mono': 'JetBrains Mono (monospace)',
  };
  let customFonts: { id: string; name: string }[] = [];
  const fontSelect = el('select', 'setting-select');
  fontSelect.addEventListener('change', () => {
    const font = fontSelect.value as OverlayFont;
    text({ font, weight: font === 'Anton' ? 400 : value.text.weight });
  });
  field(textFields, 'Text font', fontSelect);
  const fontFile = el('input');
  fontFile.type = 'file';
  fontFile.accept = '.ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2';
  field(textFields, 'Add your font', fontFile);
  const removeFont = el('button', 'btn btn-text', 'Remove this font');
  removeFont.type = 'button';
  const fontStatus = el('p', 'setting-reason');
  fontStatus.setAttribute('role', 'status');
  textFields.append(
    removeFont,
    fontStatus,
    el(
      'p',
      'setting-help',
      'Your fonts stay in this browser and are never uploaded. Use only fonts you have the right to use.',
    ),
  );
  function renderFonts(): void {
    const option = (font: string, label: string) => {
      const node = el('option', undefined, label);
      node.value = font;
      return node;
    };
    const current = value.text.font;
    const missing =
      isCustomFont(current) && !customFonts.some((font) => `custom:${font.id}` === current);
    fontSelect.replaceChildren(
      ...overlayFonts.map((font) => option(font, fontLabels[font] ?? font)),
      ...customFonts.map((font) => option(`custom:${font.id}`, `${font.name} (your font)`)),
      ...(missing ? [option(current, 'Missing font')] : []),
    );
    fontSelect.value = current;
    removeFont.hidden = !isCustomFont(current) || missing;
  }
  async function refreshFonts(): Promise<void> {
    customFonts = (await listCustomFonts()).map(({ id, name }) => ({ id, name }));
    renderFonts();
  }
  fontFile.addEventListener('change', () => {
    const file = fontFile.files?.[0];
    fontFile.value = '';
    if (!file) return;
    fontStatus.textContent = 'Adding font…';
    addCustomFont(file)
      .then(async ({ font, saved }) => {
        fontStatus.textContent = saved
          ? ''
          : 'This browser blocks saved fonts, so this one lasts until the page closes.';
        await refreshFonts();
        text({ font: `custom:${font.id}`, weight: 400 });
      })
      .catch((error: unknown) => {
        fontStatus.textContent = error instanceof Error ? error.message : 'Could not add the font.';
      });
  });
  removeFont.addEventListener('click', () => {
    const font = value.text.font;
    if (!isCustomFont(font)) return;
    removeCustomFont(customFontId(font))
      .catch((error: unknown) => console.warn('Could not remove the saved font', error))
      .then(refreshFonts)
      .then(() => text({ font: 'Inter' }))
      .catch((error: unknown) => console.warn('Could not refresh saved fonts', error));
  });
  patches.push(renderFonts);
  void refreshFonts();
  const bold = el('div');
  check(
    bold,
    'Bold text',
    () => value.text.weight === 700,
    (enabled) => text({ weight: enabled ? 700 : 400 }),
  );
  textFields.append(bold);
  patches.push(() => {
    bold.hidden = value.text.font === 'Anton';
  });
  color(
    textFields,
    'Text colour',
    () => value.text.color,
    (color) => text({ color }),
  );
  number(
    textFields,
    'Text opacity (%)',
    () => value.text.opacity,
    (opacity) => text({ opacity }),
  );
  number(
    textFields,
    'Text size (% of height)',
    () => value.text.fontSize,
    (fontSize) => text({ fontSize }),
    1,
    50,
  );
  number(
    textFields,
    'Text box width (%)',
    () => value.text.boxWidth,
    (boxWidth) => text({ boxWidth }),
    5,
    100,
  );
  check(
    textFields,
    'Auto fit text',
    () => value.text.autoFit,
    (autoFit) => text({ autoFit }),
  );
  number(
    textFields,
    'Text max height (%)',
    () => value.text.maxHeight,
    (maxHeight) => text({ maxHeight }),
    5,
    100,
  );
  select(
    textFields,
    'Text alignment',
    ['left', 'center', 'right'],
    () => value.text.align,
    (align) => text({ align }),
  );
  select(
    textFields,
    'Text effect',
    ['none', 'outline', 'shadow', 'box'],
    () => value.text.legibility,
    (legibility) => text({ legibility }),
    { none: 'No effect', box: 'Box behind text' },
  );
  const legibility = el('div', 'overlay-fields');
  color(
    legibility,
    'Effect colour',
    () => value.text.legibilityColor,
    (legibilityColor) => text({ legibilityColor }),
  );
  number(
    legibility,
    'Effect opacity (%)',
    () => value.text.legibilityOpacity,
    (legibilityOpacity) => text({ legibilityOpacity }),
  );
  patches.push(() => {
    legibility.hidden = value.text.legibility === 'none';
  });
  textFields.append(legibility);
  position(textFields, 'text');
  section.append(textFields);
  check(
    section,
    'Image overlay',
    () => value.image.enabled,
    (enabled) => image({ enabled }),
  );
  const imageFields = el('div', 'overlay-fields');
  const file = el('input');
  file.type = 'file';
  file.accept = 'image/png,image/jpeg,image/webp,image/svg+xml';
  file.addEventListener('change', () => {
    const selected = file.files?.[0];
    if (selected) onImage(selected);
  });
  field(imageFields, 'Overlay image', file);
  imageFields.append(
    el('p', 'setting-help', 'PNG, JPEG, WebP or SVG. Kept in memory on this device.'),
  );
  number(
    imageFields,
    'Image width (%)',
    () => value.image.scale,
    (scale) => image({ scale }),
    1,
    100,
  );
  number(
    imageFields,
    'Image opacity (%)',
    () => value.image.opacity,
    (opacity) => image({ opacity }),
  );
  position(imageFields, 'image');
  section.append(imageFields);
  patches.push(() => {
    imageFields.hidden = !value.image.enabled;
  });
  section.append(
    el(
      'p',
      'setting-help',
      'Use the Overlay editor to drag overlays or nudge them with arrow keys.',
    ),
  );
  host.append(section);
  function update(next: Overlays | undefined): void {
    value = next ?? defaultOverlays();
    patches.forEach((patch) => patch());
  }
  update(initial);
  return { update };
}
