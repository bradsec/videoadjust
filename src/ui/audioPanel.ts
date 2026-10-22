import {
  AUDIO_BITRATE_STEPS,
  AUDIO_FORMATS,
  audioExtractChangeCount,
  estimateAudioBytes,
  validateAudioExtract,
  type AudioExtractSettings,
  type AudioFormat,
} from '../core/audioExtract';
import type { Capabilities, SourceInfo } from '../core/types';
import { el } from './dom';
import { formatBytes, formatDuration } from './format';
import { formatByteRange, scaleRow } from './progress';

export interface AudioPanelOptions {
  auto: AudioExtractSettings;
  source: SourceInfo;
  caps: Capabilities;
  value: AudioExtractSettings;
  onChange(s: AudioExtractSettings): void;
  onExport(): void;
}

const FORMATS: AudioFormat[] = ['mp3', 'm4a', 'wav'];
/** "M4A (AAC)" -> "M4A" for the heading. */
const shortLabel = (format: AudioFormat) => AUDIO_FORMATS[format].label.split(' ')[0]!;
const kbps = (bps: number) => `${Math.round(bps / 1000)} kbps`;
const channelName = (channels: 1 | 2) => (channels === 1 ? 'mono' : 'stereo');
const wholeSeconds = (sec: number) => formatDuration(Math.round(sec));

/** The Extract audio card: summary, estimate, button and the Adjust controls. */
export function mountAudioPanel(
  host: HTMLElement,
  opts: AudioPanelOptions,
): { update(s: AudioExtractSettings): void; setBusy(busy: boolean): void } {
  const { auto, source, caps } = opts;
  let value = opts.value;
  const card = el('section', 'card export-summary');
  card.setAttribute('aria-label', 'Audio summary');
  const eyebrow = el('span', 'eyebrow', 'Ready to extract');
  const heading = el('h2', 'num');
  const sub = el('p', 'export-sub num');
  const title = el('div');
  title.append(heading, sub);
  const estimate = el('div', 'export-estimate');
  const big = el('strong', 'export-estimate-big num');
  const from = el('span', 'export-from num', `from ${formatBytes(source.sizeBytes)} video`);
  estimate.append(big, from);
  const scale = el('div', 'scale');
  scale.setAttribute('aria-hidden', 'true');
  const original = scaleRow('Original video', 'orig');
  original.value.textContent = formatBytes(source.sizeBytes);
  const output = scaleRow('Audio, estimated', 'new');
  const range = el('span', 'range');
  output.fill.after(range);
  scale.append(original.node, output.node);
  const exportButton = el('button', 'btn btn-primary btn-block', 'Extract audio');
  exportButton.type = 'button';
  exportButton.addEventListener('click', () => {
    if (exportButton.getAttribute('aria-disabled') !== 'true') opts.onExport();
  });

  const details = el('details', 'adjust');
  const disclosure = el('summary');
  const changeCount = el('span', 'adjust-state');
  disclosure.append(document.createTextNode('Adjust'), changeCount);
  const controls = el('div', 'settings-controls');
  details.append(disclosure, controls);

  const change = (next: Partial<AudioExtractSettings>) => opts.onChange({ ...value, ...next });

  function group(
    name: string,
    automatic: string,
    resetTo: string,
    reset: () => void,
  ): { section: HTMLElement; autoTag: HTMLElement; resetButton: HTMLButtonElement } {
    const section = el('div', 'setting');
    const head = el('div', 'setting-head');
    const autoTag = el('span', 'setting-auto', `Auto: ${automatic}`);
    const resetButton = el('button', 'setting-reset', `Reset to ${resetTo}`);
    resetButton.type = 'button';
    resetButton.addEventListener('click', () => {
      reset();
      // The button hides once the value is automatic; keep focus inside this setting.
      section.querySelector<HTMLElement>('[aria-pressed="true"], input:checked')?.focus();
    });
    head.append(el('strong', 'setting-name', name), autoTag, resetButton);
    section.append(head);
    return { section, autoTag, resetButton };
  }
  function segmented(
    label: string,
    items: { value: string; label: string; disabled?: boolean }[],
    onSelect: (selected: string) => void,
  ): { node: HTMLElement; buttons: Map<string, HTMLButtonElement> } {
    const node = el('div', 'seg');
    node.setAttribute('role', 'group');
    node.setAttribute('aria-label', label);
    const buttons = new Map<string, HTMLButtonElement>();
    for (const item of items) {
      const button = el('button', undefined, item.label);
      button.type = 'button';
      button.disabled = !!item.disabled;
      button.addEventListener('click', () => onSelect(item.value));
      node.append(button);
      buttons.set(item.value, button);
    }
    return { node, buttons };
  }

  const autoFormat = AUDIO_FORMATS[auto.format].label;
  const format = group('Format', autoFormat, autoFormat, () =>
    change({ format: auto.format, copy: auto.copy }),
  );
  const choices = el('div', 'choices');
  choices.setAttribute('role', 'radiogroup');
  choices.setAttribute('aria-label', 'Format');
  const radios = new Map<AudioFormat, { label: HTMLLabelElement; input: HTMLInputElement }>();
  const hints = new Map<AudioFormat, HTMLElement>();
  for (const id of FORMATS) {
    const label = el('label', 'choice');
    const input = el('input');
    input.type = 'radio';
    input.name = 'audio-format';
    input.value = id;
    input.disabled = id === 'm4a' && !caps.audio.aac;
    input.addEventListener('change', () => {
      if (input.checked) change({ format: id, copy: id === 'm4a' });
    });
    const hint = el('span', 'hint num');
    if (input.disabled) hint.textContent = 'Unavailable in this browser';
    label.append(input, el('span', 'choice-name', AUDIO_FORMATS[id].label), hint);
    choices.append(label);
    radios.set(id, { label, input });
    hints.set(id, hint);
  }
  format.section.append(choices);

  const bitrate = group('Bitrate', kbps(auto.bitrate), kbps(auto.bitrate), () =>
    change({ bitrate: auto.bitrate, copy: false }),
  );
  const bitrateSeg = segmented(
    'Bitrate in kbps',
    AUDIO_BITRATE_STEPS.map((bps) => ({ value: String(bps), label: String(bps / 1000) })),
    (bps) => change({ bitrate: Number(bps), copy: false }),
  );
  bitrateSeg.node.classList.add('num');
  const bitrateHelp = el('p', 'setting-help');
  bitrate.section.append(bitrateSeg.node, bitrateHelp);

  const monoSource = source.audio?.channels === 1;
  const asSource = (channels: 1 | 2) =>
    source.audio?.channels === channels
      ? `${channels === 1 ? 'Mono' : 'Stereo'}, as source`
      : channels === 1
        ? 'Mono'
        : 'Stereo';
  const channels = group(
    'Channels',
    asSource(auto.channels),
    auto.channels === 1 ? 'Mono' : 'Stereo',
    () => change({ channels: auto.channels }),
  );
  const channelSeg = segmented(
    'Channels',
    [
      { value: '2', label: 'Stereo', disabled: monoSource },
      { value: '1', label: 'Mono' },
    ],
    (n) => change({ channels: Number(n) as 1 | 2 }),
  );
  channels.section.append(channelSeg.node);
  if (monoSource) channels.section.append(el('p', 'setting-reason', 'The original audio is mono.'));

  controls.append(format.section, bitrate.section, channels.section);
  card.append(eyebrow, title, estimate, scale, exportButton, details);
  host.replaceChildren(card);

  function showReset(
    row: { autoTag: HTMLElement; resetButton: HTMLButtonElement; section: HTMLElement },
    changed: boolean,
  ): void {
    row.autoTag.hidden = changed;
    row.resetButton.hidden = !changed;
    row.section.classList.toggle('is-changed', changed);
  }
  function update(next: AudioExtractSettings): void {
    value = next;
    const wav = next.format === 'wav';
    heading.textContent = wav
      ? `WAV · uncompressed ${channelName(next.channels)}`
      : `${shortLabel(next.format)} · ${kbps(next.bitrate)} ${channelName(next.channels)}`;
    const kept = Math.max(0, next.trim.end - next.trim.start);
    sub.textContent = `Audio ${wholeSeconds(kept)} of ${wholeSeconds(source.durationSec)}${next.copy ? ' · no re-encoding' : ''}`;
    const { low, high } = estimateAudioBytes(next, source);
    const text = low === high ? formatBytes(high) : formatByteRange(low, high);
    big.textContent = `est. ${text}`;
    output.value.textContent = text;
    const share = (bytes: number) => Math.min(100, (bytes / Math.max(1, source.sizeBytes)) * 100);
    output.fill.style.width = `${share(low)}%`;
    range.style.left = `${share(low)}%`;
    range.style.width = `${share(high) - share(low)}%`;

    const changes = audioExtractChangeCount(next, auto, source, caps);
    changeCount.textContent = changes
      ? `${changes} ${changes === 1 ? 'change' : 'changes'}`
      : 'All automatic';

    for (const [id, { label, input }] of radios) {
      input.checked = id === next.format;
      label.classList.toggle('is-checked', input.checked);
    }
    if (caps.audio.aac) {
      // Only while M4A would copy: a chosen M4A that re-encodes says nothing.
      const copies =
        (next.format !== 'm4a' || next.copy) &&
        validateAudioExtract({ ...next, format: 'm4a', copy: true }, auto, source, caps).copy;
      hints.get('m4a')!.textContent = copies ? 'Copies the original audio without re-encoding' : '';
    }
    const wavBytes = estimateAudioBytes({ ...next, format: 'wav' }, source).mid;
    hints.get('wav')!.textContent = `Uncompressed, about ${formatBytes(wavBytes)}`;
    for (const hint of hints.values()) hint.hidden = !hint.textContent;
    showReset(format, next.format !== auto.format);

    bitrate.section.hidden = wav;
    for (const [bps, button] of bitrateSeg.buttons)
      button.setAttribute('aria-pressed', String(!next.copy && Number(bps) === next.bitrate));
    bitrateHelp.textContent = next.copy
      ? `Keeps the original ${kbps(next.bitrate)}. Choose a bitrate to re-encode.`
      : 'kbps. Higher keeps more detail and makes a bigger file.';
    showReset(bitrate, !wav && next.bitrate !== auto.bitrate);

    for (const [n, button] of channelSeg.buttons)
      button.setAttribute('aria-pressed', String(Number(n) === next.channels));
    showReset(channels, next.channels !== auto.channels);
  }
  function setBusy(busy: boolean): void {
    if (busy) exportButton.setAttribute('aria-disabled', 'true');
    else exportButton.removeAttribute('aria-disabled');
  }
  update(value);
  return { update, setBusy };
}
