import { el, icon } from './dom';
import { formatDuration } from './format';

export function mountPreviewControls(
  video: HTMLVideoElement,
  status: HTMLElement,
  duration: number,
) {
  const node = el('div', 'scrub');
  const play = el('button', 'btn');
  play.type = 'button';
  const range = el('input', 'scrub-range');
  range.type = 'range';
  range.min = '0';
  range.max = String(duration);
  range.step = 'any';
  range.setAttribute('aria-label', 'Preview position');
  const time = el('span', 'num scrub-time');
  node.append(play, range, time);
  node.hidden = true;
  const sync = () => {
    const paused = video.paused;
    play.setAttribute('aria-label', paused ? 'Play' : 'Pause');
    play.replaceChildren(icon(paused ? 'i-play' : 'i-pause'), paused ? 'Play' : 'Pause');
    range.value = String(video.currentTime);
    range.setAttribute('aria-valuetext', formatDuration(video.currentTime, { tenths: true }));
    time.textContent = `${formatDuration(video.currentTime, { tenths: true })} / ${formatDuration(duration, { tenths: true })}`;
  };
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
  const events = ['play', 'pause', 'ended', 'timeupdate', 'seeked', 'loadedmetadata'] as const;
  for (const event of events) video.addEventListener(event, sync);
  sync();
  return {
    node,
    play,
    sync,
    destroy: () => {
      for (const event of events) video.removeEventListener(event, sync);
    },
  };
}
