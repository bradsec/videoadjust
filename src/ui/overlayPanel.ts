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
import { toast } from './toast';

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
  function field(parent: HTMLElement, name: string, input: HTMLElement, tip?: string): void {
    const label = el('label', 'setting-label', name);
    if (tip) label.title = tip;
    input.setAttribute('aria-label', name);
    label.append(input);
    parent.append(label);
  }
  // Related fields share a titled card, so a long panel scans as a few sections.
  function group(parent: HTMLElement, title: string, name: string): HTMLElement {
    const box = el('div', 'overlay-group');
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', name);
    const heading = el('p', 'overlay-group-title', title);
    heading.setAttribute('aria-hidden', 'true');
    box.append(heading);
    parent.append(box);
    return box;
  }
  function check(
    parent: HTMLElement,
    name: string,
    get: () => boolean,
    set: (v: boolean) => void,
    tip?: string,
  ): void {
    const input = el('input');
    input.type = 'checkbox';
    input.addEventListener('change', () => set(input.checked));
    const label = el('label', 'switch-row', name);
    if (tip) label.title = tip;
    input.setAttribute('aria-label', name);
    label.append(input);
    parent.append(label);
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
    tip?: string,
  ): void {
    // The slider gives quick live adjustment; the linked number field allows an exact value.
    const slider = el('input', 'setting-range');
    slider.type = 'range';
    const input = el('input', 'setting-select');
    input.type = 'number';
    for (const control of [slider, input]) {
      control.min = String(min);
      control.max = String(max);
      control.step = '1';
    }
    slider.setAttribute('aria-label', name);
    input.setAttribute('aria-label', `${name} value`);
    slider.addEventListener('input', () => {
      input.value = slider.value;
      slider.setAttribute('aria-valuetext', `${slider.value}%`);
      set(slider.valueAsNumber / 100);
    });
    input.addEventListener('change', () => {
      if (!Number.isFinite(input.valueAsNumber)) {
        input.value = String(Math.round(get() * 100));
        return;
      }
      const percent = Math.min(max, Math.max(min, Math.round(input.valueAsNumber)));
      input.value = String(percent);
      slider.value = input.value;
      slider.setAttribute('aria-valuetext', `${percent}%`);
      set(percent / 100);
    });
    const label = el('label', 'setting-label', name);
    if (tip) label.title = tip;
    const controls = el('span', 'overlay-percentage');
    const unit = el('span', undefined, '%');
    unit.setAttribute('aria-hidden', 'true');
    controls.append(slider, input, unit);
    label.append(controls);
    parent.append(label);
    patches.push(() => {
      const percent = String(Math.round(get() * 100));
      if (document.activeElement !== input) input.value = percent;
      if (document.activeElement !== slider) slider.value = percent;
      slider.setAttribute('aria-valuetext', `${slider.value}%`);
    });
  }
  function select<T extends string>(
    parent: HTMLElement,
    name: string,
    choices: readonly T[],
    get: () => T,
    set: (v: T) => void,
    labels: Partial<Record<T, string>> = {},
    tip?: string,
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
    field(parent, name, input, tip);
    patches.push(() => {
      input.value = get();
    });
  }
  function color(
    parent: HTMLElement,
    name: string,
    get: () => string,
    set: (v: string) => void,
    tip?: string,
  ): void {
    const input = el('input');
    input.type = 'color';
    input.addEventListener('input', () => set(input.value));
    field(parent, name, input, tip);
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
      {},
      'Place the overlay at one of nine positions. Dragging in the Overlay editor overrides this until you pick a new anchor or use Reset positions',
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
      'Inset from the edges as a percentage of the final rotated and cropped frame width and height. Raise to move anchored overlays farther inward',
    );
  }
  check(
    section,
    'Text overlay',
    () => value.text.enabled,
    (enabled) => text({ enabled }),
    'Burn text into the exported video or GIF',
  );
  const textFields = el('div', 'overlay-fields');
  const textContent = group(textFields, 'Content', 'Text content');
  const content = el('textarea', 'setting-select');
  content.maxLength = 500;
  content.rows = 3;
  content.addEventListener('input', () => text({ content: content.value }));
  field(
    textContent,
    'Overlay text',
    content,
    'Text to place over the video. Use line breaks to split it into lines',
  );
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
  field(
    textContent,
    'Text font',
    fontSelect,
    'Choose the overlay typeface. Anton has regular weight only, so Bold text is hidden for it',
  );
  const fontFile = el('input');
  fontFile.type = 'file';
  fontFile.accept = '.ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2';
  field(
    textContent,
    'Add your font',
    fontFile,
    'Add a TTF, OTF, WOFF or WOFF2 font up to 10 MB. Custom fonts stay in this browser and are never uploaded',
  );
  const removeFont = el('button', 'btn btn-text', 'Remove this font');
  removeFont.type = 'button';
  removeFont.title =
    'Delete the selected custom font from this browser and switch the text to Inter';
  const fontStatus = el('p', 'setting-reason');
  fontStatus.setAttribute('role', 'status');
  textContent.append(
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
        toast(`${font.name} added.`, 'success');
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
    'Use a heavier text weight to make the overlay stand out',
  );
  textContent.append(bold);
  patches.push(() => {
    bold.hidden = value.text.font === 'Anton';
  });
  const textStyle = group(textFields, 'Style', 'Text style');
  color(
    textStyle,
    'Text colour',
    () => value.text.color,
    (color) => text({ color }),
    'Choose the text colour. Use a colour that contrasts with the video',
  );
  number(
    textStyle,
    'Text opacity (%)',
    () => value.text.opacity,
    (opacity) => text({ opacity }),
    0,
    100,
    'How solid the text looks. Lower makes it more transparent; raise to make it stand out',
  );
  number(
    textStyle,
    'Text size (% of height)',
    () => value.text.fontSize,
    (fontSize) => text({ fontSize }),
    1,
    50,
    'Text size as a percentage of the final rotated and cropped frame height. Raise for larger text',
  );
  select(
    textStyle,
    'Text effect',
    ['none', 'outline', 'shadow', 'box'],
    () => value.text.legibility,
    (legibility) => text({ legibility }),
    { none: 'No effect', box: 'Box behind text' },
    'Add an outline, shadow or box to help text stand out against the video',
  );
  const legibility = el('div', 'overlay-fields');
  color(
    legibility,
    'Effect colour',
    () => value.text.legibilityColor,
    (legibilityColor) => text({ legibilityColor }),
    'Choose the outline, shadow or box colour. Use a colour that contrasts with the text',
  );
  number(
    legibility,
    'Effect opacity (%)',
    () => value.text.legibilityOpacity,
    (legibilityOpacity) => text({ legibilityOpacity }),
    0,
    100,
    'How solid the outline, shadow or box looks. Lower softens the effect; raise for stronger contrast',
  );
  patches.push(() => {
    legibility.hidden = value.text.legibility === 'none';
  });
  textStyle.append(legibility);
  const textLayout = group(textFields, 'Layout', 'Text layout');
  number(
    textLayout,
    'Text box width (%)',
    () => value.text.boxWidth,
    (boxWidth) => text({ boxWidth }),
    5,
    100,
    'Text wrapping width as a percentage of the final rotated and cropped frame width, limited by the margins. Lower for shorter lines',
  );
  check(
    textLayout,
    'Auto fit text',
    () => value.text.autoFit,
    (autoFit) => text({ autoFit }),
    'Shrink text when needed to fit the box width and maximum height',
  );
  number(
    textLayout,
    'Text max height (%)',
    () => value.text.maxHeight,
    (maxHeight) => text({ maxHeight }),
    5,
    100,
    'Maximum text height for auto fit, as a percentage of the final rotated and cropped frame height, limited by the margins. Lower to shrink long text more',
  );
  select(
    textLayout,
    'Text alignment',
    ['left', 'center', 'right'],
    () => value.text.align,
    (align) => text({ align }),
    {},
    'Align lines left, centre or right within the text box',
  );
  position(textLayout, 'text');
  section.append(textFields);
  check(
    section,
    'Image overlay',
    () => value.image.enabled,
    (enabled) => image({ enabled }),
    'Burn an image or watermark into the exported video or GIF',
  );
  const imageFields = el('div', 'overlay-fields');
  const file = el('input');
  file.type = 'file';
  file.accept = 'image/png,image/jpeg,image/webp,image/svg+xml';
  file.addEventListener('change', () => {
    const selected = file.files?.[0];
    if (selected) onImage(selected);
  });
  const imageContent = group(imageFields, 'Image', 'Image file');
  field(
    imageContent,
    'Overlay image',
    file,
    'Choose a PNG, JPEG, WebP or SVG overlay. The image stays in memory on this device and is never uploaded',
  );
  imageContent.append(
    el('p', 'setting-help', 'PNG, JPEG, WebP or SVG. Kept in memory on this device.'),
  );
  number(
    imageContent,
    'Image opacity (%)',
    () => value.image.opacity,
    (opacity) => image({ opacity }),
    0,
    100,
    'How solid the image looks. Lower for a subtle watermark; raise for a stronger image',
  );
  const imageLayout = group(imageFields, 'Layout', 'Image layout');
  number(
    imageLayout,
    'Image width (%)',
    () => value.image.scale,
    (scale) => image({ scale }),
    1,
    100,
    'Image width as a percentage of the final rotated and cropped frame width, limited to fit the frame height. Raise for a larger image',
  );
  position(imageLayout, 'image');
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
