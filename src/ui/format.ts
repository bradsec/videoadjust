function trimmed(n: number, digits: number): string {
  return String(Number(n.toFixed(digits)));
}

/** Decimal units (kB, MB, GB). */
export function formatBytes(n: number): string {
  if (n < 1000) return `${Math.round(n)} B`;
  if (n < 1e6) return `${trimmed(n / 1e3, 1)} kB`;
  if (n < 1e9) return `${trimmed(n / 1e6, 1)} MB`;
  return `${trimmed(n / 1e9, 2)} GB`;
}

export function formatBitrate(bps: number): string {
  if (bps < 1e6) return `${Math.round(bps / 1e3)} kbps`;
  return `${trimmed(bps / 1e6, 2)} Mbps`;
}

/**
 * m:ss, or h:mm:ss from one hour; a fraction shows one decimal place. With `tenths` the
 * decimal always shows (0:04.0), so a live counter keeps one width as the tenths pass zero.
 */
export function formatDuration(sec: number, opts: { tenths?: boolean } = {}): string {
  const total = Math.max(0, sec);
  const tenths = Math.floor(total * 10 + 1e-9);
  const whole = Math.floor(tenths / 10);
  const frac = tenths % 10;
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = String(whole % 60).padStart(2, '0') + (frac || opts.tenths ? `.${frac}` : '');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
