import { el, icon } from './dom';
import '../styles/toast.css';

export type ToastTone = 'info' | 'success' | 'error';

const MAX_TOASTS = 3;

/** Reading time for a message, never below 5 s; errors stay until dismissed. */
export function toastDuration(message: string, tone: ToastTone): number | null {
  return tone === 'error' ? null : Math.max(5000, message.length * 60);
}

let region: HTMLElement | undefined;

/**
 * Mount the live region once at startup: screen readers only announce changes to a region that
 * already exists, so creating it per toast would drop the first message.
 */
export function mountToasts(host: HTMLElement = document.body): void {
  if (region?.isConnected) return;
  region = el('div', 'toasts');
  region.setAttribute('aria-live', 'polite');
  region.setAttribute('aria-relevant', 'additions');
  host.append(region);
}

/** Show a transient message over the page without moving layout or taking focus. */
export function toast(message: string, tone: ToastTone = 'info'): void {
  mountToasts();
  const host = region!;
  for (const existing of host.querySelectorAll<HTMLElement>('.toast'))
    if (existing.dataset.message === message) existing.remove();
  const item = el('div', `toast ${tone}`);
  item.dataset.message = message;
  // Errors interrupt; confirmations wait for the screen reader to finish.
  if (tone === 'error') item.setAttribute('role', 'alert');
  const close = el('button', 'toast-close');
  close.type = 'button';
  close.setAttribute('aria-label', 'Dismiss notification');
  close.append(icon('i-close'));
  item.append(
    icon(tone === 'error' ? 'i-stop' : tone === 'success' ? 'i-check' : 'i-info'),
    el('p', undefined, message),
    close,
  );
  host.append(item);
  while (host.children.length > MAX_TOASTS) host.firstElementChild!.remove();

  const duration = toastDuration(message, tone);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let remaining = duration ?? 0;
  let started = 0;
  const dismiss = () => {
    clearTimeout(timer);
    item.remove();
  };
  const run = () => {
    if (duration === null) return;
    started = Date.now();
    timer = setTimeout(dismiss, remaining);
  };
  // Pausing while hovered or focused meets WCAG 2.2.1 Timing Adjustable.
  const pause = () => {
    if (duration === null || timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
    remaining = Math.max(1000, remaining - (Date.now() - started));
  };
  const resume = () => {
    if (timer === undefined && !hovered && !item.matches(':focus-within')) run();
  };
  // Only a mouse hover pauses: iOS keeps :hover after a tap, which would pause forever.
  let hovered = false;
  item.addEventListener('pointerenter', (event) => {
    if (event.pointerType !== 'mouse') return;
    hovered = true;
    pause();
  });
  item.addEventListener('pointerleave', (event) => {
    if (event.pointerType !== 'mouse') return;
    hovered = false;
    resume();
  });
  item.addEventListener('focusin', pause);
  item.addEventListener('focusout', resume);
  close.addEventListener('click', dismiss);
  run();
}
