import { scaleToLongEdge, targetVideoBitrate } from '../core/autoSettings';
import { estimateBytes } from '../core/estimate';
import type {
  AudioCodecId,
  AutoResult,
  Capabilities,
  Container,
  Settings,
  SourceInfo,
  VideoCodecId,
} from '../core/types';
import { availableVideoCodecs, codecLabel, settingsChangeCount } from './controller';
import { el } from './dom';
import { formatBitrate, formatBytes } from './format';

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
): { update(s: Settings): void } {
  let value = opts.value;
  const card = el('section', 'card export-summary');
  card.setAttribute('aria-label', 'Export summary');
  const eyebrow = el('span', 'eyebrow', 'Ready to export');
  const heading = el('h2');
  const sub = el('p', 'export-sub num');
  const title = el('div');
  title.append(heading, sub);
  const estimate = el('div', 'export-estimate');
  const big = el('strong', 'export-estimate-big num');
  const from = el('span', 'export-from num');
  estimate.append(big, from);
  const bars = el('div', 'export-bars');
  const original = el('div', 'export-bar-row');
  original.append(
    el('span', undefined, 'Original'),
    el('span', 'num', formatBytes(opts.source.sizeBytes)),
  );
  const originalBar = el('progress');
  originalBar.max = 1;
  originalBar.value = 1;
  original.append(originalBar);
  const newer = el('div', 'export-bar-row');
  const newLabel = el('span', undefined, 'New, estimated');
  const newSize = el('span', 'num');
  const newBar = el('progress');
  newBar.max = Math.max(1, opts.source.sizeBytes);
  newer.append(newLabel, newSize, newBar);
  bars.append(original, newer);
  const optimal = el('div', 'export-optimal');
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
  const exportButton = el('button', 'btn btn-primary btn-block', 'Export');
  exportButton.type = 'button';
  exportButton.addEventListener('click', () => {
    if (opts.auto.alreadyOptimal && !reencode.checked) change({ ...value, passthrough: true });
    opts.onExport?.();
  });
  const details = el('details', 'adjust');
  const disclosure = el('summary');
  const changeCount = el('span', 'adjust-state');
  disclosure.append(document.createTextNode('Adjust'), changeCount);
  const controls = el('div', 'settings-controls');
  const passthroughReason = el('p', 'setting-reason', 'Not needed for a trimmed copy');
  details.append(disclosure, controls);
  card.append(
    eyebrow,
    title,
    estimate,
    bars,
    optimal,
    warning,
    exportButton,
    passthroughReason,
    details,
  );
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
    button.setAttribute('aria-label', `Reset ${name} to auto`);
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
  ): void {
    const label = el('label', 'setting-label', name);
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
    label.append(input);
    section.append(label);
    const unavailable = items.filter((item) => item.disabled);
    if (unavailable.length)
      section.append(
        el(
          'p',
          'setting-reason',
          `${unavailable.map((item) => item.label).join(', ')} ${unavailable.length === 1 ? 'is' : 'are'} unavailable in this browser or format.`,
        ),
      );
  }
  let structure = '';
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

      const size = group('Resolution', resolution(opts.auto.settings), () =>
        change({
          ...value,
          video: { ...value.video!, width: autoVideo.width, height: autoVideo.height },
        }),
      );
      const sourceEdge = Math.max(opts.source.video.displayWidth, opts.source.video.displayHeight);
      const edges = [...new Set([sourceEdge, ...opts.auto.sizeSteps])]
        .filter((edge) => edge <= sourceEdge)
        .sort((a, b) => b - a);
      select(
        size,
        'Resolution',
        edges.map((edge) => {
          const dims = scaleToLongEdge(
            opts.source.video!.displayWidth,
            opts.source.video!.displayHeight,
            edge,
          );
          return {
            value: String(edge),
            label: `${Math.min(dims.width, dims.height)}p (${dims.width}x${dims.height})`,
          };
        }),
        String(
          edges.find((edge) => {
            const dims = scaleToLongEdge(
              opts.source.video!.displayWidth,
              opts.source.video!.displayHeight,
              edge,
            );
            return dims.width === video.width && dims.height === video.height;
          }) ?? sourceEdge,
        ),
        (edge) => {
          const dims = scaleToLongEdge(
            opts.source.video!.displayWidth,
            opts.source.video!.displayHeight,
            Number(edge),
          );
          change({ ...value, video: { ...value.video!, ...dims } });
        },
      );
      groups.push(size);

      const frame = group('Frame rate', `${autoVideo.fps} fps`, () =>
        change({ ...value, video: { ...value.video!, fps: autoVideo.fps } }),
      );
      const rates = [...new Set([15, 24, 30, autoVideo.fps, opts.source.video.fps])]
        .filter((fps) => fps > 0 && fps <= opts.source.video!.fps)
        .sort((a, b) => a - b);
      select(
        frame,
        'Frame rate',
        rates.map((fps) => ({ value: String(fps), label: `${fps} fps` })),
        String(video.fps),
        (fps) => change({ ...value, video: { ...value.video!, fps: Number(fps) } }),
      );
      groups.push(frame);

      const quality = group('Quality', '100%', () =>
        change({ ...value, video: { ...value.video!, bitrate: autoVideo.bitrate } }),
      );
      const baseline = Math.min(
        targetVideoBitrate(video.codec, video.width, video.height, video.fps),
        opts.source.video.bitrate ?? Infinity,
      );
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
      selected('Video codec', video.codec);
      const edges = [
        Math.max(opts.source.video.displayWidth, opts.source.video.displayHeight),
        ...opts.auto.sizeSteps,
      ];
      const edge = edges.find((candidate) => {
        const dims = scaleToLongEdge(
          opts.source.video!.displayWidth,
          opts.source.video!.displayHeight,
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
      const help = controls.querySelector('.setting-help');
      if (help)
        help.textContent = `25% to ${maxPercent}% of auto · ${formatBitrate(video.bitrate)}`;
    }
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
        input.disabled = next.passthrough;
      });
  }
  function update(next: Settings): void {
    const wasPassthrough = value.passthrough;
    value = next;
    const videoName = next.video ? codecLabel(next.video.codec) : 'No video';
    const audioName = next.audio ? `/${audioLabels[next.audio.codec]}` : '';
    heading.textContent = `${resolution(next)}, ${videoName}${audioName} ${next.container.toUpperCase()}`;
    sub.textContent = `${next.video?.fps ?? 0} fps · ${audioSummary(next)}`;
    const { low, high } = estimateBytes(next, opts.source);
    const range = `${formatBytes(low)}–${formatBytes(high)}`;
    big.textContent = `est. ${range}`;
    from.textContent = `from ${formatBytes(opts.source.sizeBytes)}`;
    newSize.textContent = range;
    newBar.value = Math.min(high, newBar.max);
    optimal.hidden = !opts.auto.alreadyOptimal;
    reencode.checked = !next.passthrough;
    exportButton.textContent = next.passthrough ? 'Export trimmed copy' : 'Export';
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
    const nextStructure = `${next.container}:${!!next.video}:${!!next.audio}:${next.passthrough}`;
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
  update(value);
  return { update };
}
