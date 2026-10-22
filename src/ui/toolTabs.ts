import type { Tool } from './controller';
import { el, icon } from './dom';

export interface ToolTabsOptions {
  value: Tool;
  /** Why Extract audio is unavailable; null when it can be chosen. */
  disabledReason: string | null;
  gifDisabledReason: string | null;
  onChange(tool: Tool): void;
}

export const TOOL_PANEL_ID = 'tool-panel';

const TOOLS: { tool: Tool; label: string; icon: string }[] = [
  { tool: 'shrink', label: 'Shrink video', icon: 'i-smaller' },
  { tool: 'audio', label: 'Extract audio', icon: 'i-audio' },
  { tool: 'gif', label: 'GIF', icon: 'i-smaller' },
];

export const toolTabId = (tool: Tool) => `tool-tab-${tool}`;

/** WAI-ARIA tabs with automatic activation: arrow keys, Home and End select as they move. */
export function mountToolTabs(
  host: HTMLElement,
  opts: ToolTabsOptions,
): { update(value: Tool, disabledReason: string | null, gifDisabledReason: string | null): void } {
  let value = opts.value;
  let reason = opts.disabledReason;
  let gifReason = opts.gifDisabledReason;
  const list = el('div', 'tools');
  list.setAttribute('role', 'tablist');
  list.setAttribute('aria-label', 'Tool');
  const why = el('p', 'tools-why');
  why.id = 'tool-unavailable';
  const gifWhy = el('p', 'tools-why');
  gifWhy.id = 'gif-unavailable';
  const gifWhyText = el('span');
  gifWhy.append(icon('i-info'), gifWhyText);
  const whyText = el('span');
  why.append(icon('i-info'), whyText);
  const tabs = TOOLS.map(({ tool, label, icon: id }) => {
    const tab = el('button');
    tab.type = 'button';
    tab.id = toolTabId(tool);
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', TOOL_PANEL_ID);
    tab.append(icon(id), label);
    tab.addEventListener('click', () => choose(tool));
    list.append(tab);
    return { tool, tab };
  });
  list.addEventListener('keydown', (e) => {
    const enabled = tabs.filter(({ tool }) => !disabled(tool));
    const at = enabled.findIndex(({ tab }) => tab === document.activeElement);
    if (at < 0) return;
    const next =
      e.key === 'ArrowRight'
        ? enabled[(at + 1) % enabled.length]
        : e.key === 'ArrowLeft'
          ? enabled[(at - 1 + enabled.length) % enabled.length]
          : e.key === 'Home'
            ? enabled[0]
            : e.key === 'End'
              ? enabled[enabled.length - 1]
              : undefined;
    if (!next) return;
    e.preventDefault();
    next.tab.focus();
    choose(next.tool);
  });
  host.replaceChildren(list, why, gifWhy);

  function disabled(tool: Tool): boolean {
    return tool === 'audio' ? reason !== null : tool === 'gif' && gifReason !== null;
  }
  function choose(tool: Tool): void {
    if (tool !== value && !disabled(tool)) opts.onChange(tool);
  }
  function update(next: Tool, nextReason: string | null, nextGifReason: string | null): void {
    value = next;
    reason = nextReason;
    gifReason = nextGifReason;
    for (const { tool, tab } of tabs) {
      const selected = tool === value;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (disabled(tool)) {
        tab.setAttribute('aria-disabled', 'true');
        tab.setAttribute('aria-describedby', tool === 'gif' ? gifWhy.id : why.id);
      } else {
        tab.removeAttribute('aria-disabled');
        tab.removeAttribute('aria-describedby');
      }
    }
    whyText.textContent = reason ?? '';
    why.hidden = reason === null;
    gifWhyText.textContent = gifReason ?? '';
    gifWhy.hidden = gifReason === null;
  }
  update(value, reason, gifReason);
  return { update };
}
