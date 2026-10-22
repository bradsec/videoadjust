import { el, icon } from './dom';
import { formatBytes, formatDuration } from './format';

export interface ProgressOptions {
  onCancel(): void;
  /** Source size, the full width of the "Original" bar. */
  originalBytes?: number;
  /** Estimated output size range. */
  expected?: { low: number; high: number };
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

export function scaleRow(
  label: string,
  kind: 'orig' | 'new',
): { node: HTMLElement; value: HTMLElement; fill: HTMLElement } {
  const node = el('div', 'scale-row');
  const head = el('div', 'scale-label');
  const value = el('b', 'num');
  head.append(el('span', undefined, label), value);
  const track = el('div', 'track');
  const fill = el('span', kind);
  track.append(fill);
  node.append(head, track);
  return { node, value, fill };
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
  facts.append(elapsed.node, remaining.node, written.node);
  if (opts.expected) {
    const expected = fact('Expected');
    expected.value.textContent = formatByteRange(opts.expected.low, opts.expected.high);
    facts.append(expected.node);
  }

  const scale = el('div', 'scale');
  scale.setAttribute('aria-hidden', 'true');
  const orig = scaleRow('Original', 'orig');
  const now = scaleRow('New, so far', 'new');
  if (opts.originalBytes) {
    orig.value.textContent = formatBytes(opts.originalBytes);
    scale.append(orig.node, now.node);
  }

  const cancel = el('button', 'btn btn-block');
  cancel.type = 'button';
  cancel.append(icon('i-stop'), 'Cancel export');
  cancel.addEventListener('click', () => {
    cancel.disabled = true;
    cancel.replaceChildren(icon('i-stop'), 'Canceling');
    opts.onCancel();
  });

  card.append(pct, track, facts);
  if (opts.originalBytes) card.append(scale);
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
    written.value.textContent = formatBytes(bytes);
    now.value.textContent = formatBytes(bytes);
    if (opts.originalBytes)
      now.fill.style.width = `${Math.min(100, (bytes / opts.originalBytes) * 100)}%`;
  }

  update(0, 0, 0);
  return { update };
}
