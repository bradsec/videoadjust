import { CanvasSink, type Input } from 'mediabunny';

/** Draws only the newest requested media time, so slow software decoding skips picture frames. */
export function createDecodedPreview(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  stage: HTMLElement,
  source: { width: number; height: number },
  onFrame: () => void,
  onStart: () => void,
) {
  let sink: CanvasSink | undefined;
  let active = false;
  let ready = false;
  let busy = false;
  let version = 0;
  let frame = 0;
  let destroyed = false;
  let onReady = () => {};
  const context = canvas.getContext('2d');

  async function draw(): Promise<void> {
    if (!active || busy || !sink || destroyed) return;
    busy = true;
    const current = version;
    try {
      const result = await sink.getCanvas(video.currentTime);
      if (current !== version || destroyed || !result || !context) return;
      context.drawImage(result.canvas, 0, 0);
      ready = true;
      canvas.hidden = false;
      video.style.opacity = '0';
      onFrame();
      onReady();
    } catch (error) {
      if (current === version) console.warn('Could not render the decoded preview picture.', error);
    } finally {
      busy = false;
      if (active && (!video.paused || current !== version) && !destroyed)
        frame = requestAnimationFrame(() => void draw());
    }
  }

  const seek = () => {
    version++;
    void draw();
  };
  const play = () => void draw();
  video.addEventListener('play', play);
  video.addEventListener('seeked', seek);
  return {
    get active() {
      return active;
    },
    get ready() {
      return ready;
    },
    async start(input: Input, callback: () => void): Promise<void> {
      if (active) return;
      active = true;
      onReady = callback;
      onStart();
      const track = await input.getPrimaryVideoTrack();
      if (!track || destroyed) return;
      const width = Math.max(
        1,
        Math.min(source.width, 1280, Math.ceil(stage.clientWidth * (devicePixelRatio || 1))),
      );
      sink = new CanvasSink(track, { width });
      canvas.width = width;
      canvas.height = Math.max(1, Math.round((width * source.height) / source.width));
      void draw();
    },
    destroy(): void {
      destroyed = true;
      active = false;
      version++;
      cancelAnimationFrame(frame);
      video.removeEventListener('play', play);
      video.removeEventListener('seeked', seek);
    },
  };
}
