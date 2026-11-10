// Envelopes and LFOs.
import { Rng, TAU } from "./util.ts";

// An analog-style ADSR: the attack charges towards a target above 1 (so it
// ends almost straight, like a capacitor charging towards a higher voltage),
// decay and release fall exponentially. Times are in seconds, to about -60 dB.
export class Adsr {
  v = 0;
  stage: 0 | 1 | 2 | 3 | 4 = 0; // idle, attack, decay, sustain, release
  a = 0.01; d = 0.2; s = 0.7; r = 0.3;
  set(a: number, d: number, s: number, r: number) { this.a = a; this.d = d; this.s = s; this.r = r; }
  gate(on: boolean, retrigger = true) {
    if (on) { if (retrigger || this.stage === 0 || this.stage === 4) this.stage = 1; }
    else if (this.stage !== 0) this.stage = 4;
  }
  next(rate: number) {
    switch (this.stage) {
      case 1: {
        const c = 1 - Math.exp(-1.1 / Math.max(1e-4, this.a * rate));
        this.v += (1.3 - this.v) * c;
        if (this.v >= 1) { this.v = 1; this.stage = 2; }
        break;
      }
      case 2: {
        this.v += (this.s - this.v) * (1 - Math.exp(-6.9 / Math.max(1e-4, this.d * rate)));
        if (Math.abs(this.v - this.s) < 1e-4) { this.v = this.s; this.stage = 3; }
        break;
      }
      case 3: this.v = this.s; break;
      case 4: {
        this.v *= Math.exp(-6.9 / Math.max(1e-4, this.r * rate));
        if (this.v < 1e-4) { this.v = 0; this.stage = 0; }
        break;
      }
    }
    return this.v;
  }
  get active() { return this.stage !== 0; }
  reset() { this.v = 0; this.stage = 0; }
}

// A one-shot attack/decay, for drums and the 303's filter envelope.
export class Decay {
  v = 0; c = 0;
  trigger(level = 1) { this.v = level; }
  set(seconds: number, rate: number) { this.c = Math.exp(-6.9 / Math.max(1e-4, seconds * rate)); }
  next() { const v = this.v; this.v *= this.c; if (this.v < 1e-6) this.v = 0; return v; }
}

export const LFO_SHAPES = ["Sine", "Triangle", "Saw up", "Saw down", "Square", "Sample & hold", "Smooth random"] as const;

// An LFO whose phase can follow the transport, so synced LFOs line up with the bar.
export class Lfo {
  phase = 0; held = 0; prev = 0; rng: Rng;
  constructor(seed = 7) { this.rng = new Rng(seed); }
  // Advances by `cycles` and returns a value in -1..1.
  advance(cycles: number, shape: number) {
    const before = this.phase;
    this.phase += cycles;
    if (this.phase >= 1 || this.phase < before) {
      this.phase -= Math.floor(this.phase);
      this.prev = this.held; this.held = this.rng.bi();
    }
    return this.value(shape);
  }
  setPhase(p: number, shape: number) {
    const f = p - Math.floor(p);
    if (f < this.phase) { this.prev = this.held; this.held = this.rng.bi(); }
    this.phase = f;
    return this.value(shape);
  }
  value(shape: number) {
    const p = this.phase;
    switch (shape) {
      case 0: return Math.sin(TAU * p);
      case 1: return 1 - 4 * Math.abs(p - 0.5);
      case 2: return 2 * p - 1;
      case 3: return 1 - 2 * p;
      case 4: return p < 0.5 ? 1 : -1;
      case 5: return this.held;
      default: { const t = 0.5 - 0.5 * Math.cos(Math.PI * p); return this.prev + (this.held - this.prev) * t; }
    }
  }
}
