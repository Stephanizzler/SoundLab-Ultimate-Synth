// West Coast: the Buchla Music Easel (208 module, 1973) and its 259/292
// lineage: complex oscillator (principal + modulation oscillator, FM or AM),
// wave shape, timbre (folding) and symmetry, envelope generator (transient,
// sustained or self-cycling), pulser, two low-pass-gate channels.
// The Easel is monophonic; Poly mode is a SoundLab extension.
import { Osc } from "../dsp/osc.ts";
import { LowPassGate, fold } from "../dsp/filters.ts";
import { Voice, indexOf, assignParams, type MachineDef, type ParamDef, type VoiceCtx } from "../engine/machine.ts";
import { sw, pct, opt, time, hzp, bip, semi, VLfo } from "./common.ts";

const PO = "Principal oscillator", MO = "Modulation oscillator", EN = "Envelope", PU = "Pulser", G1 = "Gate 1 (principal)", G2 = "Gate 2 (mod osc)", V = "Voice";
const params: ParamDef[] = [
  semi("tune", "Pitch (fine)", 0, PO, -12, 12), pct("shape", "Wave shape (spike–square–tri–sine)", 1, PO),
  pct("timbre", "Timbre (fold)", 0.35, PO), bip("sym", "Symmetry", 0, PO), pct("timbreEnv", "Envelope → timbre", 0.4, PO), pct("timbrePulser", "Pulser → timbre", 0, PO),
  opt("modWave", "Waveform", ["Sawtooth", "Square", "Triangle"], 2, MO), sw("modKbd", "Keyboard", 1, MO),
  { id: "ratio", name: "Frequency (ratio)", min: 0.25, max: 8, def: 2, curve: "exp", unit: "x", group: MO }, hzp("modHz", "Frequency (keyboard off)", 110, MO, 0.5, 2000),
  opt("modMode", "Modulation", ["FM", "AM"], 0, MO), pct("index", "Index", 0.25, MO), pct("indexEnv", "Envelope → index", 0.4, MO), pct("indexPulser", "Pulser → index", 0, MO),
  opt("envMode", "Mode", ["Transient", "Sustained", "Self-cycling"], 0, EN), time("attack", "Attack", 0.002, EN, 0.001, 4), time("sustain", "Sustain (cycle hold)", 0.05, EN, 0.001, 4), time("decay", "Decay", 0.25, EN, 0.005, 6),
  hzp("pulseRate", "Rate", 2, PU, 0.05, 40), opt("pulseShape", "Shape", ["Pulse", "Ramp", "Triangle"], 0, PU), sw("pulseTrig", "Pulser triggers envelope", 0, PU),
  opt("g1Mode", "Mode", ["Low-pass", "Combo", "Gate (VCA)"], 1, G1), pct("g1Level", "Level", 0.9, G1), time("vactrol", "Vactrol response", 0.25, G1, 0.03, 2),
  opt("g2Mode", "Mode", ["Low-pass", "Combo", "Gate (VCA)"], 1, G2), pct("g2Level", "Level (mod osc out)", 0, G2),
  time("glide", "Portamento", 0.001, V, 0.001, 3), ...assignParams(2, V),
];
const P = indexOf(params);

function shapeWave(o: Osc, j: number) { return j === 0 ? o.pulse(0.06) : j === 1 ? o.pulse(0.5) : j === 2 ? o.tri() : o.sine(); }

class EaselVoice extends Voice {
  car = new Osc(); mod = new Osc(); g1 = new LowPassGate(); g2 = new LowPassGate(); pul = new VLfo(5);
  env = 0; stage = 0; hold = 0; lastPulse = 0; // stage: 0 idle, 1 attack, 2 sustain-hold, 3 decay
  trigger() { this.stage = 1; this.hold = 0; }
  release() { if (this.stage !== 0) this.stage = 3; }
  get active() { return this.stage !== 0 || this.g1.level > 1e-4 || this.g2.level > 1e-4; }
  render(out: Float32Array, n: number, p: Float64Array, ctx: VoiceCtx) {
    const rate = this.rate, mode = Math.round(p[P.envMode]), mw = Math.round(p[P.modWave]), am = p[P.modMode] > 0.5, kbd = p[P.modKbd] > 0.5;
    const ca = 1 - Math.exp(-3 / (p[P.attack] * rate)), cd = Math.exp(-6.9 / (p[P.decay] * rate)), holdN = p[P.sustain] * rate;
    const pshape = ["Square", "Saw up", "Triangle"][Math.round(p[P.pulseShape])], ptrig = p[P.pulseTrig] > 0.5;
    const g1m = Math.round(p[P.g1Mode]), g2m = Math.round(p[P.g2Mode]), sh = p[P.shape], glide = p[P.glide];
    for (let i = 0; i < n; i++) {
      this.glideStep(glide);
      const pv = this.pul.next(p[P.pulseRate], rate, pshape);
      if (ptrig && this.gateOn && pv > 0 && this.lastPulse <= 0) this.stage = 1; // pulser fires the envelope
      this.lastPulse = pv;
      // Envelope: attack, then hold for the sustain time (or while the key is down), then decay.
      if (this.stage === 1) { this.env += (1.2 - this.env) * ca; if (this.env >= 1) { this.env = 1; this.stage = 2; this.hold = 0; } }
      else if (this.stage === 2) { if (++this.hold > holdN && (mode !== 1 || !this.gateOn)) this.stage = 3; }
      else if (this.stage === 3) { this.env *= cd; if (this.env < 1e-3) { this.env = 0; this.stage = mode === 2 && this.gateOn ? 1 : 0; } }
      const e = this.env;
      const base = this.hz(ctx, p[P.tune] + this.wander(3));
      this.mod.step(kbd ? base * p[P.ratio] : p[P.modHz], rate);
      const m = mw === 0 ? this.mod.saw() : mw === 1 ? this.mod.pulse(0.5) : this.mod.tri();
      const idx = (p[P.index] + p[P.indexEnv] * e + p[P.indexPulser] * (pv * 0.5 + 0.5)) * 2;
      this.car.step(am ? base : base * (1 + idx * m), rate);
      // Wave shape: spike → square → triangle → sine, then the timbre folder.
      const x3 = sh * 3, k = Math.min(2, Math.floor(x3)), f = x3 - k;
      let x = shapeWave(this.car, k) * (1 - f) + shapeWave(this.car, k + 1) * f;
      if (am) x *= 1 - Math.min(1, idx * 0.5) * (0.5 - 0.5 * m);
      const amt = Math.min(1, p[P.timbre] + p[P.timbreEnv] * e * (0.5 + 0.5 * this.vel) + p[P.timbrePulser] * (pv * 0.5 + 0.5));
      x = fold(x * 0.9, amt, p[P.sym] * 0.5);
      const level = e * (0.5 + 0.5 * this.vel);
      out[i] += this.g1.process(x * 0.6 * p[P.g1Level], level, rate, p[P.vactrol], g1m) + this.g2.process(m * 0.5 * p[P.g2Level], level, rate, p[P.vactrol], g2m);
    }
  }
}

export const buchla: MachineDef = {
  id: "west-coast", name: "West Coast", inspiredBy: "Buchla Music Easel (1973) and 259 / 292", kind: "poly", voices: 6, level: 0.59,
  about: "No subtractive filter. The complex oscillator's principal wave morphs from spike to square, triangle and sine, then the timbre circuit folds it back on itself (with symmetry); the modulation oscillator (saw, square, triangle, keyboard-tracked or free) frequency- or amplitude-modulates it. An envelope (transient, sustained or self-cycling) and the pulser drive the index, the timbre and two vactrol low-pass gates, whose slow closing gives the plucked, woody sound. Monophonic like the Easel, or polyphonic if you choose.",
  params, glideParam: "glide",
  createVoice: (rate, i) => new EaselVoice(rate, i + 121),
  presets: [
    { name: "Bongo pluck", values: { assign: 0 } },
    { name: "Liquid lead", values: { ratio: 1.5, index: 0.15, indexEnv: 0.2, timbre: 0.6, timbreEnv: 0.2, envMode: 1, decay: 0.8, vactrol: 0.4, attack: 0.02, glide: 0.06 } },
    { name: "Metal rain", values: { ratio: 3.7, index: 0.5, indexEnv: 0.6, timbre: 0.2, sym: 0.4, decay: 0.15, vactrol: 0.6, assign: 0 } },
    { name: "Folded bass", values: { ratio: 0.5, index: 0.1, timbre: 0.5, timbreEnv: 0.5, g1Mode: 1, decay: 0.5 } },
    { name: "Self-cycling drone", values: { envMode: 2, attack: 0.3, sustain: 0.2, decay: 0.6, timbreEnv: 0.7, indexEnv: 0.5, ratio: 1.01, vactrol: 0.8 } },
    { name: "Pulser sequence", values: { pulseTrig: 1, pulseRate: 6, envMode: 1, attack: 0.002, sustain: 0.001, decay: 0.12, timbrePulser: 0.3, vactrol: 0.2 } },
    { name: "AM bells", values: { modMode: 1, ratio: 2.76, index: 0.7, shape: 1, timbre: 0.1, timbreEnv: 0.1, decay: 1.2, vactrol: 0.9, assign: 0 } },
    { name: "Spike buzz", values: { shape: 0, timbre: 0.2, timbreEnv: 0.3, g1Mode: 0, envMode: 1, decay: 0.4 } },
  ],
};
