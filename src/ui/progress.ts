import { el, icon } from './dom';
import { formatBytes, formatDuration } from './format';

export interface ProgressOptions {
  onCancel(): void;
  /** Source size, the full width of the "Original" bar. */
  originalBytes?: number;
  /** Estimated output size range. */
  expected?: { low: number; high: number };
  showBytes?: boolean;
  /** False when the output is written only at the end, so a running count would stay near 0. */
  liveBytes?: boolean;
}

// Below this much progress a remaining-time guess swings too much to show.
const MIN_PROGRESS_FOR_ESTIMATE = 0.03;

/** "18-24 MB"; the unit is written once when both ends share it. */
export function formatByteRange(low: number, high: number): string {
  const a = formatBytes(low);
  const b = formatBytes(high);
  const unit = b.slice(b.lastIndexOf(' '));
  return a.endsWith(unit) ? `${a.slice(0, -unit.length)}-${b}` : `${a}-${b}`;
}

const clock = (ms: number) => formatDuration(Math.round(ms / 1000));

function fact(label: string): { node: HTMLElement; value: HTMLElement } {
  const node = el('div');
  const value = el('dd', 'num');
  node.append(el('dt', undefined, label), value);
  return { node, value };
}

export interface SizeMeter {
  node: HTMLElement;
  newValue: HTMLElement;
  origValue: HTMLElement;
  /** Fills the new size, low to high, against the original as the whole track. */
  show(low: number, high: number, original: number): void;
}

/** One meter: the hatched track is the original file, the filled part the new size. */
export function sizeMeter(newLabel: string, origLabel: string): SizeMeter {
  const node = el('div', 'meter');
  // The same numbers are printed as text elsewhere on each screen.
  node.setAttribute('aria-hidden', 'true');
  const labels = el('div', 'meter-labels');
  const newValue = el('b', 'num');
  const origValue = el('b', 'num');
  const newText = el('span', 'm-new', newLabel);
  newText.append(newValue);
  const origText = el('span', 'm-orig', origLabel);
  origText.append(origValue);
  labels.append(newText, origText);
  const track = el('div', 'meter-track');
  const fill = el('span', 'fill');
  const range = el('span', 'range');
  track.append(fill, range);
  node.append(labels, track);
  function show(low: number, high: number, original: number): void {
    const share = (bytes: number) => Math.min(100, (bytes / Math.max(1, original)) * 100);
    fill.style.width = `${share(low)}%`;
    range.style.left = `${share(low)}%`;
    range.style.width = `${Math.max(0, share(high) - share(low))}%`;
    range.hidden = high <= low;
  }
  return { node, newValue, origValue, show };
}

/** Progress card: percent, bar, elapsed, remaining, bytes written and Cancel. */
export function mountProgress(
  host: HTMLElement,
  opts: ProgressOptions,
): { update(p: number, bytes: number, elapsedMs: number): void } {
  const card = el('section', 'card progress-card');
  card.setAttribute('aria-label', 'Export progress');
  const pct = el('div', 'pct num');
  const track = el('div', 'bar-track');
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-label', 'Export progress');
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', '100');
  const fill = el('div', 'bar-fill');
  track.append(fill);

  const facts = el('dl', 'facts');
  const elapsed = fact('Elapsed');
  const remaining = fact('Remaining');
  const written = fact('Written so far');
  facts.append(elapsed.node, remaining.node);
  if (opts.showBytes !== false) facts.append(written.node);
  if (opts.expected) {
    const expected = fact('Expected');
    expected.value.textContent = formatByteRange(opts.expected.low, opts.expected.high);
    facts.append(expected.node);
  }

  const meter = sizeMeter('New, so far', 'Original');
  if (opts.originalBytes) meter.origValue.textContent = formatBytes(opts.originalBytes);

  const cancel = el('button', 'btn btn-block btn-cancel');
  cancel.type = 'button';
  cancel.append(icon('i-stop'), 'Cancel export');
  cancel.addEventListener('click', () => {
    cancel.disabled = true;
    cancel.replaceChildren(icon('i-stop'), 'Canceling');
    opts.onCancel();
  });

  card.append(pct, track, facts);
  if (opts.originalBytes) card.append(meter.node);
  card.append(cancel);
  host.replaceChildren(card);

  function update(p: number, bytes: number, elapsedMs: number): void {
    const percent = Math.floor(Math.min(1, Math.max(0, p)) * 100);
    pct.replaceChildren(String(percent), el('small', undefined, '%'));
    fill.style.width = `${percent}%`;
    track.setAttribute('aria-valuenow', String(percent));
    elapsed.value.textContent = clock(elapsedMs);
    remaining.value.textContent =
      p >= MIN_PROGRESS_FOR_ESTIMATE && p < 1
        ? `about ${clock((elapsedMs * (1 - p)) / p)}`
        : p >= 1
          ? 'Finishing'
          : 'Estimating';
    if (opts.liveBytes === false) {
      written.value.textContent = 'Calculating…';
      meter.newValue.textContent = 'Calculating…';
      if (opts.originalBytes && opts.expected)
        meter.show(opts.expected.low, opts.expected.high, opts.originalBytes);
      return;
    }
    written.value.textContent = formatBytes(bytes);
    meter.newValue.textContent = formatBytes(bytes);
    if (opts.originalBytes) meter.show(bytes, bytes, opts.originalBytes);
  }

  update(0, 0, 0);
  return { update };
}
