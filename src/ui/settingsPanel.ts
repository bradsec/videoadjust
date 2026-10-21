import { scaleToLongEdge, targetVideoBitrate } from '../core/autoSettings';
import { estimateBytes } from '../core/estimate';
import type { AudioCodecId, AutoResult, Capabilities, Container, Settings, SourceInfo, VideoCodecId } from '../core/types';
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

function resolution(s: Settings): string {
  if (!s.video) return 'Audio only';
  const short = Math.min(s.video.width, s.video.height);
  return `${short}p`;
}

function audioSummary(s: Settings): string {
  if (!s.audio) return 'no audio';
  return `${s.audio.codec.toUpperCase()} ${formatBitrate(s.audio.bitrate)} ${s.audio.channels === 1 ? 'mono' : 'stereo'}`;
}

export function mountSettings(host: HTMLElement, opts: SettingsPanelOptions): { update(s: Settings): void } {
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
  original.append(el('span', undefined, 'Original'), el('span', 'num', formatBytes(opts.source.sizeBytes)));
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
  optimal.append(el('strong', undefined, 'This video is already small'),
    el('p', undefined, 'The automatic export may not be smaller. You can trim this video and export only the part you need.'));
  const warning = el('p', 'export-warning');
  const exportButton = el('button', 'btn btn-primary btn-block', 'Export');
  exportButton.type = 'button';
  exportButton.addEventListener('click', () => opts.onExport?.());
  const details = el('details', 'adjust');
  const disclosure = el('summary');
  const changeCount = el('span', 'adjust-state');
  disclosure.append(document.createTextNode('Adjust'), changeCount);
  const controls = el('div', 'settings-controls');
  details.append(disclosure, controls);
  card.append(eyebrow, title, estimate, bars, optimal, warning, exportButton, details);
  host.replaceChildren(card);

  function change(next: Settings): void { opts.onChange(next); }
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
  function select(section: HTMLElement, name: string, items: { value: string; label: string; disabled?: boolean }[], current: string,
    onSelect: (selected: string) => void): void {
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
    if (unavailable.length) section.append(el('p', 'setting-reason',
      `${unavailable.map((item) => item.label).join(', ')} ${unavailable.length === 1 ? 'is' : 'are'} unavailable in this browser or format.`));
  }
  function renderControls(): void {
    const groups: HTMLElement[] = [];
    const format = group('Format', opts.auto.settings.container.toUpperCase(), () => change({ ...value, container: opts.auto.settings.container }));
    select(format, 'Format', (['mp4', 'webm'] as Container[]).map((container) => ({
      value: container, label: container === 'mp4' ? 'MP4' : 'WebM',
      disabled: availableVideoCodecs(container, opts.caps).length === 0 ||
        (container === 'webm' && !!opts.source.audio && !opts.caps.audio.opus),
    })), value.container, (container) => change({ ...value, container: container as Container }));
    groups.push(format);

    if (value.video && opts.auto.settings.video && opts.source.video) {
      const video = value.video;
      const autoVideo = opts.auto.settings.video;
      const codec = group('Video codec', codecLabel(autoVideo.codec), () => change({ ...value, video: { ...video, codec: autoVideo.codec } }));
      select(codec, 'Video codec', videoCodecs.map((id) => ({ value: id, label: codecLabel(id),
        disabled: !availableVideoCodecs(value.container, opts.caps).includes(id) })), video.codec,
      (id) => change({ ...value, video: { ...video, codec: id as VideoCodecId } }));
      groups.push(codec);

      const size = group('Resolution', resolution(opts.auto.settings), () => change({ ...value, video: { ...video, width: autoVideo.width, height: autoVideo.height } }));
      const sourceEdge = Math.max(opts.source.video.displayWidth, opts.source.video.displayHeight);
      const edges = [...new Set([sourceEdge, ...opts.auto.sizeSteps])].filter((edge) => edge <= sourceEdge).sort((a, b) => b - a);
      select(size, 'Resolution', edges.map((edge) => {
        const dims = scaleToLongEdge(opts.source.video!.displayWidth, opts.source.video!.displayHeight, edge);
        return { value: String(edge), label: `${Math.min(dims.width, dims.height)}p (${dims.width}x${dims.height})` };
      }), String(edges.find((edge) => {
        const dims = scaleToLongEdge(opts.source.video!.displayWidth, opts.source.video!.displayHeight, edge);
        return dims.width === video.width && dims.height === video.height;
      }) ?? sourceEdge), (edge) => {
        const dims = scaleToLongEdge(opts.source.video!.displayWidth, opts.source.video!.displayHeight, Number(edge));
        change({ ...value, video: { ...video, ...dims } });
      });
      groups.push(size);

      const frame = group('Frame rate', `${autoVideo.fps} fps`, () => change({ ...value, video: { ...video, fps: autoVideo.fps } }));
      const rates = [...new Set([15, 24, 30, autoVideo.fps, opts.source.video.fps])]
        .filter((fps) => fps > 0 && fps <= opts.source.video!.fps).sort((a, b) => a - b);
      select(frame, 'Frame rate', rates.map((fps) => ({ value: String(fps), label: `${fps} fps` })), String(video.fps),
        (fps) => change({ ...value, video: { ...video, fps: Number(fps) } }));
      groups.push(frame);

      const quality = group('Quality', '100%', () => change({ ...value, video: { ...video, bitrate: autoVideo.bitrate } }));
      const baseline = Math.min(targetVideoBitrate(video.codec, video.width, video.height, video.fps), opts.source.video.bitrate ?? Infinity);
      const maxPercent = Math.min(150, Math.floor((opts.source.video.bitrate ?? Infinity) / baseline * 100));
      const percent = baseline > 0 ? Math.round(video.bitrate / baseline * 100) : 100;
      const sliderLabel = el('label', 'setting-label', `Quality: ${percent}% of auto`);
      const slider = el('input', 'setting-range') as HTMLInputElement;
      slider.type = 'range';
      slider.min = '25';
      slider.max = String(Math.max(25, maxPercent));
      slider.step = '1';
      slider.value = String(percent);
      slider.setAttribute('aria-label', 'Quality');
      slider.addEventListener('change', () => change({ ...value, video: { ...video, bitrate: Math.round(baseline * Number(slider.value) / 100) } }));
      sliderLabel.append(slider);
      quality.append(sliderLabel, el('p', 'setting-help', `25% to ${Math.max(25, maxPercent)}% of auto · ${formatBitrate(video.bitrate)}`));
      groups.push(quality);
    }

    if (opts.source.audio && opts.auto.settings.audio) {
      const automatic = opts.auto.settings.audio;
      const audio = group('Audio codec', automatic.codec.toUpperCase(), () => change({ ...value, audio: automatic }));
      const audioOptions: { value: string; label: string; disabled: boolean }[] = audioCodecs.map((id) => ({ value: id, label: id.toUpperCase(),
        disabled: !opts.caps.audio[id] || (value.container === 'webm' && id !== 'opus') }));
      audioOptions.push({ value: 'none', label: 'Remove audio', disabled: false });
      select(audio, 'Audio codec', audioOptions, value.audio?.codec ?? 'none', (id) => change({ ...value,
        audio: id === 'none' ? null : { ...(value.audio ?? automatic), codec: id as AudioCodecId, copy: false },
      }));
      groups.push(audio);
      if (value.audio) {
        const bitrate = group('Audio bitrate', formatBitrate(automatic.bitrate), () => change({ ...value, audio: automatic }));
        const max = opts.source.audio.bitrate ?? Infinity;
        const rates = [...new Set([...audioRates.filter((rate) => rate <= max), value.audio.bitrate])].sort((a, b) => a - b);
        select(bitrate, 'Audio bitrate', rates.map((rate) => ({ value: String(rate), label: formatBitrate(rate) })),
          String(value.audio.bitrate), (rate) => change({ ...value, audio: { ...value.audio!, bitrate: Number(rate), copy: false } }));
        if (max < 160_000) bitrate.append(el('p', 'setting-reason', `Higher rates exceed the source audio bitrate (${formatBitrate(max)}).`));
        groups.push(bitrate);
      }
    }
    controls.replaceChildren(...groups);
  }
  function update(next: Settings): void {
    value = next;
    const videoName = next.video ? codecLabel(next.video.codec) : 'No video';
    const audioName = next.audio ? `/${next.audio.codec.toUpperCase()}` : '';
    heading.textContent = `${resolution(next)}, ${videoName}${audioName} ${next.container.toUpperCase()}`;
    sub.textContent = `${next.video?.fps ?? 0} fps · ${audioSummary(next)}`;
    const { low, high } = estimateBytes(next);
    const range = `${formatBytes(low)}–${formatBytes(high)}`;
    big.textContent = `est. ${range}`;
    from.textContent = `from ${formatBytes(opts.source.sizeBytes)}`;
    newSize.textContent = range;
    newBar.value = Math.min(high, newBar.max);
    optimal.hidden = !opts.auto.alreadyOptimal;
    warning.textContent = next.video?.codec !== 'avc'
      ? `${videoName} may not play on every device. H.264 MP4 is the most compatible choice.` : '';
    warning.hidden = !warning.textContent;
    const changes = settingsChangeCount(next, opts.auto, opts.caps, opts.source);
    changeCount.textContent = changes ? `${changes} ${changes === 1 ? 'change' : 'changes'}` : 'All automatic';
    renderControls();
  }
  update(value);
  return { update };
}
