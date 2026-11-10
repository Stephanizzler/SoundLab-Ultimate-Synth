// Studio Poly: the Sequential Prophet-5 (1978). Rev 3 panel: Poly-Mod,
// LFO, Wheel-Mod, Osc A/B, Mixer, Filter, Amplifier; plus the Rev 4
// velocity and vintage controls. Five voices, with unison.
import { Osc, Noise } from "../dsp/osc.ts";
import { Cascade4 } from "../dsp/filters.ts";
import { Adsr } from "../dsp/env.ts";
import { clamp } from "../dsp/util.ts";
import { Voice, indexOf, assignParams, type MachineDef, type ParamDef, type VoiceCtx } from "../engine/machine.ts";
import { cutoffHz, sw, pct, opt, time, semi, hzp, adsr, VLfo } from "./common.ts";

const PM = "Poly-mod", LF = "LFO", WM = "Wheel-mod", A = "Oscillator A", B = "Oscillator B", MX = "Mixer", F = "Filter", V = "Voice";
const params: ParamDef[] = [
  pct("pmEnv", "Filter env amount", 0, PM), pct("pmOsc", "Osc B amount", 0, PM),
  sw("pmFreqA", "Destination freq A", 1, PM), sw("pmPwA", "Destination PW A", 0, PM), sw("pmFilter", "Destination filter", 0, PM),
  hzp("lfoHz", "LFO frequency", 5, LF, 0.04, 25), sw("lfoSaw", "Sawtooth", 0, LF), sw("lfoTri", "Triangle", 1, LF), sw("lfoSq", "Square", 0, LF),
  pct("wmMix", "Source mix (LFO ↔ noise)", 0, WM), pct("wheel", "Amount (wheel)", 0, WM),
  sw("wmFreqA", "Freq A", 1, WM), sw("wmFreqB", "Freq B", 1, WM), sw("wmPwA", "PW A", 0, WM), sw("wmPwB", "PW B", 0, WM), sw("wmFilter", "Filter", 0, WM),
  semi("aFreq", "Frequency", 0, A, -24, 24, 1), sw("sync", "Sync", 0, A), sw("aSaw", "Sawtooth", 1, A), sw("aPulse", "Pulse", 0, A), pct("aPw", "Pulse width", 0.5, A),
  semi("bFreq", "Frequency", 0, B, -24, 24, 1), { id: "bFine", name: "Fine", min: -100, max: 100, def: 7, unit: "ct", group: B },
  sw("bSaw", "Sawtooth", 1, B), sw("bTri", "Triangle", 0, B), sw("bPulse", "Pulse", 0, B), pct("bPw", "Pulse width", 0.5, B),
  sw("bLo", "Lo freq", 0, B), sw("bKbd", "Keyboard", 1, B),
  pct("mixA", "Osc A", 0.8, MX), pct("mixB", "Osc B", 0.7, MX), pct("noise", "Noise", 0, MX),
  hzp("cutoff", "Cutoff", 1800, F), pct("res", "Resonance", 0.25, F), pct("envAmt", "Envelope amount", 0.45, F),
  opt("kbd", "Keyboard", ["Off", "Half", "Full"], 1, F),
  ...adsr("f", "Filter envelope", 0.003, 0.5, 0.3, 0.4),
  ...adsr("a", "Amplifier envelope", 0.003, 0.5, 0.8, 0.4),
  time("glide", "Glide", 0.001, V, 0.001, 3),
  pct("velF", "Velocity → filter env (Rev 4)", 0, V), pct("velA", "Velocity → amp (Rev 4)", 0, V),
  pct("vintage", "Vintage (Rev 4)", 0.35, V),
  ...assignParams(0, V),
];
const P = indexOf(params);

class P5Voice extends Voice {
  a = new Osc(); b = new Osc(0.5); nz = new Noise(5); f = new Cascade4("ota"); fe = new Adsr(); ae = new Adsr(); lfo = new VLfo(77); bOut = 0;
  trigger() { this.fe.gate(true); this.ae.gate(true); }
  release() { this.fe.gate(false); this.ae.gate(false); }
  get active() { return this.ae.active; }
  render(out: Float32Array, n: number, p: Float64Array, ctx: VoiceCtx) {
    const rate = this.rate, on = (k: number) => p[k] > 0.5;
    const aSaw = on(P.aSaw), aPul = on(P.aPulse), bSaw = on(P.bSaw), bTri = on(P.bTri), bPul = on(P.bPulse), sync = on(P.sync), bLo = on(P.bLo), bKbd = on(P.bKbd);
    const pmEnv = p[P.pmEnv], pmOsc = p[P.pmOsc], pmF = on(P.pmFreqA), pmW = on(P.pmPwA), pmC = on(P.pmFilter);
    const lfoS = on(P.lfoSaw), lfoT = on(P.lfoTri), lfoQ = on(P.lfoSq), lfoN = (lfoS ? 1 : 0) + (lfoT ? 1 : 0) + (lfoQ ? 1 : 0) || 1;
    const wheel = Math.min(1, p[P.wheel] + ctx.wheel), wmMix = p[P.wmMix];
    const k = p[P.res] * 4.05, kbd = Math.round(p[P.kbd]) / 2;
    const velF = 1 - p[P.velF] + p[P.velF] * this.vel, velA = 1 - p[P.velA] + p[P.velA] * this.vel, env = p[P.envAmt] * 6 * velF;
    this.fe.set(p[P.fA], p[P.fD], p[P.fS], p[P.fR]); this.ae.set(p[P.aA], p[P.aD], p[P.aS], p[P.aR]);
    const drift = p[P.vintage] * 12, glide = p[P.glide], cutoff = p[P.cutoff];
    const aSemis = p[P.aFreq], bSemis = p[P.bFreq] + p[P.bFine] / 100 + (bLo ? -84 : 0);
    for (let i = 0; i < n; i++) {
      this.glideStep(glide);
      const d = this.wander(drift);
      this.lfo.advance(p[P.lfoHz], rate);
      const l = ((lfoS ? this.lfo.value("Saw up") : 0) + (lfoT ? this.lfo.value("Triangle") : 0) + (lfoQ ? this.lfo.value("Square") : 0)) / lfoN;
      const wm = ((1 - wmMix) * l + wmMix * this.nz.white()) * wheel;
      const fe = this.fe.next(rate);
      const pm = pmEnv * fe + pmOsc * this.bOut;
      const bPitch = bKbd ? this.hz(ctx, bSemis + d + (on(P.wmFreqB) ? wm * 2 : 0)) : 261.63 * 2 ** ((bSemis + ctx.bend) / 12);
      this.b.step(bPitch, rate);
      const bo = (bSaw ? this.b.saw() : 0) + (bTri ? this.b.tri() : 0) + (bPul ? this.b.pulse(clamp(p[P.bPw] + (on(P.wmPwB) ? wm * 0.4 : 0), 0.03, 0.97)) : 0);
      this.bOut = bo;
      this.a.step(this.hz(ctx, aSemis + d * 0.7 + (pmF ? pm * 48 : 0) + (on(P.wmFreqA) ? wm * 2 : 0)), rate);
      if (sync) this.a.syncTo(this.b);
      const pw = clamp(p[P.aPw] + (pmW ? pm * 0.45 : 0) + (on(P.wmPwA) ? wm * 0.4 : 0), 0.03, 0.97);
      const ao = (aSaw ? this.a.saw() : 0) + (aPul ? this.a.pulse(pw) : 0);
      const x = ao * p[P.mixA] + bo * p[P.mixB] + this.nz.white() * p[P.noise];
      if ((i & 3) === 0) this.f.set(cutoffHz(cutoff, env * fe + kbd * (this.pitch - 60) / 12 + (pmC ? pm * 3 : 0) + (on(P.wmFilter) ? wm * 2 : 0), rate), rate);
      out[i] += this.f.process(x * 0.4, k, 1.3) * this.ae.next(rate) * velA;
    }
  }
}

export const prophet5: MachineDef = {
  id: "studio-poly", name: "Profit-5", inspiredBy: "Sequential Prophet-5 (1978)", kind: "poly", voices: 5, level: 0.96,
  about: "Five voices of two oscillators (A: saw and pulse with sync; B: saw, triangle and pulse, with Lo-freq and keyboard-off for use as a modulator), a mixer with noise and the CEM-style 4-pole filter. Poly-Mod sends the filter envelope and oscillator B to freq A, pulse width A and the filter; Wheel-Mod sends the LFO (saw, triangle, square, combinable) or noise to the oscillators and filter. Unison stacks all five voices.",
  params, glideParam: "glide",
  createVoice: (rate, i) => new P5Voice(rate, i + 11),
  presets: [
    { name: "Warm poly", values: {} },
    { name: "Sync sweep", values: { sync: 1, aFreq: 12, pmEnv: 0.35, pmFreqA: 1, envAmt: 0.3, cutoff: 3000, fD: 0.8, fS: 0.2 } },
    { name: "Bell poly-mod", values: { aSaw: 0, aPulse: 1, aPw: 0.5, bSaw: 0, bTri: 1, pmOsc: 0.08, mixA: 0.8, mixB: 0, bFreq: 19, cutoff: 2600, envAmt: 0.25, fD: 1.2, fS: 0, aD: 1.8, aS: 0, aR: 1.4 } },
    { name: "Soft pad", values: { cutoff: 900, res: 0.15, envAmt: 0.3, fA: 0.8, fD: 2, aA: 0.6, aR: 1.5, vintage: 0.5 } },
    { name: "Brass", values: { aSaw: 1, bSaw: 1, bFine: 9, cutoff: 600, res: 0.1, envAmt: 0.55, fA: 0.08, fD: 0.6, fS: 0.55, aA: 0.04, aS: 0.9 } },
    { name: "Unison lead", values: { assign: 1, uniDetune: 14, cutoff: 2200, res: 0.3, envAmt: 0.3, fS: 0.6, glide: 0.06, aS: 1 } },
    { name: "Clav", values: { aSaw: 0, aPulse: 1, aPw: 0.18, bSaw: 0, bPulse: 1, bPw: 0.3, bFreq: 12, cutoff: 1500, res: 0.35, envAmt: 0.5, fD: 0.25, fS: 0, aD: 0.5, aS: 0, aR: 0.15, velF: 0.6 } },
    { name: "Wheel vibrato strings", values: { aSaw: 1, bSaw: 1, bFine: 12, lfoHz: 5.5, wheel: 0.08, wmFreqA: 1, wmFreqB: 1, cutoff: 2500, envAmt: 0.1, aA: 0.35, aR: 1.2 } },
  ],
};
