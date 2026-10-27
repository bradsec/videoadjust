import { targetVideoBitrate } from '../core/autoSettings';
import { outputSize, videoFrameSize } from '../core/videoGeometry';
import type {
  AudioCodecId,
  AutoResult,
  Capabilities,
  Settings,
  SourceInfo,
  VideoCodecId,
} from '../core/types';
import { availableVideoCodecs, codecLabel } from './controller';
import { el } from './dom';
import { formatBitrate } from './format';

export interface SettingsPanelOptions {
  auto: AutoResult;
  caps: Capabilities;
  source: SourceInfo;
  value: Settings;
  onChange(s: Settings): void;
  onExport?: () => void;
  onResetAll?: () => void;
}

const videoCodecs: VideoCodecId[] = ['avc', 'hevc', 'av1', 'vp9'];
const audioCodecs: AudioCodecId[] = ['aac', 'opus'];
const audioRates = [64_000, 96_000, 128_000, 160_000];
export const audioLabels: Record<AudioCodecId, string> = { aac: 'AAC', opus: 'Opus' };
export const formatFps = (fps: number): string => String(Math.round(fps * 100) / 100);

type Fields = {
  group(name: string, tip: string, automatic: string, reset: () => void): HTMLElement;
  select(
    section: HTMLElement,
    name: string,
    items: { value: string; label: string; disabled?: boolean }[],
    current: string,
    onSelect: (selected: string) => void,
    unavailableReason?: string,
  ): void;
};

type State = { readonly value: Settings; setPreferredEdge(edge: number | null): void };

export function renderVideoSettings(
  opts: SettingsPanelOptions,
  state: State,
  change: (next: Settings) => void,
  { group, select }: Fields,
): HTMLElement[] {
  const groups: HTMLElement[] = [];
  if (state.value.video && opts.auto.settings.video && opts.source.video) {
    const video = state.value.video;
    const autoVideo = opts.auto.settings.video;
    const rotate = state.value.transform?.rotate ?? 0;
    const crop = state.value.transform?.crop ?? 'original';
    const rect = state.value.transform?.rect;
    const frameSize = videoFrameSize(opts.source.video, rotate, crop, rect);
    const autoSize = outputSize(
      opts.source.video,
      rotate,
      crop,
      Math.max(autoVideo.width, autoVideo.height),
      rect,
      state.value.fit,
    );
    const codec = group(
      'Video codec',
      'Choose how video is compressed. H.264 suits most players; other codecs can save space but need player support',
      codecLabel(autoVideo.codec),
      () => change({ ...state.value, video: { ...state.value.video!, codec: autoVideo.codec } }),
    );
    select(
      codec,
      'Video codec',
      videoCodecs.map((id) => ({
        value: id,
        label: codecLabel(id),
        disabled: !availableVideoCodecs(state.value.container, opts.caps).includes(id),
      })),
      video.codec,
      (id) =>
        change({ ...state.value, video: { ...state.value.video!, codec: id as VideoCodecId } }),
    );
    groups.push(codec);

    const size = group(
      'Resolution',
      'Choose the output frame dimensions. Lower for fewer pixels and a smaller file; frames are never upscaled',
      `${Math.min(autoSize.width, autoSize.height)}p`,
      () => {
        state.setPreferredEdge(null);
        change({
          ...state.value,
          video: { ...state.value.video!, ...autoSize },
        });
      },
    );
    const sourceEdge = Math.max(frameSize.width, frameSize.height);
    const edges = [...new Set([sourceEdge, ...opts.auto.sizeSteps])]
      .filter((edge) => edge <= sourceEdge)
      .sort((a, b) => b - a);
    select(
      size,
      'Resolution',
      edges.map((edge) => {
        const dims = outputSize(opts.source.video!, rotate, crop, edge, rect, state.value.fit);
        return {
          value: String(edge),
          label: `${Math.min(dims.width, dims.height)}p (${dims.width}x${dims.height})`,
        };
      }),
      String(
        edges.find((edge) => {
          const dims = outputSize(opts.source.video!, rotate, crop, edge, rect, state.value.fit);
          return dims.width === video.width && dims.height === video.height;
        }) ?? sourceEdge,
      ),
      (edge) => {
        state.setPreferredEdge(Number(edge));
        const dims = outputSize(
          opts.source.video!,
          rotate,
          crop,
          Number(edge),
          rect,
          state.value.fit,
        );
        change({ ...state.value, video: { ...state.value.video!, ...dims } });
      },
    );
    groups.push(size);

    const frame = group(
      'Frame rate',
      'Frames per second in the export. Lower for a smaller file and less smooth motion; frame rate is never raised above the source',
      `${formatFps(autoVideo.fps)} fps`,
      () => change({ ...state.value, video: { ...state.value.video!, fps: autoVideo.fps } }),
    );
    const rates = [...new Set([15, 24, 30, autoVideo.fps, opts.source.video.fps])]
      .filter((fps) => fps > 0 && fps <= opts.source.video!.fps)
      .sort((a, b) => a - b);
    select(
      frame,
      'Frame rate',
      rates.map((fps) => ({ value: String(fps), label: `${formatFps(fps)} fps` })),
      String(video.fps),
      (fps) => change({ ...state.value, video: { ...state.value.video!, fps: Number(fps) } }),
    );
    groups.push(frame);

    const seekability = group(
      'Seekability',
      'Set the time between keyframes. Shorter intervals improve seeking but can increase file size',
      'Default',
      () => change({ ...state.value, keyFrameInterval: null }),
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
      String(state.value.keyFrameInterval ?? 'default'),
      (interval) =>
        change({
          ...state.value,
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
    const quality = group(
      'Quality',
      'Video bitrate as a percentage of the automatic bitrate. Lower for a smaller file; raise for more detail, with Target size off',
      '100%',
      () =>
        change({
          ...state.value,
          video: {
            ...state.value.video!,
            bitrate: Math.min(
              targetVideoBitrate(
                state.value.video!.codec,
                state.value.video!.width,
                state.value.video!.height,
                state.value.video!.fps,
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
    slider.setAttribute('aria-valuetext', `${percent}% of auto`);
    slider.addEventListener('input', () => {
      sliderText.textContent = `Quality: ${slider.value}% of auto`;
      slider.setAttribute('aria-valuetext', `${slider.value}% of auto`);
    });
    slider.addEventListener('change', () => {
      const current = state.value.video!;
      const currentBaseline = Math.min(
        targetVideoBitrate(current.codec, current.width, current.height, current.fps),
        opts.source.video!.bitrate ?? Infinity,
      );
      change({
        ...state.value,
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

  return groups;
}

export function renderAudioSettings(
  opts: SettingsPanelOptions,
  state: State,
  change: (next: Settings) => void,
  { group, select }: Fields,
): HTMLElement[] {
  const groups: HTMLElement[] = [];
  if (state.value.audio) {
    const automatic = opts.auto.settings.audio ?? state.value.audio;
    const audio = group(
      'Audio codec',
      'Choose how audio is compressed. AAC suits most MP4 players; WebM requires Opus audio',
      audioLabels[automatic.codec],
      () =>
        change({
          ...state.value,
          audio: {
            ...(state.value.audio ?? automatic),
            codec: automatic.codec,
            copy: automatic.copy,
          },
        }),
    );
    const audioOptions: { value: string; label: string; disabled: boolean }[] = audioCodecs.map(
      (id) => ({
        value: id,
        label: audioLabels[id],
        disabled: !opts.caps.audio[id] || (state.value.container === 'webm' && id !== 'opus'),
      }),
    );
    select(audio, 'Audio codec', audioOptions, state.value.audio.codec, (id) =>
      change({
        ...state.value,
        audio: { ...(state.value.audio ?? automatic), codec: id as AudioCodecId, copy: false },
      }),
    );
    groups.push(audio);
    if (state.value.audio) {
      const bitrate = group(
        'Audio bitrate',
        'Bits per second used for audio. Lower for a smaller file; raise to preserve more sound detail',
        formatBitrate(automatic.bitrate),
        () =>
          change({
            ...state.value,
            audio: { ...state.value.audio!, bitrate: automatic.bitrate, copy: automatic.copy },
          }),
      );
      const max = state.value.mix?.added ? Infinity : (opts.source.audio?.bitrate ?? Infinity);
      const rates = [
        ...new Set([...audioRates.filter((rate) => rate <= max), state.value.audio.bitrate]),
      ].sort((a, b) => a - b);
      select(
        bitrate,
        'Audio bitrate',
        rates.map((rate) => ({ value: String(rate), label: formatBitrate(rate) })),
        String(state.value.audio.bitrate),
        (rate) =>
          change({
            ...state.value,
            audio: { ...state.value.audio!, bitrate: Number(rate), copy: false },
          }),
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
  return groups;
}

export function patchControls(
  controls: HTMLElement,
  opts: SettingsPanelOptions,
  customTarget: boolean,
  next: Settings,
): void {
  const selected = (name: string, selectedValue: string) => {
    const input = controls.querySelector<HTMLSelectElement>(`select[aria-label="${name}"]`);
    if (input && input.value !== selectedValue) input.value = selectedValue;
  };
  selected('Format', next.container);
  selected('Trim precision', next.trimPrecision ?? 'fast');
  selected('Target size', customTarget ? 'custom' : String(next.targetSizeMB ?? 'off'));
  if (next.video && opts.source.video) {
    const video = next.video;
    selected('Keyframe interval', String(next.keyFrameInterval ?? 'default'));
    selected('Video codec', video.codec);
    const frame = videoFrameSize(
      opts.source.video,
      next.transform?.rotate ?? 0,
      next.transform?.crop ?? 'original',
      next.transform?.rect,
    );
    // Options start at the cropped frame's edge; the source edge would clamp to it and match.
    const edges = [Math.max(frame.width, frame.height), ...opts.auto.sizeSteps];
    const edge = edges.find((candidate) => {
      const dims = outputSize(
        opts.source.video!,
        next.transform?.rotate ?? 0,
        next.transform?.crop ?? 'original',
        candidate,
        next.transform?.rect,
        next.fit,
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
      slider.setAttribute('aria-valuetext', `${percent}% of auto`);
    }
    const qualityValue = controls.querySelector('.quality-value');
    if (qualityValue) qualityValue.textContent = `Quality: ${percent}% of auto`;
    const help = controls.querySelector('.quality-setting .setting-help');
    if (help)
      help.textContent = next.targetSizeMB
        ? `Quality is set by the target size · ${formatBitrate(video.bitrate)}`
        : `25% to ${maxPercent}% of auto · ${formatBitrate(video.bitrate)}`;
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
    const bitrate = controls.querySelector<HTMLSelectElement>('select[aria-label="Audio bitrate"]');
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
        (next.passthrough &&
          !input.closest(
            '.metadata-setting, .seek-setting, .target-setting, .audio-processing-setting',
          )) ||
        (!!next.targetSizeMB && !!input.closest('.quality-setting'));
    });
}
