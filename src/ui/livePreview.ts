import { drawPreparedFrame, preparedFrameMatrix } from '../core/frameExport';
import { paintFit } from '../core/fit';
import { hasCaptions } from '../core/captions';
import { mountCaptionPreview, type CutFadeTarget } from './captionPreview';
import { hasOverlays, renderOverlayLayer, type OverlayAssets } from '../core/overlays';
import {
  createStyleRenderer,
  hasStyleEffects,
  normalizeStyle,
  STYLE_PRESETS,
  type StyleSettings,
} from '../core/style';
import type { Settings } from '../core/types';
import { rotatedSize } from '../core/videoGeometry';
import { el, icon } from './dom';
import { formatDuration } from './format';
import {
  livePreviewGeometry,
  previewFidelity,
  previewFitDisplay,
  previewFitFrame,
  previewRenderSize,
} from './previewGeometry';

export { livePreviewGeometry, previewFidelity, previewRenderSize } from './previewGeometry';

type Size = { width: number; height: number };

const look = (s: PreviewSettings) =>
  JSON.stringify([s.transform, s.fit, s.captions, s.overlays, s.output, s.style, s.fps, s.colors]);

function looksDifferent(a: PreviewSettings, b: PreviewSettings): boolean {
  return a.enabled !== b.enabled || a.assets?.image !== b.assets?.image || look(a) !== look(b);
}

interface PreviewSettings {
  transform: Settings['transform'];
  fit?: Settings['fit'];
  overlays: Settings['overlays'];
  captions?: Settings['captions'];
  cutFade?: CutFadeTarget;
  style: StyleSettings | undefined;
  output: Size;
  /** Output and source frame rates; a lower output rate holds frames to show the stepping. */
  fps?: number | null;
  sourceFps?: number | null;
  colors?: 256 | 128 | 64;
  assets?: OverlayAssets;
  enabled: boolean;
}

export function mountLivePreview(
  video: HTMLVideoElement,
  host: HTMLElement,
  source: Size,
  duration: number,
  onStyleUnavailable: () => void,
): { update(settings: PreviewSettings): void; togglePlayback(): boolean; destroy(): void } {
  const stage = el('div', 'live-preview-stage');
  const frame = el('div', 'live-preview-frame');
  const styleCanvas = el('canvas', 'live-preview-style');
  styleCanvas.setAttribute('aria-hidden', 'true');
  styleCanvas.hidden = true;
  const fitCanvas = el('canvas', 'live-preview-fit');
  fitCanvas.setAttribute('aria-hidden', 'true');
  fitCanvas.hidden = true;
  const paletteCanvas = el('canvas', 'live-preview-palette');
  paletteCanvas.setAttribute('aria-hidden', 'true');
  paletteCanvas.hidden = true;
  const overlay = el('canvas', 'live-preview-overlay');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.hidden = true;
  const styleLabel = el('span', 'live-preview-label');
  styleLabel.setAttribute('aria-hidden', 'true');
  styleLabel.hidden = true;
  frame.append(video, styleCanvas, fitCanvas, overlay, paletteCanvas, styleLabel);
  const captionsView = mountCaptionPreview(video, frame);
  stage.append(frame);
  const bar = el('div', 'live-preview-bar');
  const controls = el('div', 'scrub');
  const play = el('button', 'btn');
  play.type = 'button';
  const range = el('input', 'scrub-range');
  range.type = 'range';
  range.min = '0';
  range.max = String(duration);
  range.step = 'any';
  range.setAttribute('aria-label', 'Preview position');
  const time = el('span', 'num scrub-time');
  controls.append(play, range, time);
  controls.hidden = true;
  const original = el('button', 'btn edit-tool', 'Show original');
  const originalSwitch = el('span', 'live-preview-switch');
  originalSwitch.setAttribute('aria-hidden', 'true');
  original.prepend(originalSwitch);
  original.type = 'button';
  original.setAttribute('aria-label', 'Show original');
  original.title =
    'Show the source without crop, rotation, mirroring or overlays. Changing any of these returns to the edited view';
  original.hidden = true;
  original.setAttribute('aria-pressed', 'false');
  const status = el('p', 'note');
  status.setAttribute('role', 'status');
  status.hidden = true;
  bar.append(controls, original);
  host.classList.add('live-preview');
  host.append(stage, bar, status);
  const phone = matchMedia('(max-width: 699px)');
  const placeOriginal = () => (phone.matches ? frame : bar).append(original);
  phone.addEventListener('change', placeOriginal);
  placeOriginal();
  let settings: PreviewSettings | undefined;
  let showingOriginal = false;
  let active = false;
  let version = 0;
  let destroyed = false;
  let styleRenderer: ReturnType<typeof createStyleRenderer> | undefined;
  const styleSource = document.createElement('canvas');
  const styleContext = styleSource.getContext('2d');
  const fitContext = fitCanvas.getContext('2d');
  const paletteSource = document.createElement('canvas');
  const paletteSourceContext = paletteSource.getContext('2d', { willReadFrequently: true });
  const paletteContext = paletteCanvas.getContext('2d');
  let overlayLayer: OffscreenCanvas | null = null;
  let paletteWorker: Worker | undefined;
  let palettePending = false;
  let paletteVersion = 0;
  let paletteFailed = false;
  let styleFailed = false;
  let frameCallback = 0;
  let animationFrame = 0;
  let animationTime = -1;
  let renderSize: Size = { width: 1, height: 1 };
  // Style effects, GIF colours, or an output smaller or slower than the source render through a canvas.
  let processed = false;
  let reduced = false;
  let lastFrame = -1;

  function queuePalette(rgba: Uint8ClampedArray, width: number, height: number): void {
    if (!paletteWorker) {
      paletteWorker = new Worker(new URL('../core/gifPreviewWorker.ts', import.meta.url), {
        type: 'module',
      });
      paletteWorker.onmessage = (
        event: MessageEvent<{
          rgba: Uint8ClampedArray;
          width: number;
          height: number;
          version: number;
        }>,
      ) => {
        palettePending = false;
        if (destroyed || event.data.version !== paletteVersion) {
          if (!destroyed) drawStyle();
          return;
        }
        const image = paletteContext!.createImageData(event.data.width, event.data.height);
        image.data.set(event.data.rgba);
        paletteContext!.putImageData(image, 0, 0);
        paletteCanvas.hidden = false;
        styleCanvas.hidden = true;
        video.style.opacity = '0';
      };
      paletteWorker.onerror = () => {
        palettePending = false;
        paletteFailed = true;
        stopStyle();
        paletteCanvas.hidden = true;
        video.style.removeProperty('opacity');
        status.textContent = 'GIF colour preview is unavailable.';
        status.hidden = false;
      };
    }
    palettePending = true;
    paletteWorker.postMessage(
      { rgba, width, height, colors: settings!.colors, version: paletteVersion },
      [rgba.buffer],
    );
  }

  function drawStyle(time = video.currentTime): void {
    if (
      !active ||
      !settings ||
      !processed ||
      (styleFailed &&
        (hasStyleEffects(settings.style) ||
          (!settings.colors && (!settings.fit || settings.fit.aspect === 'off')))) ||
      (paletteFailed && !!settings.colors)
    )
      return;
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    if (settings.colors && palettePending) return;
    if (reduced && settings.fps) {
      const index = Math.floor(time * settings.fps + 1e-6);
      if (index === lastFrame) return;
      lastFrame = index;
    }
    try {
      const output = renderSize;
      const fitted = previewFitFrame(source, settings.transform, settings.fit, output);
      const content = fitted?.content ?? output;
      const styled = hasStyleEffects(settings.style) || (!settings.colors && !fitted);
      if (styled) {
        styleRenderer ??= createStyleRenderer(styleCanvas, { preserveDrawingBuffer: false });
        // Upload video directly to WebGL and transform on the GPU. On iPhone/iPad Safari,
        // drawing to a 2D canvas then texImage2D(canvas) cost 14-56 ms per frame versus
        // about 2 ms direct, making styled playback stutter (0.22.13).
        styleRenderer.draw(
          video,
          content.width,
          content.height,
          time,
          normalizeStyle(settings.style),
          settings.output,
          { source, matrix: preparedFrameMatrix(source, content, settings.transform) },
        );
      } else {
        if (!styleContext) throw new Error('Canvas is unavailable for Video Style preview.');
        if (styleSource.width !== content.width) styleSource.width = content.width;
        if (styleSource.height !== content.height) styleSource.height = content.height;
        drawPreparedFrame(styleContext, video, source, content, settings.transform);
      }
      if (fitted) {
        if (!fitContext) throw new Error('Canvas is unavailable for Fit preview.');
        if (fitCanvas.width !== output.width) fitCanvas.width = output.width;
        if (fitCanvas.height !== output.height) fitCanvas.height = output.height;
        paintFit(fitContext, styled ? styleCanvas : styleSource, fitted, settings.fit!);
      }
      if (settings.colors) {
        if (!paletteContext || !paletteSourceContext)
          throw new Error('Canvas is unavailable for GIF preview.');
        if (paletteSource.width !== output.width) paletteSource.width = output.width;
        if (paletteSource.height !== output.height) paletteSource.height = output.height;
        if (paletteCanvas.width !== output.width) paletteCanvas.width = output.width;
        if (paletteCanvas.height !== output.height) paletteCanvas.height = output.height;
        paletteSourceContext.drawImage(
          fitted ? fitCanvas : styled ? styleCanvas : styleSource,
          0,
          0,
        );
        if (overlayLayer)
          paletteSourceContext.drawImage(overlayLayer, 0, 0, output.width, output.height);
        const pixels = paletteSourceContext.getImageData(0, 0, output.width, output.height);
        queuePalette(pixels.data, output.width, output.height);
      } else {
        paletteCanvas.hidden = true;
        styleCanvas.hidden = !!fitted;
        fitCanvas.hidden = !fitted;
        video.style.opacity = '0';
      }
    } catch {
      styleFailed = true;
      stopStyle();
      styleCanvas.hidden = true;
      fitCanvas.hidden = true;
      paletteCanvas.hidden = true;
      video.style.removeProperty('opacity');
      onStyleUnavailable();
    }
  }

  function scheduleStyle(): void {
    if (
      !active ||
      !settings ||
      !processed ||
      (styleFailed &&
        (hasStyleEffects(settings.style) ||
          (!settings.colors && (!settings.fit || settings.fit.aspect === 'off')))) ||
      (paletteFailed && !!settings.colors) ||
      video.paused
    )
      return;
    if (typeof video.requestVideoFrameCallback !== 'function') {
      if (animationFrame) return;
      const tick = () => {
        animationFrame = 0;
        if (video.paused || destroyed || !active || !processed) return;
        if (video.currentTime !== animationTime) {
          animationTime = video.currentTime;
          drawStyle();
        }
        if (!styleFailed && !paletteFailed) animationFrame = requestAnimationFrame(tick);
      };
      animationFrame = requestAnimationFrame(tick);
      return;
    }
    if (frameCallback) return;
    frameCallback = video.requestVideoFrameCallback((_now, metadata) => {
      frameCallback = 0;
      drawStyle(metadata.mediaTime);
      if (!video.paused && !destroyed) scheduleStyle();
    });
  }

  function stopStyle(): void {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    if (frameCallback) video.cancelVideoFrameCallback(frameCallback);
    frameCallback = 0;
  }

  styleCanvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    styleFailed = true;
    stopStyle();
    styleCanvas.hidden = true;
    fitCanvas.hidden = true;
    video.style.removeProperty('opacity');
    onStyleUnavailable();
  });

  function syncPlayback(): void {
    const paused = video.paused;
    play.setAttribute('aria-label', paused ? 'Play' : 'Pause');
    play.replaceChildren(icon(paused ? 'i-play' : 'i-pause'), paused ? 'Play' : 'Pause');
    range.value = String(video.currentTime);
    range.setAttribute('aria-valuetext', formatDuration(video.currentTime, { tenths: true }));
    time.textContent = `${formatDuration(video.currentTime, { tenths: true })} / ${formatDuration(duration, { tenths: true })}`;
  }
  play.addEventListener('click', () => {
    if (!video.paused) video.pause();
    else
      void video.play().catch((error: unknown) => {
        status.textContent = error instanceof Error ? error.message : 'Could not play preview.';
        status.hidden = false;
      });
  });
  range.addEventListener('input', () => {
    video.currentTime = Number(range.value);
  });
  original.addEventListener('click', () => {
    showingOriginal = !showingOriginal;
    refresh();
  });

  async function drawOverlay(): Promise<void> {
    const current = ++version;
    overlay.hidden = true;
    overlayLayer = null;
    if (!settings || !active) return;
    try {
      const layer = await renderOverlayLayer(
        settings.output.width,
        settings.output.height,
        settings.overlays,
        settings.assets,
      );
      if (destroyed || current !== version || !layer) return;
      overlayLayer = layer;
      paletteVersion++;
      lastFrame = -1;
      overlay.width = layer.width;
      overlay.height = layer.height;
      const context = overlay.getContext('2d');
      if (!context) throw new Error('Canvas is unavailable for preview overlays.');
      context.drawImage(layer, 0, 0);
      overlay.hidden = !!settings.colors;
      if (settings.colors) drawStyle();
      status.hidden = true;
    } catch (error) {
      if (destroyed || current !== version) return;
      status.textContent = error instanceof Error ? error.message : 'Could not preview overlays.';
      status.hidden = false;
    }
  }

  function layout(): void {
    if (!settings || (!active && !showingOriginal)) return;
    const container = {
      width: stage.clientWidth,
      height: stage.clientHeight - parseFloat(getComputedStyle(stage).paddingBottom),
    };
    const geometry = livePreviewGeometry(source, settings.transform, container);
    if (!geometry) return;
    const fitted = settings.fit?.aspect !== undefined && settings.fit.aspect !== 'off';
    const display = fitted ? previewFitDisplay(settings.output, container) : geometry;
    frame.style.width = `${display.width}px`;
    frame.style.height = `${display.height}px`;
    frame.style.left = `${display.left}px`;
    frame.style.top = `${display.top}px`;
    const nextSize = previewRenderSize(settings.output, display, window.devicePixelRatio || 1);
    if (nextSize.width !== renderSize.width || nextSize.height !== renderSize.height) {
      renderSize = nextSize;
      paletteVersion++;
      lastFrame = -1;
    }
    video.style.width = `${showingOriginal ? display.width : geometry.videoWidth}px`;
    video.style.height = `${showingOriginal ? display.height : geometry.videoHeight}px`;
    video.style.transform = showingOriginal ? 'none' : geometry.transform;
    styleCanvas.style.width = paletteCanvas.style.width = '100%';
    styleCanvas.style.height = paletteCanvas.style.height = '100%';
    fitCanvas.style.width = fitCanvas.style.height = '100%';
  }

  function refresh(): void {
    if (!settings) return;
    paletteVersion++;
    const geometry = livePreviewGeometry(source, settings.transform, source);
    const shown =
      geometry?.crop ?? rotatedSize(source.width, source.height, settings.transform?.rotate ?? 0);
    const fidelity = previewFidelity(settings, shown);
    reduced = fidelity.reduced;
    lastFrame = -1;
    processed =
      hasStyleEffects(settings.style) ||
      (settings.fit?.aspect !== undefined && settings.fit.aspect !== 'off') ||
      !!settings.colors ||
      (!styleFailed && (fidelity.scaled || fidelity.reduced));
    const edited =
      settings.enabled &&
      (!!settings.transform?.rotate ||
        !!settings.transform?.flip ||
        !!geometry?.crop ||
        (settings.fit?.aspect !== undefined && settings.fit.aspect !== 'off') ||
        processed ||
        hasCaptions(settings.captions) ||
        (!!settings.overlays && hasOverlays(settings.overlays)));
    if (!edited) showingOriginal = false;
    active = edited && !showingOriginal;
    captionsView.update(
      active ? settings.captions : undefined,
      settings.output,
      settings.enabled ? settings.cutFade : undefined,
    );
    original.hidden = !edited;
    original.setAttribute('aria-pressed', String(showingOriginal));
    styleLabel.hidden = !settings.enabled || !hasStyleEffects(settings.style);
    if (!styleLabel.hidden) {
      styleLabel.title = styleLabel.textContent = showingOriginal
        ? 'Original'
        : settings.style?.id === 'none'
          ? 'Colour correction'
          : STYLE_PRESETS.find((preset) => preset.id === settings!.style?.id)!.label;
    }
    // Showing the original does not replace playback controls.
    controls.hidden = !edited;
    video.controls = !edited;
    frame.classList.toggle('is-framed', edited);
    frame.classList.toggle('is-edited', active);
    if (!active || !processed) stopStyle();
    styleCanvas.hidden = true;
    fitCanvas.hidden = true;
    paletteCanvas.hidden = true;
    video.style.removeProperty('opacity');
    if (edited) {
      stage.style.aspectRatio =
        settings.fit?.aspect && settings.fit.aspect !== 'off'
          ? `${settings.output.width} / ${settings.output.height}`
          : `${shown.width} / ${shown.height}`;
      layout();
    } else {
      stage.style.removeProperty('aspect-ratio');
      for (const property of ['width', 'height', 'left', 'top'])
        frame.style.removeProperty(property);
      // Editors own display; leave it untouched when switching between live and original.
      for (const property of ['width', 'height', 'transform']) video.style.removeProperty(property);
      for (const property of ['width', 'height']) styleCanvas.style.removeProperty(property);
      for (const property of ['width', 'height']) paletteCanvas.style.removeProperty(property);
    }
    status.hidden = !(paletteFailed && settings.colors);
    void drawOverlay();
    drawStyle();
    if (active && processed) scheduleStyle();
    syncPlayback();
  }

  const observer = new ResizeObserver(() => {
    // Measure from the document top so scrolling cannot skew the cap, and skip hidden stages
    // (editors hide it) that report zero. Two pixels absorb fractional rounding at the edge.
    const box = stage.getBoundingClientRect();
    if (box.width > 0)
      stage.style.setProperty(
        '--theater-offset',
        `${box.top + window.scrollY + bar.getBoundingClientRect().height + 2}px`,
      );
    layout();
    void drawOverlay();
    drawStyle();
  });
  observer.observe(stage);
  const events = ['play', 'pause', 'ended', 'timeupdate', 'seeked', 'loadedmetadata'] as const;
  for (const event of events) video.addEventListener(event, syncPlayback);
  video.addEventListener('play', scheduleStyle);
  video.addEventListener('pause', stopStyle);
  video.addEventListener('ended', stopStyle);
  video.addEventListener('seeked', () => {
    paletteVersion++;
    lastFrame = -1;
    drawStyle();
  });
  video.addEventListener('loadeddata', () => drawStyle());
  video.addEventListener('timeupdate', () => {
    if (typeof video.requestVideoFrameCallback !== 'function' && video.paused) drawStyle();
  });
  syncPlayback();
  return {
    togglePlayback() {
      if (!active) return false;
      play.click();
      return true;
    },
    update(next) {
      // A change to what the preview shows ends Show original, so the change is visible at once.
      if (showingOriginal && settings && looksDifferent(settings, next)) showingOriginal = false;
      settings = next;
      refresh();
    },
    destroy() {
      destroyed = true;
      captionsView.destroy();
      version++;
      observer.disconnect();
      stopStyle();
      styleRenderer?.destroy();
      paletteWorker?.terminate();
      video.style.removeProperty('opacity');
      video.removeEventListener('play', scheduleStyle);
      video.removeEventListener('pause', stopStyle);
      video.removeEventListener('ended', stopStyle);
      for (const event of events) video.removeEventListener(event, syncPlayback);
      phone.removeEventListener('change', placeOriginal);
    },
  };
}
