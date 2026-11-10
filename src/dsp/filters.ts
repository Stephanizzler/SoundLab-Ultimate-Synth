// Filter models. Each one follows the structure of a well-known synth filter
// circuit, discretised with the topology-preserving transform (TPT, "zero
// delay feedback"), which keeps cutoff and resonance accurate up to high
// frequencies. Nonlinearities sit where the circuits saturate. These are
// models of the circuit's behaviour, not component-level simulations.
import { clamp, tanh, flush } from "./util.ts";

const prewarp = (hz: number, rate: number) => Math.tan((Math.PI * clamp(hz, 8, rate * 0.46)) / rate);

// One TPT one-pole, the building block of the ladders and the Korg 35.
export class OnePole {
  z = 0; G = 0; beta = 0;
  lp(x: number) { const v = (x - this.z) * this.G; const y = v + this.z; this.z = flush(y + v); return y; }
  hp(x: number) { return x - this.lp(x); }
  fb() { return this.beta * this.z; }
  set(hz: number, rate: number) { const g = prewarp(hz, rate); this.G = g / (1 + g); return g; }
  reset() { this.z = 0; }
}

// Four one-poles in a loop with negative feedback: the Moog ladder, the
// CEM3320 and IR3109 (Prophet-5, Jupiter-8, Juno) and, with uneven stages,
// an approximation of the TB-303's diode ladder.
//   style "ladder": saturation at the input of the loop (transistor ladder)
//   style "ota":    gentler saturation in every stage (OTA/IC cascades)
//   style "diode":  uneven stages, stronger and asymmetric drive, a highpass
//                   in the loop that thins the bass as resonance rises
export class Cascade4 {
  s = new Float64Array(4);
  G = new Float64Array(4);
  out = new Float64Array(4); // each stage's output, for 6/12/18/24 dB taps
  hpz = 0; hpG = 0;
  readonly style: "ladder" | "ota" | "diode";
  constructor(style: "ladder" | "ota" | "diode" = "ladder") { this.style = style;}
  set(hz: number, rate: number) {
    const m = this.style === "diode" ? DIODE_STAGES : EVEN_STAGES;
    for (let i = 0; i < 4; i++) { const g = prewarp(hz * m[i], rate); this.G[i] = g / (1 + g); }
    if (this.style === "diode") { const g = prewarp(70, rate); this.hpG = g / (1 + g); }
  }
  // k: 0..4 (4 is where the loop starts to self-oscillate). drive: 0.5..8.
  process(x: number, k: number, drive: number) {
    const G = this.G, s = this.s;
    // The loop's linear response, solved without a unit delay.
    const g0 = G[0], g1 = G[1], g2 = G[2], g3 = G[3];
    const S = g1 * g2 * g3 * (1 - g0) * s[0] + g2 * g3 * (1 - g1) * s[1] + g3 * (1 - g2) * s[2] + (1 - g3) * s[3];
    const gain = g0 * g1 * g2 * g3;
    let y4 = (gain * x + S) / (1 + k * gain);
    if (this.style === "diode") { const v = (y4 - this.hpz) * this.hpG; const lo = v + this.hpz; this.hpz = flush(lo + v); y4 = y4 - lo * 0.6; }
    let u: number;
    if (this.style === "ota") u = x - k * y4;
    else if (this.style === "diode") u = tanh(drive * (x - k * y4) + 0.15) / drive - tanh(0.15) / drive;
    else u = tanh(drive * (x - k * y4)) / drive;
    for (let i = 0; i < 4; i++) {
      const inp = this.style === "ota" ? tanh(u * 0.8 * drive) / (0.8 * drive) : u;
      const v = (inp - s[i]) * G[i];
      const y = v + s[i];
      s[i] = flush(y + v);
      this.out[i] = y;
      u = y;
    }
    return u;
  }
  reset() { this.s.fill(0); this.hpz = 0; }
}
const EVEN_STAGES = [1, 1, 1, 1];
const DIODE_STAGES = [1.9, 1.15, 0.9, 0.75];

// Andrew Simper's (Cytomic) trapezoidal state-variable filter: the Oberheim
// SEM, and the multimode filters of the Nord Lead and Virus. One circuit
// gives lowpass, bandpass, highpass and notch at once.
export class Svf {
  ic1 = 0; ic2 = 0; a1 = 0; a2 = 0; a3 = 0; k = 2;
  lp = 0; bp = 0; hp = 0; notch = 0;
  // res 0..1; at 1 the filter rings almost indefinitely.
  set(hz: number, rate: number, res: number) {
    const g = prewarp(hz, rate);
    this.k = 2 - 1.98 * clamp(res, 0, 1);
    this.a1 = 1 / (1 + g * (g + this.k)); this.a2 = g * this.a1; this.a3 = g * this.a2;
  }
  process(x: number, drive = 1) {
    if (drive !== 1) x = tanh(x * drive) / drive;
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    // A soft limit on the bandpass state: the way the SEM's resonance rounds off.
    this.ic1 = flush(2 * tanh(v1 * 0.5) * 2 - this.ic1);
    this.ic2 = flush(2 * v2 - this.ic2);
    this.lp = v2; this.bp = v1; this.hp = x - this.k * v1 - v2; this.notch = this.lp + this.hp;
    return v2;
  }
  // The SEM's mode knob: lowpass at 0, notch at 0.5, highpass at 1.
  morph(m: number) {
    return m < 0.5 ? this.lp * (1 - 2 * m) + this.notch * 2 * m : this.notch * (2 - 2 * m) + this.hp * (2 * m - 1);
  }
  reset() { this.ic1 = this.ic2 = 0; }
}

// The Korg 35 (MS-10, early MS-20): two one-poles with nonlinear positive
// feedback through a third. Structure after Will Pirkle's TPT derivation.
// K runs 0..2; the filter screams and self-oscillates near 2.
export class Korg35 {
  a = new OnePole(); b = new OnePole(); c = new OnePole(); alpha0 = 1; K = 0;
  readonly type: "lp" | "hp";
  constructor(type: "lp" | "hp") { this.type = type;}
  set(hz: number, rate: number, K: number) {
    const g = this.a.set(hz, rate); const G = this.a.G;
    this.b.G = G; this.c.G = G; this.K = clamp(K, 0.01, 1.98);
    if (this.type === "lp") { this.b.beta = (this.K - this.K * G) / (1 + g); this.c.beta = -1 / (1 + g); }
    else { this.b.beta = (-1 * G) / (1 + g); this.c.beta = 1 / (1 + g); }
    this.alpha0 = 1 / (1 - this.K * G + this.K * G * G);
  }
  process(x: number, sat: number) {
    if (this.type === "lp") {
      const y1 = this.a.lp(x);
      const S = this.c.fb() + this.b.fb();
      const u = tanh(sat * this.alpha0 * (y1 + S)) / sat;
      const y = this.K * this.b.lp(u);
      this.c.hp(y);
      return y / this.K;
    }
    const y1 = this.a.hp(x);
    const S = this.b.fb() + this.c.fb();
    const u = tanh(sat * this.K * (this.alpha0 * y1 + S)) / sat;
    const y = this.b.hp(u);
    this.c.lp(y);
    return y / this.K;
  }
  reset() { this.a.reset(); this.b.reset(); this.c.reset(); }
}

// A Buchla-style low-pass gate: a vactrol (a lamp and a light-dependent
// resistor) opens a filter and an amplifier together. The vactrol responds
// fast to light and slowly in the dark, which gives the "bongo" decay.
export class LowPassGate {
  level = 0; f = new Svf();
  process(x: number, control: number, rate: number, decay: number, mode: number) {
    const up = control > this.level;
    const t = up ? 0.004 : decay * (0.4 + 0.6 * (1 - this.level)); // slower as it closes
    this.level += (control - this.level) * (1 - Math.exp(-1 / (t * rate)));
    const L = this.level;
    // mode 0 = lowpass only, 1 = combo, 2 = amplifier only
    if (mode !== 2) { this.f.set(30 + 18000 * L * L * L, rate, 0.15); x = this.f.process(x); }
    return mode === 0 ? x : x * L;
  }
}

// The Buchla 259's timbre circuit, approximated with a sine fold: as the
// amount rises, the wave folds back on itself and gains bright harmonics.
export function fold(x: number, amount: number, symmetry: number) {
  const g = 1 + amount * 6;
  return Math.sin(1.5707963 * g * (x + symmetry * 0.5)) * (amount < 0.05 ? amount / 0.05 : 1) + x * (amount < 0.05 ? 1 - amount / 0.05 : 0);
}

// A simple biquad, used by the drum voices for their resonant band-passes.
export class Biquad {
  b0 = 1; b1 = 0; b2 = 0; a1 = 0; a2 = 0; z1 = 0; z2 = 0;
  bandpass(hz: number, q: number, rate: number) { this.design(hz, q, rate, "bp"); return this; }
  highpass(hz: number, q: number, rate: number) { this.design(hz, q, rate, "hp"); return this; }
  lowpass(hz: number, q: number, rate: number) { this.design(hz, q, rate, "lp"); return this; }
  design(hz: number, q: number, rate: number, t: "bp" | "hp" | "lp") {
    const w = (2 * Math.PI * clamp(hz, 10, rate * 0.45)) / rate, c = Math.cos(w), al = Math.sin(w) / (2 * q), a0 = 1 + al;
    if (t === "bp") { this.b0 = al / a0; this.b1 = 0; this.b2 = -al / a0; }
    else if (t === "hp") { this.b0 = (1 + c) / 2 / a0; this.b1 = -(1 + c) / a0; this.b2 = this.b0; }
    else { this.b0 = (1 - c) / 2 / a0; this.b1 = (1 - c) / a0; this.b2 = this.b0; }
    this.a1 = (-2 * c) / a0; this.a2 = (1 - al) / a0;
  }
  process(x: number) {
    const y = this.b0 * x + this.z1;
    this.z1 = flush(this.b1 * x - this.a1 * y + this.z2);
    this.z2 = flush(this.b2 * x - this.a2 * y);
    return y;
  }
}
