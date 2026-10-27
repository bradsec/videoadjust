import { el, icon } from './dom';

export function mountEditControls(saveCurrentFrame: (jpeg: boolean) => Promise<void>) {
  const section = el('section', 'edit-section');
  section.setAttribute('aria-label', 'Edit');
  const head = el('div', 'section-head');
  head.append(el('h2', undefined, 'Edit'));
  const tools = el('div', 'edit-tools');
  section.append(head, tools);
  // Icon-only so the row fits beside Crop and rotate on a phone; the format is in the icon.
  const frameButtons = (['png', 'jpeg'] as const).map((format) => {
    const name = format === 'png' ? 'PNG' : 'JPEG';
    const button = el('button', 'btn edit-frame');
    button.type = 'button';
    button.setAttribute('aria-label', `Save frame as ${name}`);
    button.title = `Save the current frame as ${name} at output resolution, including all edits`;
    button.append(icon(`i-${format === 'png' ? 'png' : 'jpg'}`));
    button.addEventListener('click', () => {
      void saveCurrentFrame(format === 'jpeg');
    });
    return button;
  });
  const status = el('p', 'note');
  status.setAttribute('role', 'status');
  section.append(status);
  const actions = el('div', 'edit-frame-actions');
  actions.append(...frameButtons);
  head.append(actions);
  return {
    section,
    tools,
    frameButtons,
    status,
    updateFrameButtons(disabled: boolean, saving: boolean) {
      for (const button of frameButtons) {
        button.disabled = disabled;
        // aria-disabled while saving keeps keyboard focus on the button that was pressed.
        button.setAttribute('aria-disabled', String(saving));
      }
    },
  };
}
