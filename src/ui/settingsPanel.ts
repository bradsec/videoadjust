import { targetVideoBitrate } from '../core/autoSettings';
import { estimateBytes } from '../core/estimate';
import { cropRectangle, outputSize, rotatedSize, videoFrameSize } from '../core/videoGeometry';
import type {
  AudioCodecId,
  AutoResult,
  Capabilities,
  Container,
  CropPreset,
  Rotation,
  Settings,
  SourceInfo,
  VideoCodecId,
} from '../core/types';
import { availableVideoCodecs, codecLabel, settingsChangeCount } from './controller';
import { el, icon } from './dom';
import { formatBitrate, formatBytes } from './format';
import { formatByteRange, sizeMeter } from './progress';

export interface SettingsPanelOptions {
  auto: AutoResult;
  caps: Capabilities;
  source: SourceInfo;
  value: Settings;
  onChange(s: Settings): void;
  onExport?: () => void;
}

const videoCodecs: VideoCodecId[] = ['avc', 'hevc', 'av1', 'vp9'];
const audioCodecs: AudioCodecId[] = ['aac', 'opus'];
const audioRates = [64_000, 96_000, 128_000, 160_000];
const audioLabels: Record<AudioCodecId, string> = { aac: 'AAC', opus: 'Opus' };
const formatFps = (fps: number): string => String(Math.round(fps * 100) / 100);

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
): { update(s: Settings): void; setBusy(busy: boolean): void } {
  let value = opts.value;
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
    if (opts.auto.alreadyOptimal && !reencode.checked) change({ ...value, passthrough: true });
    opts.onExport?.();
  });
  const details = el('details', 'adjust');
  const disclosure = el('summary');
  const changeCount = el('span', 'adjust-state');
  disclosure.append(document.createTextNode('Adjust'), changeCount, icon('i-chev'));
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
  card.append(spec, dock, details);
  host.replaceChildren(card);

  function change(next: Settings): void {
    opts.onChange(next);
  }
  function group(name: string, automatic: string, reset: () => void): HTMLElement {
    const section = el('div', 'setting');
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
    const groups: HTMLElement[] = [];
    const format = group('Format', opts.auto.settings.container.toUpperCase(), () =>
      change({ ...value, container: opts.auto.settings.container }),
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

    if (value.video && opts.auto.settings.video && opts.source.video) {
      const video = value.video;
      const autoVideo = opts.auto.settings.video;
      const rotate = value.transform?.rotate ?? 0;
      const crop = value.transform?.crop ?? 'original';
      const frameSize = videoFrameSize(opts.source.video, rotate, crop);
      const autoSize = outputSize(
        opts.source.video,
        rotate,
        crop,
        Math.max(autoVideo.width, autoVideo.height),
      );
      const updateTransform = (transform: NonNullable<Settings['transform']>) => {
        const frame = videoFrameSize(opts.source.video!, transform.rotate, transform.crop);
        preferredEdge ??= Math.max(video.width, video.height);
        const edge = Math.min(preferredEdge, Math.max(frame.width, frame.height));
        change({
          ...value,
          passthrough: false,
          transform,
          video: {
            ...video,
            ...outputSize(opts.source.video!, transform.rotate, transform.crop, edge),
          },
        });
      };
      const rotation = group('Rotate', '0°', () =>
        updateTransform({ ...(value.transform ?? { flip: false, crop: 'original' }), rotate: 0 }),
      );
      rotation.classList.add('transform-setting');
      select(
        rotation,
        'Rotate clockwise',
        [0, 90, 180, 270].map((angle) => ({ value: String(angle), label: `${angle}°` })),
        String(rotate),
        (angle) =>
          updateTransform({
            rotate: Number(angle) as Rotation,
            flip: value.transform?.flip ?? false,
            crop: value.transform?.crop ?? 'original',
          }),
      );
      groups.push(rotation);
      const mirror = group('Mirror', 'Off', () => updateTransform({ rotate, flip: false, crop }));
      mirror.classList.add('transform-setting');
      const mirrorLabel = el('label', 'setting-label');
      const mirrorInput = el('input') as HTMLInputElement;
      mirrorInput.type = 'checkbox';
      mirrorInput.checked = value.transform?.flip ?? false;
      mirrorInput.setAttribute('aria-label', 'Mirror video');
      mirrorInput.addEventListener('change', () =>
        updateTransform({ rotate, flip: mirrorInput.checked, crop }),
      );
      mirrorLabel.append(mirrorInput, document.createTextNode('Flip horizontally'));
      mirror.append(mirrorLabel);
      groups.push(mirror);
      const cropGroup = group('Crop', 'Original', () =>
        updateTransform({ rotate, flip: value.transform?.flip ?? false, crop: 'original' }),
      );
      cropGroup.classList.add('transform-setting');
      const rotated = rotatedSize(
        opts.source.video.displayWidth,
        opts.source.video.displayHeight,
        rotate,
      );
      select(
        cropGroup,
        'Crop preset',
        [
          { value: 'original', label: 'Original' },
          { value: 'square', label: 'Square 1:1' },
          { value: 'portrait', label: 'Portrait 9:16' },
          {
            value: 'landscape',
            label: 'Landscape 16:9',
            disabled: !cropRectangle(rotated.width, rotated.height, 'landscape'),
          },
        ],
        crop,
        (preset) =>
          updateTransform({
            rotate,
            flip: value.transform?.flip ?? false,
            crop: preset as CropPreset,
          }),
        'Landscape crop needs a landscape frame after rotation.',
      );
      if (rotate || value.transform?.flip || crop !== 'original')
        cropGroup.append(
          el(
            'p',
            'setting-help',
            'The preview shows the original video. Rotate, mirror, and crop apply to the export.',
          ),
        );
      groups.push(cropGroup);
      const codec = group('Video codec', codecLabel(autoVideo.codec), () =>
        change({ ...value, video: { ...value.video!, codec: autoVideo.codec } }),
      );
      select(
        codec,
        'Video codec',
        videoCodecs.map((id) => ({
          value: id,
          label: codecLabel(id),
          disabled: !availableVideoCodecs(value.container, opts.caps).includes(id),
        })),
        video.codec,
        (id) => change({ ...value, video: { ...value.video!, codec: id as VideoCodecId } }),
      );
      groups.push(codec);

      const size = group('Resolution', `${Math.min(autoSize.width, autoSize.height)}p`, () => {
        preferredEdge = null;
        change({
          ...value,
          video: { ...value.video!, ...autoSize },
        });
      });
      const sourceEdge = Math.max(frameSize.width, frameSize.height);
      const edges = [...new Set([sourceEdge, ...opts.auto.sizeSteps])]
        .filter((edge) => edge <= sourceEdge)
        .sort((a, b) => b - a);
      select(
        size,
        'Resolution',
        edges.map((edge) => {
          const dims = outputSize(opts.source.video!, rotate, crop, edge);
          return {
            value: String(edge),
            label: `${Math.min(dims.width, dims.height)}p (${dims.width}x${dims.height})`,
          };
        }),
        String(
          edges.find((edge) => {
            const dims = outputSize(opts.source.video!, rotate, crop, edge);
            return dims.width === video.width && dims.height === video.height;
          }) ?? sourceEdge,
        ),
        (edge) => {
          preferredEdge = Number(edge);
          const dims = outputSize(opts.source.video!, rotate, crop, Number(edge));
          change({ ...value, video: { ...value.video!, ...dims } });
        },
      );
      groups.push(size);

      const frame = group('Frame rate', `${formatFps(autoVideo.fps)} fps`, () =>
        change({ ...value, video: { ...value.video!, fps: autoVideo.fps } }),
      );
      const rates = [...new Set([15, 24, 30, autoVideo.fps, opts.source.video.fps])]
        .filter((fps) => fps > 0 && fps <= opts.source.video!.fps)
        .sort((a, b) => a - b);
      select(
        frame,
        'Frame rate',
        rates.map((fps) => ({ value: String(fps), label: `${formatFps(fps)} fps` })),
        String(video.fps),
        (fps) => change({ ...value, video: { ...value.video!, fps: Number(fps) } }),
      );
      groups.push(frame);

      const seekability = group('Seekability', 'Default', () =>
        change({ ...value, keyFrameInterval: null }),
      );
      seekability.classList.add('seek-setting');
      select(
        seekability,
        'Keyframe interval',
        [
          { value: 'default', label: 'Default' },
          { value: '1', label: '1 second' },
          { value: '2', label: '2 seconds' },
        ],
        String(value.keyFrameInterval ?? 'default'),
        (interval) =>
          change({
            ...value,
            passthrough: false,
            keyFrameInterval: interval === 'default' ? null : (Number(interval) as 1 | 2),
          }),
      );
      seekability.append(
        el('p', 'setting-help', 'More keyframes improve seeking but increase file size.'),
      );
      groups.push(seekability);

      const baseline = Math.min(
        targetVideoBitrate(video.codec, video.width, video.height, video.fps),
        opts.source.video.bitrate ?? Infinity,
      );
      const quality = group('Quality', '100%', () =>
        change({
          ...value,
          video: {
            ...value.video!,
            bitrate: Math.min(
              targetVideoBitrate(
                value.video!.codec,
                value.video!.width,
                value.video!.height,
                value.video!.fps,
              ),
              opts.source.video!.bitrate ?? Infinity,
            ),
          },
        }),
      );
      quality.classList.add('quality-setting');
      const maxPercent = Math.min(
        150,
        Math.floor(((opts.source.video.bitrate ?? Infinity) / baseline) * 100),
      );
      const percent = baseline > 0 ? Math.round((video.bitrate / baseline) * 100) : 100;
      const sliderLabel = el('label', 'setting-label');
      const sliderText = el('span', 'quality-value', `Quality: ${percent}% of auto`);
      const slider = el('input', 'setting-range') as HTMLInputElement;
      slider.type = 'range';
      slider.min = '25';
      slider.max = String(Math.max(25, maxPercent));
      slider.step = '1';
      slider.value = String(percent);
      slider.setAttribute('aria-label', 'Quality');
      slider.addEventListener('input', () => {
        sliderText.textContent = `Quality: ${slider.value}% of auto`;
      });
      slider.addEventListener('change', () => {
        const current = value.video!;
        const currentBaseline = Math.min(
          targetVideoBitrate(current.codec, current.width, current.height, current.fps),
          opts.source.video!.bitrate ?? Infinity,
        );
        change({
          ...value,
          video: {
            ...current,
            bitrate: Math.round((currentBaseline * Number(slider.value)) / 100),
          },
        });
      });
      sliderLabel.append(sliderText, slider);
      quality.append(
        sliderLabel,
        el(
          'p',
          'setting-help',
          `25% to ${Math.max(25, maxPercent)}% of auto · ${formatBitrate(video.bitrate)}`,
        ),
      );
      groups.push(quality);
    }

    const metadata = group('Metadata', 'Keep source tags', () =>
      change({ ...value, metadata: { title: '', strip: false } }),
    );
    metadata.classList.add('metadata-setting');
    const titleLabel = el('label', 'setting-label');
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

    if (opts.source.audio && opts.auto.settings.audio) {
      const automatic = opts.auto.settings.audio;
      const audio = group('Audio codec', audioLabels[automatic.codec], () =>
        change({
          ...value,
          audio: { ...(value.audio ?? automatic), codec: automatic.codec, copy: automatic.copy },
        }),
      );
      const audioOptions: { value: string; label: string; disabled: boolean }[] = audioCodecs.map(
        (id) => ({
          value: id,
          label: audioLabels[id],
          disabled: !opts.caps.audio[id] || (value.container === 'webm' && id !== 'opus'),
        }),
      );
      audioOptions.push({ value: 'none', label: 'Remove audio', disabled: false });
      select(audio, 'Audio codec', audioOptions, value.audio?.codec ?? 'none', (id) =>
        change({
          ...value,
          audio:
            id === 'none'
              ? null
              : { ...(value.audio ?? automatic), codec: id as AudioCodecId, copy: false },
        }),
      );
      groups.push(audio);
      if (value.audio) {
        const bitrate = group('Audio bitrate', formatBitrate(automatic.bitrate), () =>
          change({
            ...value,
            audio: { ...value.audio!, bitrate: automatic.bitrate, copy: automatic.copy },
          }),
        );
        const max = opts.source.audio.bitrate ?? Infinity;
        const rates = [
          ...new Set([...audioRates.filter((rate) => rate <= max), value.audio.bitrate]),
        ].sort((a, b) => a - b);
        select(
          bitrate,
          'Audio bitrate',
          rates.map((rate) => ({ value: String(rate), label: formatBitrate(rate) })),
          String(value.audio.bitrate),
          (rate) =>
            change({ ...value, audio: { ...value.audio!, bitrate: Number(rate), copy: false } }),
        );
        if (max < 160_000)
          bitrate.append(
            el(
              'p',
              'setting-reason',
              `Higher rates exceed the source audio bitrate (${formatBitrate(max)}).`,
            ),
          );
        groups.push(bitrate);
      }
    }
    controls.replaceChildren(...groups);
  }
  function patchControls(next: Settings): void {
    const selected = (name: string, selectedValue: string) => {
      const input = controls.querySelector<HTMLSelectElement>(`select[aria-label="${name}"]`);
      if (input && input.value !== selectedValue) input.value = selectedValue;
    };
    selected('Format', next.container);
    if (next.video && opts.source.video) {
      const video = next.video;
      selected('Rotate clockwise', String(next.transform?.rotate ?? 0));
      selected('Crop preset', next.transform?.crop ?? 'original');
      selected('Keyframe interval', String(next.keyFrameInterval ?? 'default'));
      const mirror = controls.querySelector<HTMLInputElement>('input[aria-label="Mirror video"]');
      if (mirror) mirror.checked = next.transform?.flip ?? false;
      selected('Video codec', video.codec);
      const edges = [
        Math.max(opts.source.video.displayWidth, opts.source.video.displayHeight),
        ...opts.auto.sizeSteps,
      ];
      const edge = edges.find((candidate) => {
        const dims = outputSize(
          opts.source.video!,
          next.transform?.rotate ?? 0,
          next.transform?.crop ?? 'original',
          candidate,
        );
        return dims.width === video.width && dims.height === video.height;
      });
      if (edge) selected('Resolution', String(edge));
      selected('Frame rate', String(video.fps));
      const baseline = Math.min(
        targetVideoBitrate(video.codec, video.width, video.height, video.fps),
        opts.source.video.bitrate ?? Infinity,
      );
      const maxPercent = Math.max(
        25,
        Math.min(150, Math.floor(((opts.source.video.bitrate ?? Infinity) / baseline) * 100)),
      );
      const percent = baseline > 0 ? Math.round((video.bitrate / baseline) * 100) : 100;
      const slider = controls.querySelector<HTMLInputElement>('input[aria-label="Quality"]');
      if (slider) {
        slider.max = String(maxPercent);
        slider.value = String(percent);
      }
      const qualityValue = controls.querySelector('.quality-value');
      if (qualityValue) qualityValue.textContent = `Quality: ${percent}% of auto`;
      const help = controls.querySelector('.quality-setting .setting-help');
      if (help)
        help.textContent = `25% to ${maxPercent}% of auto · ${formatBitrate(video.bitrate)}`;
    }
    const titleInput = controls.querySelector<HTMLInputElement>('input[aria-label="Output title"]');
    if (titleInput && titleInput !== document.activeElement)
      titleInput.value = next.metadata?.title ?? '';
    const stripInput = controls.querySelector<HTMLInputElement>(
      'input[aria-label="Strip source metadata"]',
    );
    if (stripInput) stripInput.checked = next.metadata?.strip ?? false;
    selected('Audio codec', next.audio?.codec ?? 'none');
    if (next.audio) {
      const bitrate = controls.querySelector<HTMLSelectElement>(
        'select[aria-label="Audio bitrate"]',
      );
      if (bitrate) {
        const current = String(next.audio.bitrate);
        if (![...bitrate.options].some((option) => option.value === current)) {
          const option = el('option', undefined, formatBitrate(next.audio.bitrate));
          option.value = current;
          bitrate.append(option);
        }
        bitrate.value = current;
      }
    }
    controls
      .querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>(
        'input, select, button',
      )
      .forEach((input) => {
        input.disabled =
          next.passthrough &&
          !input.closest('.metadata-setting, .transform-setting, .seek-setting');
      });
  }
  function update(next: Settings): void {
    const wasPassthrough = value.passthrough;
    value = next;
    const videoName = next.video ? codecLabel(next.video.codec) : 'No video';
    const audioName = next.audio ? `/${audioLabels[next.audio.codec]}` : '';
    heading.textContent = `${resolution(next)}, ${videoName}${audioName} ${next.container.toUpperCase()}`;
    sub.textContent = `${formatFps(next.video?.fps ?? 0)} fps · ${audioSummary(next)}`;
    const { low, high } = estimateBytes(next, opts.source);
    const range = formatByteRange(low, high);
    big.replaceChildren(el('small', undefined, 'est.'), ` ${range}`);
    from.textContent = `from ${formatBytes(opts.source.sizeBytes)}`;
    meter.newValue.textContent = range;
    meter.show(low, high, opts.source.sizeBytes);
    optimal.hidden = !opts.auto.alreadyOptimal;
    reencode.checked = !next.passthrough;
    renderExportLabel();
    dockNote.hidden = !opts.auto.alreadyOptimal;
    passthroughReason.hidden = !next.passthrough;
    if (next.passthrough && !wasPassthrough) details.open = false;
    warning.textContent =
      next.video?.codec !== 'avc'
        ? `${videoName} may not play on every device. H.264 MP4 is the most compatible choice.`
        : '';
    warning.hidden = !warning.textContent;
    const changes = settingsChangeCount(next, opts.auto, opts.caps, opts.source);
    changeCount.textContent = changes
      ? `${changes} ${changes === 1 ? 'change' : 'changes'}`
      : 'All automatic';
    changeCount.classList.toggle('is-changed', changes > 0);
    const nextStructure = `${next.container}:${!!next.video}:${!!next.audio}:${next.passthrough}:${next.transform?.rotate}:${next.transform?.crop}`;
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
    patchControls(next);
  }
  function renderExportLabel(): void {
    exportButton.replaceChildren(
      icon('i-down'),
      busy ? 'Exporting...' : value.passthrough ? 'Export trimmed copy' : 'Export',
    );
  }
  function setBusy(next: boolean): void {
    busy = next;
    if (busy) exportButton.setAttribute('aria-disabled', 'true');
    else exportButton.removeAttribute('aria-disabled');
    renderExportLabel();
  }
  update(value);
  return { update, setBusy };
}
