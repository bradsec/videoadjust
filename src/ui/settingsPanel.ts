import { mountResetAll } from './resetAll';
import { estimateBytes } from '../core/estimate';
import { targetSizeStatus } from '../core/targetSize';
import {
  normalizeCrop,
  outputSize,
  remapCrop,
  rotatedSize,
  videoFrameSize,
} from '../core/videoGeometry';
import type { Container, Settings } from '../core/types';
import { availableVideoCodecs, codecLabel, outputChangeCount } from './controller';
import {
  audioLabels,
  formatFps,
  patchControls,
  renderAudioSettings,
  renderVideoSettings,
  type SettingsPanelOptions,
} from './encodingSettings';
import { el, icon, INSPECTOR_GROUP } from './dom';
import { formatBitrate, formatBytes } from './format';
import { formatByteRange, sizeMeter } from './progress';

export type { SettingsPanelOptions } from './encodingSettings';

const targetPresets = [8, 10, 16, 25, 50, 100];

function resolution(s: Settings): string {
  if (!s.video) return 'Audio only';
  const short = Math.min(s.video.width, s.video.height);
  return `${short}p`;
}

function audioSummary(s: Settings): string {
  if (!s.audio) return 'no audio';
  return `${audioLabels[s.audio.codec]} ${formatBitrate(s.audio.bitrate)} ${s.audio.channels === 1 ? 'mono' : 'stereo'}`;
}

export function mountSettings(
  host: HTMLElement,
  opts: SettingsPanelOptions,
): {
  resetAll: ReturnType<typeof mountResetAll>;
  update(s: Settings): void;
  setBusy(busy: boolean): void;
  changeTransform(t: NonNullable<Settings['transform']>): void;
} {
  let value = opts.value;
  const settingsState = {
    get value() {
      return value;
    },
    setPreferredEdge(edge: number | null) {
      preferredEdge = edge;
    },
  };
  let customTarget = !!value.targetSizeMB && !targetPresets.includes(value.targetSizeMB);
  let invalidTarget = false;
  let customDraft: string | undefined;
  const card = el('section', 'card export-summary');
  card.setAttribute('aria-label', 'Export summary');
  const eyebrow = el('span', 'overline', 'Ready to export');
  const heading = el('h2');
  const sub = el('p', 'export-sub num');
  const title = el('div', 'export-title');
  title.append(heading, sub);
  const estimate = el('div', 'export-estimate');
  const big = el('strong', 'export-estimate-big num');
  const from = el('span', 'export-from num');
  estimate.append(big, from);
  const meter = sizeMeter('New, estimated', 'Original');
  meter.origValue.textContent = formatBytes(opts.source.sizeBytes);
  const optimal = el('div', 'export-optimal');
  optimal.id = 'already-small';
  optimal.tabIndex = -1;
  optimal.append(
    el('strong', undefined, 'This video is already small'),
    el(
      'p',
      undefined,
      'The automatic export may not be smaller. You can trim this video and export only the part you need.',
    ),
  );
  const reencodeLabel = el('label', 'reencode-toggle');
  reencodeLabel.title =
    'Encode this already small video again to apply compression settings instead of making a trimmed copy';
  const reencode = el('input') as HTMLInputElement;
  reencode.type = 'checkbox';
  reencode.setAttribute('aria-label', 'Re-encode anyway');
  reencodeLabel.append(reencode, document.createTextNode('Re-encode anyway'));
  reencode.addEventListener('change', () => change({ ...value, passthrough: !reencode.checked }));
  optimal.append(reencodeLabel);
  const warning = el('p', 'export-warning');
  const exportButton = el('button', 'btn btn-primary btn-go');
  exportButton.type = 'button';
  let busy = false;
  exportButton.addEventListener('click', () => {
    if (exportButton.getAttribute('aria-disabled') === 'true') return;
    if (!value.targetSizeMB && opts.auto.alreadyOptimal && !reencode.checked)
      change({ ...value, passthrough: true });
    opts.onExport?.();
  });
  const details = el('details', 'adjust');
  details.name = INSPECTOR_GROUP;
  const disclosure = el('summary');
  const changeCount = el('span', 'adjust-state');
  disclosure.append(document.createTextNode('Output'), changeCount, icon('i-chev'));
  const controls = el('div', 'settings-controls');
  const passthroughReason = el('p', 'setting-reason', 'Not needed for a trimmed copy');
  details.append(disclosure, controls);
  // Where the dock floats over the page (phone and tablet), the full warning can sit below
  // the fold, so the dock repeats it in one line with a way to reach it.
  const dockNote = el('div', 'dock-note');
  const seeWhy = el('button', 'btn-link', 'See why');
  seeWhy.type = 'button';
  seeWhy.addEventListener('click', () => {
    optimal.scrollIntoView({ block: 'center' });
    optimal.focus({ preventScroll: true });
  });
  dockNote.append(icon('i-warn'), el('span', undefined, 'This video is already small.'), seeWhy);
  // The estimate and the one primary action are docked together, above Adjust.
  const dock = el('div', 'dock');
  dock.append(dockNote, estimate, exportButton);
  const spec = el('div', 'spec');
  spec.append(eyebrow, title, meter.node, optimal, warning, passthroughReason);
  const resetAll = mountResetAll(spec, opts.onResetAll);
  card.append(spec, dock, details);
  host.replaceChildren(card);

  function change(next: Settings): void {
    opts.onChange({ ...next, targetRetryScale: undefined });
  }
  function changeTransform(transform: NonNullable<Settings['transform']>): void {
    const video = value.video;
    const source = opts.source.video;
    if (!video || !source) return;
    const previous = value.transform ?? {
      rotate: 0,
      flip: false,
      crop: 'original' as const,
      rect: null,
    };
    const oldSize = rotatedSize(source.displayWidth, source.displayHeight, previous.rotate);
    const nextSize = rotatedSize(source.displayWidth, source.displayHeight, transform.rotate);
    const oldRect = normalizeCrop(oldSize.width, oldSize.height, previous.crop, previous.rect);
    const rect =
      transform.crop !== previous.crop
        ? normalizeCrop(nextSize.width, nextSize.height, transform.crop, transform.rect)
        : oldRect && (transform.rotate !== previous.rotate || transform.flip !== previous.flip)
          ? remapCrop(
              oldRect,
              source.displayWidth,
              source.displayHeight,
              previous.rotate,
              previous.flip,
              transform.rotate,
              transform.flip,
              transform.crop,
            )
          : normalizeCrop(nextSize.width, nextSize.height, transform.crop, transform.rect);
    preferredEdge ??= Math.max(video.width, video.height);
    const frame = videoFrameSize(source, transform.rotate, transform.crop, rect);
    const edge = Math.min(preferredEdge, Math.max(frame.width, frame.height));
    change({
      ...value,
      passthrough: false,
      transform: { ...transform, rect },
      video: { ...video, ...outputSize(source, transform.rotate, transform.crop, edge, rect) },
    });
  }
  function group(name: string, tip: string, automatic: string, reset: () => void): HTMLElement {
    const section = el('div', 'setting');
    section.title = tip;
    const head = el('div', 'setting-head');
    head.append(el('strong', undefined, name), el('span', 'setting-auto', `Auto: ${automatic}`));
    const button = el('button', 'setting-reset', 'Reset to auto');
    button.type = 'button';
    button.prepend(icon('i-reset'));
    button.setAttribute('aria-label', `Reset to auto: ${name}`);
    button.addEventListener('click', reset);
    head.append(button);
    section.append(head);
    return section;
  }
  function select(
    section: HTMLElement,
    name: string,
    items: { value: string; label: string; disabled?: boolean }[],
    current: string,
    onSelect: (selected: string) => void,
    unavailableReason?: string,
  ): void {
    // The setting's heading already names it on screen; the select keeps its own name.
    const label = el('label', 'setting-label');
    label.append(el('span', 'sr', name));
    const input = el('select', 'setting-select');
    input.setAttribute('aria-label', name);
    for (const item of items) {
      const option = el('option', undefined, item.label);
      option.value = item.value;
      option.disabled = !!item.disabled;
      input.append(option);
    }
    input.value = current;
    input.addEventListener('change', () => onSelect(input.value));
    const field = el('span', 'field');
    field.append(input, icon('i-chev'));
    label.append(field);
    section.append(label);
    const unavailable = items.filter((item) => item.disabled);
    if (unavailable.length)
      section.append(
        el(
          'p',
          'setting-reason',
          unavailableReason ??
            `${unavailable.map((item) => item.label).join(', ')} ${unavailable.length === 1 ? 'is' : 'are'} unavailable in this browser or format.`,
        ),
      );
  }
  let structure = '';
  // The resolution the user asked for, so a crop that shrinks the frame does not lose it when undone.
  let preferredEdge: number | null = null;
  function renderControls(): void {
    const precision = group(
      'Trim precision',
      'Fast copies compatible video from a keyframe. Exact re-encodes video to remove footage outside the trim.',
      'Fast (keyframe)',
      () => change({ ...value, trimPrecision: 'fast' }),
    );
    precision.classList.add('seek-setting');
    select(
      precision,
      'Trim precision',
      [
        { value: 'fast', label: 'Fast (keyframe)' },
        { value: 'exact', label: 'Exact (re-encode)' },
      ],
      value.trimPrecision ?? 'fast',
      (trimPrecision) => change({ ...value, trimPrecision: trimPrecision as 'fast' | 'exact' }),
    );
    precision.append(
      el(
        'p',
        'setting-help',
        'Fast can retain footage before the chosen start in the file, hidden by MP4 playback metadata. Exact is slower and re-encodes video; audio copy remains available.',
      ),
    );
    const groups: HTMLElement[] = [];
    const format = group(
      'Format',
      'Choose the output file container. MP4 with H.264 and AAC suits most players; WebM uses VP9 or AV1 with Opus audio',
      opts.auto.settings.container.toUpperCase(),
      () => change({ ...value, container: opts.auto.settings.container }),
    );
    select(
      format,
      'Format',
      (['mp4', 'webm'] as Container[]).map((container) => ({
        value: container,
        label: container === 'mp4' ? 'MP4' : 'WebM',
        disabled:
          availableVideoCodecs(container, opts.caps).length === 0 ||
          (container === 'webm' && !!opts.source.audio && !opts.caps.audio.opus),
      })),
      value.container,
      (container) => change({ ...value, container: container as Container }),
    );
    groups.push(format);

    const target = group(
      'Target size',
      'Aim the whole file at this size by choosing the encoding bitrate. Tight targets can also lower resolution and audio bitrate; the final size may vary',
      'Off',
      () => {
        customTarget = false;
        customDraft = undefined;
        invalidTarget = false;
        change({ ...value, targetSizeMB: null });
      },
    );
    target.classList.add('target-setting');
    select(
      target,
      'Target size',
      [
        { value: 'off', label: 'Off' },
        ...targetPresets.map((mb) => ({ value: String(mb), label: `${mb} MB` })),
        { value: 'custom', label: 'Custom' },
      ],
      customTarget ? 'custom' : String(value.targetSizeMB ?? 'off'),
      (choice) => {
        customTarget = choice === 'custom';
        customDraft = undefined;
        invalidTarget = false;
        change({
          ...value,
          targetSizeMB:
            choice === 'off' ? null : customTarget ? (value.targetSizeMB ?? 25) : Number(choice),
        });
      },
    );
    target.append(el('p', 'setting-help', 'Decimal MB: 1 MB = 1,000,000 bytes.'));
    if (customTarget) {
      const label = el('label', 'setting-label');
      label.title =
        'Set a whole-file target from 0.05 to 4096 decimal MB. One MB is 1,000,000 bytes';
      label.append(el('span', undefined, 'Custom target (MB)'));
      const input = el('input', 'setting-select') as HTMLInputElement;
      input.type = 'number';
      input.min = '0.05';
      input.max = '4096';
      input.step = 'any';
      input.required = true;
      input.value = customDraft ?? String(value.targetSizeMB ?? 25);
      input.setAttribute('aria-invalid', String(invalidTarget));
      input.setAttribute('aria-label', 'Custom target (MB)');
      const error = el('p', 'setting-reason', 'Enter a target between 0.05 and 4096 MB.');
      error.id = 'target-size-error';
      error.hidden = !invalidTarget;
      input.setAttribute('aria-describedby', error.id);
      input.addEventListener('input', () => {
        customDraft = input.value;
        invalidTarget = !input.validity.valid;
        input.setAttribute('aria-invalid', String(invalidTarget));
        error.hidden = !invalidTarget;
        renderExportLabel();
      });
      input.addEventListener('change', () => {
        if (!invalidTarget) change({ ...value, targetSizeMB: input.valueAsNumber });
      });
      label.append(input);
      target.append(label, error);
    }
    groups.push(target);

    groups.push(...renderVideoSettings(opts, settingsState, change, { group, select }));

    const metadata = group(
      'Metadata',
      'Keep source tags or replace the title. Strip source metadata to remove inherited tags',
      'Keep source tags',
      () => change({ ...value, metadata: { title: '', strip: false } }),
    );
    metadata.classList.add('metadata-setting');
    const titleLabel = el('label', 'setting-label');
    titleLabel.title =
      'Set the title stored inside the output file. Leave blank to keep the source title unless source metadata is stripped';
    titleLabel.append(el('span', undefined, 'Title'));
    const titleInput = el('input', 'setting-select') as HTMLInputElement;
    titleInput.type = 'text';
    titleInput.maxLength = 200;
    titleInput.value = value.metadata?.title ?? '';
    titleInput.setAttribute('aria-label', 'Output title');
    titleInput.addEventListener('change', () =>
      change({
        ...value,
        metadata: { title: titleInput.value, strip: value.metadata?.strip ?? false },
      }),
    );
    titleLabel.append(titleInput);
    metadata.append(titleLabel);
    const stripLabel = el('label', 'setting-label');
    stripLabel.title =
      'Remove source metadata tags from the export. A title you enter above is still included';
    const stripInput = el('input') as HTMLInputElement;
    stripInput.type = 'checkbox';
    stripInput.checked = value.metadata?.strip ?? false;
    stripInput.setAttribute('aria-label', 'Strip source metadata');
    stripInput.addEventListener('change', () =>
      change({
        ...value,
        metadata: { title: value.metadata?.title ?? '', strip: stripInput.checked },
      }),
    );
    stripLabel.append(stripInput, document.createTextNode('Strip source metadata'));
    metadata.append(stripLabel);
    groups.push(metadata);

    groups.push(...renderAudioSettings(opts, settingsState, change, { group, select }));
    controls.replaceChildren(precision, ...groups);
  }
  function update(next: Settings): void {
    const wasPassthrough = value.passthrough;
    value = next;
    const videoName = next.video ? codecLabel(next.video.codec) : 'No video';
    const audioName = next.audio ? `/${audioLabels[next.audio.codec]}` : '';
    heading.textContent = `${resolution(next)}, ${videoName}${audioName} ${next.container.toUpperCase()}`;
    sub.textContent = `${formatFps(next.video?.fps ?? 0)} fps · ${audioSummary(next)}`;
    const { low, high, mid } = estimateBytes(next, opts.source);
    const range = next.targetSizeMB ? formatBytes(mid) : formatByteRange(low, high);
    big.replaceChildren(el('small', undefined, 'est.'), ` ${range}`);
    from.textContent = `from ${formatBytes(opts.source.sizeBytes)}`;
    meter.newValue.textContent = range;
    meter.show(
      next.targetSizeMB ? mid : low,
      next.targetSizeMB ? mid : high,
      opts.source.sizeBytes,
    );
    optimal.hidden = !opts.auto.alreadyOptimal && !(next.targetSizeMB && next.passthrough);
    reencode.checked = !next.passthrough;
    renderExportLabel();
    dockNote.hidden = !opts.auto.alreadyOptimal;
    passthroughReason.hidden = !next.passthrough;
    if (next.passthrough && !wasPassthrough) details.open = false;
    const targetStatus = targetSizeStatus(next, opts.source);
    warning.textContent = targetStatus.tight
      ? 'This target is very tight. Try a shorter trim for better quality.'
      : targetStatus.alreadyUnder
        ? 'The trimmed copy is already under your target size. No re-encoding is needed.'
        : next.video?.codec !== 'avc'
          ? `${videoName} may not play on every device. H.264 MP4 is the most compatible choice.`
          : '';
    warning.hidden = !warning.textContent;
    const changes = outputChangeCount(next, opts.auto, opts.caps, opts.source);
    changeCount.textContent = changes
      ? `${changes} ${changes === 1 ? 'change' : 'changes'}`
      : 'All automatic';
    changeCount.classList.toggle('is-changed', changes > 0);
    const nextStructure = `${customTarget}:${next.container}:${!!next.video}:${!!next.audio}:${next.passthrough}:${next.transform?.rotate}:${next.transform?.crop}:${next.transform?.rect?.width}x${next.transform?.rect?.height}`;
    if (nextStructure !== structure) {
      const active = controls.contains(document.activeElement)
        ? (document.activeElement as HTMLElement)
        : null;
      const activeLabel = active?.getAttribute('aria-label');
      renderControls();
      structure = nextStructure;
      if (activeLabel) {
        const replacement = [...controls.querySelectorAll<HTMLElement>('[aria-label]')].find(
          (control) => control.getAttribute('aria-label') === activeLabel,
        );
        (
          replacement ?? controls.querySelector<HTMLElement>('select[aria-label="Audio codec"]')
        )?.focus();
      }
    }
    patchControls(controls, opts, customTarget, next);
  }
  function renderExportLabel(): void {
    if (busy || invalidTarget) exportButton.setAttribute('aria-disabled', 'true');
    else exportButton.removeAttribute('aria-disabled');
    exportButton.replaceChildren(icon('i-down'), busy ? 'Exporting...' : 'Export');
  }
  function setBusy(next: boolean): void {
    busy = next;
    if (busy) exportButton.setAttribute('aria-disabled', 'true');
    else exportButton.removeAttribute('aria-disabled');
    renderExportLabel();
  }
  update(value);
  return { update, setBusy, changeTransform, resetAll };
}
