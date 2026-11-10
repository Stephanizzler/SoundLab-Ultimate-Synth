// Wavetables for the PPG- and Virus-style machines. Every table is generated
// here from a formula (no samples copied from any instrument), then
// band-limited into one copy per octave so high notes don't alias.
import { TAU } from "./util.ts";

const SIZE = 1024; // samples per cycle
const FRAMES = 32; // waves per table
const LEVELS = 9; // octave copies: up to 512, 256 ... 2 harmonics

export const WAVETABLES = ["Resonant", "Harmonic morph", "Vocal", "Sync sweep", "Pulse width", "Bit crush", "Upper waves", "Organ drawbars", "Bell partials", "Saw build-up", "Formant sweep", "Clav comb", "Metallic", "Digital chaos"] as const;

// One cycle of each table's wave at frame position t (0..1), phase p (0..1).
function shape(bank: number, t: number, p: number): number {
  switch (bank) {
    case 0: return (1 - p) * Math.sin(TAU * (1 + t * 24) * p) * 1.4; // a decaying resonance per cycle
    case 1: {
      const saw = 1 - 2 * p, sq = p < 0.5 ? 1 : -1, tri = 1 - 4 * Math.abs(p - 0.5), sine = Math.sin(TAU * p);
      const x = t * 3, i = Math.min(2, Math.floor(x)), f = x - i, w = [saw, sq, tri, sine];
      return w[i] * (1 - f) + w[i + 1] * f;
    }
    case 2: {
      // Vowels A E I O U as two formants each (Hz), sung at about 150 Hz.
      const V = [[800, 1150], [400, 1600], [300, 2300], [450, 800], [325, 700]];
      const x = t * 4, i = Math.min(3, Math.floor(x)), f = x - i;
      const f1 = V[i][0] * (1 - f) + V[i + 1][0] * f, f2 = V[i][1] * (1 - f) + V[i + 1][1] * f;
      let y = 0;
      for (let h = 1; h <= 60; h++) {
        const hz = h * 150;
        const a = Math.exp(-(((hz - f1) / 120) ** 2)) + 0.6 * Math.exp(-(((hz - f2) / 160) ** 2)) + 0.03 / h;
        y += a * Math.sin(TAU * h * p);
      }
      return y * 0.9;
    }
    case 3: { const r = 1 + t * 7; const q = p * r; return 1 - 2 * (q - Math.floor(q)); }
    case 4: return p < 0.5 - t * 0.47 ? 1 : -1;
    case 5: {
      const steps = Math.round(64 - t * 61);
      const x = 0.6 * Math.sin(TAU * p) + 0.4 * (1 - 2 * p);
      return Math.round(x * steps) / steps;
    }
    case 6: {
      // The classic analog shapes in a row: sine, triangle, square, saw, narrow pulse.
      const W = [Math.sin(TAU * p), 1 - 4 * Math.abs(p - 0.5), p < 0.5 ? 1 : -1, 1 - 2 * p, p < 0.12 ? 1 : -0.14];
      const x = t * 4, i = Math.min(3, Math.floor(x)), f = x - i;
      return W[i] * (1 - f) + W[i + 1] * f;
    }
    case 7: {
      // Drawbar registrations, from flute to full organ.
      const bars = [[0, 8, 0, 0, 0, 0, 0, 0, 0], [8, 8, 8, 0, 0, 0, 0, 0, 0], [8, 8, 8, 8, 0, 0, 0, 0, 0], [8, 6, 8, 8, 4, 0, 4, 0, 0], [8, 8, 8, 8, 8, 8, 8, 8, 8]];
      const H = [0.5, 1, 1.5, 2, 3, 4, 5, 6, 8];
      const x = t * 4, i = Math.min(3, Math.floor(x)), f = x - i;
      let y = 0;
      for (let k = 0; k < 9; k++) { const a = (bars[i][k] * (1 - f) + bars[i + 1][k] * f) / 8; if (H[k] >= 1) y += a * Math.sin(TAU * H[k] * p); else y += a * Math.sin(TAU * p) * 0.5; }
      return y / 3;
    }
    case 8: {
      const partials = [1, 2, 3, 4.2, 5.4, 6.8, 8.9, 11];
      let y = 0;
      partials.forEach((h, k) => { const hh = Math.round(h * (1 + t * 0.6)); y += Math.sin(TAU * hh * p) / (k + 1) ** (1.2 - t * 0.8); });
      return y / 2;
    }
    case 9: { const nH = 1 + Math.floor(t * 40); let y = 0; for (let h = 1; h <= nH; h++) y += Math.sin(TAU * h * p) / h; return y * 0.6; }
    case 10: { let y = 0; const peak = 1 + t * 30; for (let h = 1; h <= 48; h++) y += Math.sin(TAU * h * p) * Math.exp(-(((h - peak) / 2.5) ** 2)) * 1.5 + Math.sin(TAU * h * p) * 0.05 / h; return y; }
    case 11: { const w = 0.05 + t * 0.45; return (p < w ? 1 : -1) - (((p + 0.5) % 1) < w ? 1 : -1) * 0.7; }
    case 12: { let y = 0; for (let h = 1; h <= 40; h++) if ((h * 7 + Math.round(t * 13)) % 5 < 2) y += Math.sin(TAU * h * p + h * t * 3) / Math.sqrt(h); return y * 0.5; }
    default: {
      // Deterministic pseudo-random harmonic mixes, changing frame to frame.
      let y = 0, seed = 1 + Math.floor(t * 31) * 7919;
      for (let h = 1; h <= 24; h++) { seed = (seed * 16807) % 2147483647; y += Math.sin(TAU * h * p) * ((seed / 2147483647) * 2 - 1) / Math.sqrt(h); }
      return y * 0.6;
    }
  }
}

// In-place radix-2 complex FFT; sign -1 forward, +1 inverse (unscaled).
function fft(re: Float64Array, im: Float64Array, sign: number) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (sign * TAU) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

export type Table = Float32Array[][]; // [level][frame] -> one cycle
const cache = new Map<number, Table>();

export function table(bank: number): Table {
  const hit = cache.get(bank);
  if (hit) return hit;
  const out: Table = Array.from({ length: LEVELS }, () => []);
  const re = new Float64Array(SIZE), im = new Float64Array(SIZE), r2 = new Float64Array(SIZE), i2 = new Float64Array(SIZE);
  for (let f = 0; f < FRAMES; f++) {
    for (let i = 0; i < SIZE; i++) { re[i] = shape(bank, f / (FRAMES - 1), i / SIZE); im[i] = 0; }
    fft(re, im, -1);
    re[0] = im[0] = 0; // no DC
    let norm = 0;
    for (let l = 0; l < LEVELS; l++) {
      const maxH = 512 >> l;
      r2.fill(0); i2.fill(0);
      for (let h = 1; h <= maxH && h < SIZE / 2; h++) { r2[h] = re[h]; i2[h] = im[h]; r2[SIZE - h] = re[SIZE - h]; i2[SIZE - h] = im[SIZE - h]; }
      fft(r2, i2, 1);
      const wave = new Float32Array(SIZE + 1);
      if (l === 0) { norm = 0; for (let i = 0; i < SIZE; i++) norm = Math.max(norm, Math.abs(r2[i] / SIZE)); norm = norm || 1; }
      for (let i = 0; i < SIZE; i++) wave[i] = r2[i] / SIZE / norm;
      wave[SIZE] = wave[0]; // guard sample for interpolation
      out[l].push(wave);
    }
  }
  cache.set(bank, out);
  return out;
}

// Reads a table at a frame position (0..1) and phase, choosing the octave
// copy whose harmonics stay under the Nyquist frequency at this pitch.
export function readTable(t: Table, pos: number, phase: number, dt: number) {
  const level = Math.max(0, Math.min(LEVELS - 1, Math.ceil(Math.log2(Math.max(1e-9, 1024 * dt)))));
  const fp = Math.max(0, Math.min(1, pos)) * (FRAMES - 1);
  const fi = Math.min(FRAMES - 2, Math.floor(fp)), ff = fp - fi;
  const x = phase * SIZE, xi = Math.floor(x), xf = x - xi;
  const a = t[level][fi], b = t[level][fi + 1];
  const va = a[xi] + (a[xi + 1] - a[xi]) * xf, vb = b[xi] + (b[xi + 1] - b[xi]) * xf;
  return va + (vb - va) * ff;
}
