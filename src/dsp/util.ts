// Small shared helpers for the DSP code. Everything here is plain maths with
// no allocation in the audio path, so it runs the same in an AudioWorklet,
// a Worker and the Node tests.

export const TAU = Math.PI * 2;
export const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
export const mtof = (note: number) => 440 * 2 ** ((note - 69) / 12);
export const dbToGain = (db: number) => 10 ** (db / 20);
export const gainToDb = (g: number) => (g > 0 ? 20 * Math.log10(g) : -Infinity);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// A rational tanh: accurate to about 2% and smooth, much cheaper than Math.tanh.
export function tanh(x: number) {
  if (x > 3) return 1;
  if (x < -3) return -1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}
// Asymmetric soft clip, for circuits whose transistors clip one side first.
export const asym = (x: number, bias: number) => tanh(x + bias) - tanh(bias);

// Deterministic random numbers (xorshift32) so renders and tests repeat exactly.
export class Rng {
  s: number;
  constructor(seed = 0x9e3779b9) { this.s = seed >>> 0 || 1; }
  next() { let x = this.s; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.s = x >>> 0; return this.s / 4294967296; }
  bi() { return this.next() * 2 - 1; }
}

// PolyBLEP: removes most of the aliasing a naive saw or square makes at a jump.
// t is the phase (0..1) just after the jump point, dt the phase step per sample.
export function blep(t: number, dt: number) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

// One-pole smoothing towards a target, for parameters that would otherwise zip.
export const smoothCoef = (seconds: number, rate: number) => (seconds <= 0 ? 1 : 1 - Math.exp(-1 / (seconds * rate)));

// Flushes tiny values to zero so filters and reverbs never run on denormals.
export const flush = (x: number) => (x > 1e-20 || x < -1e-20 ? x : 0);
