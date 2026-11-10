// Shared test helpers. STRICT_PARAMS makes a mistyped parameter id throw.
globalThis.STRICT_PARAMS = true;
export const peak = (x) => { let p = 0; for (const v of x) p = Math.max(p, Math.abs(v)); return p; };
export const rms = (x, from = 0, to = x.length) => { let s = 0; for (let i = from; i < to; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, to - from)); };
export const finite = (x) => x.every((v) => Number.isFinite(v));
export const sine = (hz, rate, n, amp = 0.5) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate));
// Fundamental frequency from the strongest normalised autocorrelation peak.
export function pitchOf(x, rate, from, n, minHz = 30, maxHz = 2000) {
  let best = 0, bestLag = 0;
  for (let lag = Math.floor(rate / maxHz); lag <= Math.ceil(rate / minHz); lag++) {
    let num = 0, a = 0, b = 0;
    for (let i = from; i < from + n; i++) { num += x[i] * x[i + lag]; a += x[i] * x[i]; b += x[i + lag] * x[i + lag]; }
    const r = num / Math.sqrt(a * b + 1e-12);
    if (r > best * 1.02) { best = r; bestLag = lag; }
  }
  // Parabolic refinement.
  const c = (lag) => { let num = 0, a = 0, b = 0; for (let i = from; i < from + n; i++) { num += x[i] * x[i + lag]; a += x[i] * x[i]; b += x[i + lag] * x[i + lag]; } return num / Math.sqrt(a * b + 1e-12); };
  const y0 = c(bestLag - 1), y1 = c(bestLag), y2 = c(bestLag + 1), d = (y0 - y2) / (2 * (y0 - 2 * y1 + y2) || 1);
  return rate / (bestLag + (Math.abs(d) < 1 ? d : 0));
}
let n = 0, t = Date.parse("2026-11-10T00:00:00Z");
export const clock = { id: () => `id-${++n}`, now: () => new Date((t += 1000)).toISOString() };
