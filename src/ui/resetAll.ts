import { el, icon } from './dom';
import { toast } from './toast';

/** One inline confirmation flow shared by the three export summaries. */
export function mountResetAll(host: HTMLElement, onReset?: () => void) {
  const row = el('div', 'setting-head reset-all');
  const count = el('strong', 'adjust-state');
  count.tabIndex = -1;
  const reset = el('button', 'setting-reset', 'Reset all');
  reset.type = 'button';
  reset.prepend(icon('i-reset'));
  const cancel = el('button', 'setting-reset', 'Cancel');
  cancel.type = 'button';
  cancel.hidden = true;
  const status = el('p', 'setting-help reset-all-status');
  status.setAttribute('role', 'status');
  status.tabIndex = -1;
  let confirming = false;

  function close(message: string): void {
    confirming = false;
    document.removeEventListener('keydown', onKey);
    reset.replaceChildren(icon('i-reset'), 'Reset all');
    cancel.hidden = true;
    status.textContent = message;
  }
  function cancelReset(): void {
    close('');
    toast('Reset canceled. Settings unchanged.');
    reset.focus();
  }
  reset.addEventListener('click', () => {
    if (confirming) {
      close('');
      onReset?.();
    } else {
      confirming = true;
      document.addEventListener('keydown', onKey);
      reset.replaceChildren(icon('i-reset'), 'Confirm reset');
      cancel.hidden = false;
      status.textContent =
        'Reset settings for all tools? This cannot be undone. Confirm reset or Cancel.';
      reset.focus();
    }
  });
  cancel.addEventListener('click', cancelReset);
  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape' && confirming) {
      event.preventDefault();
      event.stopPropagation();
      cancelReset();
    }
  }
  row.append(count, reset, cancel);
  const header = el('div');
  header.append(row, status);
  host.prepend(header);

  return {
    destroy(): void {
      document.removeEventListener('keydown', onKey);
    },
    update(changes: number, busy: boolean): void {
      count.textContent = changes
        ? `${changes} ${changes === 1 ? 'change' : 'changes'}`
        : 'All automatic';
      count.classList.toggle('is-changed', changes > 0);
      reset.disabled = !onReset || changes === 0 || busy;
      cancel.disabled = busy;
      if (confirming && (busy || changes === 0)) close('');
    },
  };
}
