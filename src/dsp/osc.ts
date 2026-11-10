// Oscillators. The analog-style ones are band-limited with PolyBLEP, which
// keeps aliasing low at normal pitches without oversampling.
import { blep, Rng, TAU } from "./util.ts";

// One phase that can produce every classic wave at once, so a machine can mix
// saw, pulse and sub (as a Juno's DCO does) from one oscillator.
export class Osc {
  phase = 0;
  dt = 0;
  wrapped = false; // true on the sample the phase passed 1
  wrapFrac = 0; // how far past the wrap, as a fraction of this sample
  sub = 1; // flips every cycle: a square one octave down
  constructor(phase = 0) { this.phase = phase; }
  step(hz: number, rate: number) {
    this.dt = Math.min(0.45, Math.abs(hz) / rate);
    this.phase += this.dt;
    this.wrapped = false;
    if (this.phase >= 1) {
      this.phase -= 1;
      this.wrapped = true;
      this.wrapFrac = this.dt > 0 ? this.phase / this.dt : 0;
      this.sub = -this.sub;
    }
  }
  // Hard sync: restart this oscillator where the master wrapped.
  syncTo(master: Osc) { if (master.wrapped) this.phase = master.wrapFrac * this.dt; }
  saw() { return 2 * this.phase - 1 - blep(this.phase, this.dt); }
  pulse(width: number) {
    const w = width < 0.02 ? 0.02 : width > 0.98 ? 0.98 : width;
    let v = this.phase < w ? 1 : -1;
    v += blep(this.phase, this.dt);
    let t = this.phase - w; if (t < 0) t += 1;
    v -= blep(t, this.dt);
    return v;
  }
  tri() { return 1 - 4 * Math.abs(this.phase - 0.5); }
  sine() { return Math.sin(TAU * this.phase); }
  // The Minimoog's "shark tooth": between triangle and saw.
  shark() { return 0.5 * (this.tri() + this.saw()); }
  subSquare() { return this.sub; }
}

// A stack of detuned saws, like the JP-8000 "supersaw" and the Virus HyperSaw.
// Spread follows a curve that stays subtle for most of its range, then widens.
export class SuperSaw {
  oscs: Osc[];
  constructor(rng: Rng, count = 9) { this.oscs = Array.from({ length: count }, () => new Osc(rng.next())); }
  render(hz: number, rate: number, voices: number, spread: number) {
    const n = Math.max(1, Math.min(this.oscs.length, Math.round(voices)));
    const curve = 0.01 * spread + 0.11 * spread ** 3; // fraction of pitch at the outer saws
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const pos = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
      const o = this.oscs[i];
      o.step(hz * (1 + curve * pos), rate);
      sum += o.saw() * (pos === 0 ? 1 : 0.8);
    }
    return sum / Math.sqrt(n);
  }
}

// White and "pink-ish" noise. The pink filter is Paul Kellet's economy version.
export class Noise {
  rng: Rng; b0 = 0; b1 = 0; b2 = 0;
  constructor(seed = 1) { this.rng = new Rng(seed); }
  white() { return this.rng.bi(); }
  pink() {
    const w = this.rng.bi();
    this.b0 = 0.99765 * this.b0 + w * 0.099046;
    this.b1 = 0.963 * this.b1 + w * 0.2965164;
    this.b2 = 0.57 * this.b2 + w * 1.0526913;
    return (this.b0 + this.b1 + this.b2 + w * 0.1848) * 0.25;
  }
}

// Slow random wander for each voice, the reason analog polys sound alive.
export class Drift {
  v = 0; target = 0; count = 0; rng: Rng;
  constructor(seed: number) { this.rng = new Rng(seed); }
  // Returns a value in about -1..1 that moves over a few hundred milliseconds.
  next(rate: number) {
    if (--this.count <= 0) { this.target = this.rng.bi(); this.count = Math.floor(rate * (0.2 + this.rng.next() * 0.6)); }
    this.v += (this.target - this.v) * (3 / rate);
    return this.v;
  }
}
