const NICE_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];

export function pickTickStep(
  durationSec: number,
  trackWidthPx: number,
  minLabelSpacingPx = 80,
): { major: number; minor: number | null } {
  const needed =
    durationSec > 0 && trackWidthPx > 0 ? (durationSec * minLabelSpacingPx) / trackWidthPx : 0;
  const major = NICE_STEPS.find((step) => step >= needed) ?? Math.ceil(needed / 3600) * 3600;
  const minor =
    [5, 4, 2]
      .map((parts) => major / parts)
      .find((step) => (step / durationSec) * trackWidthPx >= 8) ?? null;
  return { major, minor };
}

export function formatTimelineLabel(
  sec: number,
  durationSec: number,
  tenths = sec % 1 !== 0,
): string {
  const ticks = Math.floor(Math.max(0, sec) * 10 + 1e-8);
  const whole = Math.floor(ticks / 10);
  const seconds = String(whole % 60).padStart(2, '0') + (tenths ? `.${ticks % 10}` : '');
  const minutes = Math.floor(whole / 60) % 60;
  return durationSec >= 3600
    ? `${Math.floor(whole / 3600)}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${Math.floor(whole / 60)}:${seconds}`;
}

export function parseTimecode(text: string): number | null {
  if (!/^\d+(?::[0-5]\d){0,2}(?:\.\d)?$/.test(text)) return null;
  const parts = text.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return null;
  return parts.reduce((total, part) => total * 60 + part, 0);
}
