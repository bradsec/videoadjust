import { decodeOverlayImage, normalizeOverlays } from '../core/overlays';
import { validateSettings } from './controllerSettings';
import type { AppState } from './controllerTypes';

export function createOverlayLoader(getState: () => AppState, setState: (next: AppState) => void) {
  let imageToken = 0;

  function cancel(): void {
    imageToken++;
  }

  async function loadOverlayImage(file: File): Promise<void> {
    let state = getState();
    if (state.kind !== 'prepare') return;
    const input = state.input;
    const token = ++imageToken;
    try {
      const image = await decodeOverlayImage(
        file,
        Math.max(
          state.source.video?.displayWidth ?? 1920,
          state.source.video?.displayHeight ?? 1080,
        ),
      );
      state = getState();
      if (
        token !== imageToken ||
        state.kind !== 'prepare' ||
        state.input !== input ||
        state.exporting
      ) {
        image.close();
        return;
      }
      const overlays = normalizeOverlays(state.settings.overlays);
      overlays.image.enabled = true;
      setState({
        ...state,
        overlayAssets: { image },
        settings: validateSettings(
          { ...state.settings, overlays },
          state.auto,
          state.caps,
          state.source,
        ),
        notice: undefined,
      });
    } catch (error) {
      state = getState();
      if (token !== imageToken || state.kind !== 'prepare' || state.input !== input) return;
      setState({
        ...state,
        notice: {
          tone: 'error',
          title: 'Image could not be loaded',
          message:
            error instanceof Error ? error.message : 'Choose a PNG, JPEG, WebP or SVG image.',
        },
      });
    }
  }

  return { loadOverlayImage, cancel };
}
