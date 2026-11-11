// Multimode Poly: the Oberheim OB-Xa (1980), with the SEM's mode control on
// its 2-pole filter. Control, Modulation, Oscillators, Filter, envelopes.
// Eight voices with per-voice pan, unison and polyphonic portamento.
import { Osc, Noise } from "../dsp/osc.ts";
import { Svf, Cascade4 } from "../dsp/filters.ts";
import { Adsr } from "../dsp/env.ts";
import { clamp } from "../dsp/util.ts";
import { Voice, indexOf, assignParams, type MachineDef, type ParamDef, type VoiceCtx } from "../engine/machine.ts";
import { cutoffHz, sw, pct, opt, adsr, hzp, time, semi, VLfo } from "./common.ts";

const C = "Control", M = "Modulation", O = "Oscillators", F = "Filter";
const params: ParamDef[] = [
  time("glide", "Portamento", 0.001, C, 0.001, 3), ...assignParams(0, C),
  hzp("lfoRate", "Rate", 5.5, M, 0.1, 25), opt("lfoWave", "Waveform", ["Sine", "Square", "Random (S&H)"], 0, M),
  pct("lfoFreq", "LFO → frequency", 0, M), sw("lfoO1", "Osc 1", 1, M), sw("lfoO2", "Osc 2", 1, M),
  pct("lfoPw", "LFO → pulse width", 0, M), pct("lfoF", "LFO → filter", 0, M),
  pct("envO2", "Filter env → osc 2", 0, M),
  semi("f1", "Osc 1 frequency", 0, O, -24, 24, 1), sw("saw1", "Osc 1 saw", 1, O), sw("pul1", "Osc 1 pulse", 0, O),
  semi("f2", "Osc 2 frequency", 0, O, -24, 24, 1), { id: "detune", name: "Osc 2 detune", min: -50, max: 50, def: 10, unit: "ct", group: O },
  sw("saw2", "Osc 2 saw", 1, O), sw("pul2", "Osc 2 pulse", 0, O),
  pct("pw", "Pulse width", 0.5, O), sw("sync", "Sync", 0, O), pct("xmod", "Cross mod (2 → 1)", 0, O), pct("noise", "Noise", 0, O),
  hzp("cutoff", "Frequency", 1600, F), pct("res", "Resonance", 0.3, F), pct("envAmt", "Modulation (env)", 0.5, F), pct("kbd", "Keyboard track", 0.5, F),
  opt("poles", "Filter", ["2-pole (12 dB)", "4-pole (24 dB)"], 0, F),
  pct("mode", "SEM mode (LP–notch–HP)", 0, F), sw("bp", "SEM band-pass", 0, F),
  ...adsr("f", "Filter envelope", 0.02, 0.6, 0.4, 0.4),
  ...adsr("a", "Volume envelope", 0.01, 0.6, 0.85, 0.4),
  pct("drift", "Voice detune (drift)", 0.5, "Character"),
];
const P = indexOf(params);

class ObVoice extends Voice {
  a = new Osc(); b = new Osc(0.7); nz = new Noise(8); f = new Svf(); f4 = new Cascade4("ota"); fe = new Adsr(); ae = new Adsr(); lfo = new VLfo(91); bOut = 0;
  trigger() { this.fe.gate(true); this.ae.gate(true); }
  release() { this.fe.gate(false); this.ae.gate(false); }
  get active() { return this.ae.active; }
  render(out: Float32Array, n: number, p: Float64Array, ctx: VoiceCtx) {
    const rate = this.rate, on = (k: number) => p[k] > 0.5;
    const s1 = p[P.f1], s2 = p[P.f2] + p[P.detune] / 100, sync = on(P.sync), xm = p[P.xmod] * 2.5;
    const res = p[P.res], env = p[P.envAmt] * 6, mode = p[P.mode], bp = on(P.bp), four = on(P.poles);
    this.fe.set(p[P.fA], p[P.fD], p[P.fS], p[P.fR]); this.ae.set(p[P.aA], p[P.aD], p[P.aS], p[P.aR]);
    const wave = ["Sine", "Square", "Random (S&H)"][Math.round(p[P.lfoWave])];
    const drift = p[P.drift] * 14, glide = p[P.glide], cutoff = p[P.cutoff];
    for (let i = 0; i < n; i++) {
      this.glideStep(glide);
      const l = this.lfo.next(p[P.lfoRate], rate, wave), fe = this.fe.next(rate), d = this.wander(drift);
      const vib = l * p[P.lfoFreq] * 2 + ctx.wheel * l * 0.5;
      const pw = clamp(p[P.pw] + l * p[P.lfoPw] * 0.45, 0.03, 0.97);
      this.b.step(this.hz(ctx, s2 + d + (on(P.lfoO2) ? vib : 0) + fe * p[P.envO2] * 24), rate);
      const bo = (on(P.saw2) ? this.b.saw() : 0) + (on(P.pul2) ? this.b.pulse(pw) : 0);
      this.a.step(this.hz(ctx, s1 + d + (on(P.lfoO1) ? vib : 0)) * (1 + xm * this.bOut), rate);
      this.bOut = this.b.tri();
      if (sync) this.b.syncTo(this.a);
      const ao = (on(P.saw1) ? this.a.saw() : 0) + (on(P.pul1) ? this.a.pulse(pw) : 0);
      const x = (ao + bo) * 0.3 + this.nz.white() * p[P.noise] * 0.3;
      if ((i & 3) === 0) {
        const hz = cutoffHz(cutoff, env * fe + p[P.kbd] * (this.pitch - 60) / 12 + l * p[P.lfoF] * 2, rate);
        this.f.set(hz, rate, res * 0.97); if (four) this.f4.set(hz, rate);
      }
      let y: number;
      if (four) y = this.f4.process(x * 1.2, res * 4, 1.2);
      else { this.f.process(x, 1.4); y = bp ? this.f.bp : this.f.morph(mode); }
      out[i] += y * this.ae.next(rate);
    }
  }
}

export const obxa: MachineDef = {
  id: "multimode-poly", name: "Overheim OX-A", inspiredBy: "Oberheim OB-Xa (1980) and SEM (1974)", kind: "poly", voices: 8, level: 0.49,
  about: "Eight voices of two oscillators (saw and pulse each, sync, cross-mod, filter envelope sweeping osc 2), the 2-pole state-variable filter whose SEM mode sweeps low-pass, notch and high-pass (or band-pass), the OB-Xa's 4-pole option, an LFO (sine, square, sample & hold) to pitch, width and filter, and per-voice pan and drift for the wide, loose Oberheim sound.",
  params, glideParam: "glide",
  createVoice: (rate, i) => new ObVoice(rate, i + 41),
  presets: [
    { name: "Brass stab", role: "brass", values: {} },
    { name: "Jump brass", role: "brass", values: { detune: 16, cutoff: 900, res: 0.2, envAmt: 0.6, fA: 0.04, fD: 0.3, fS: 0.5, aS: 1, spread: 0.7 } },
    { name: "Notch pad", role: "pad", values: { mode: 0.5, res: 0.6, cutoff: 1200, envAmt: 0.2, fA: 1.5, aA: 0.7, aR: 1.5 } },
    { name: "Band-pass pluck", role: "pluck", values: { bp: 1, res: 0.5, cutoff: 450, envAmt: 0.35, fD: 0.3, fS: 0, aD: 0.5, aS: 0 } },
    { name: "4-pole bass", role: "bass", values: { poles: 1, f1: -12, f2: -12, detune: 6, cutoff: 300, res: 0.3, envAmt: 0.6, fD: 0.4, fS: 0.2, assign: 2 } },
    { name: "Sync sweep", role: "lead", values: { sync: 1, f2: 12, envO2: 0.6, cutoff: 3000, envAmt: 0.25, fD: 0.7, fS: 0.1 } },
    { name: "Unison lead", role: "lead", values: { assign: 1, uniDetune: 18, spread: 0.9, cutoff: 2000, res: 0.35, glide: 0.08, aS: 1 } },
    { name: "S&H filter", role: "fx", values: { lfoWave: 2, lfoRate: 7, lfoF: 0.4, res: 0.7, cutoff: 800, envAmt: 0.1, aS: 1 } },
    { name: "Big detuned pad", role: "pad", values: { detune: 20, spread: 0.8, cutoff: 1500, res: 0.2, envAmt: 0.3, fA: 1, fD: 2, fS: 0.6, aA: 0.8, aR: 2 } },
    { name: "Strings", role: "strings", values: { detune: 14, lfoFreq: 0.03, lfoO1: 1, lfoO2: 1, lfoRate: 5, cutoff: 3500, res: 0.1, envAmt: 0.1, aA: 0.4, aR: 1.3 } },
    { name: "Funky clav", role: "keys", values: { saw1: 0, pul1: 1, saw2: 0, pul2: 1, pw: 0.2, f2: 12, cutoff: 1800, res: 0.4, envAmt: 0.6, fD: 0.2, fS: 0, aD: 0.5, aS: 0, aR: 0.15 } },
    { name: "Unison bass", role: "bass", values: { assign: 1, uniVoices: 3, f1: -12, f2: -12, cutoff: 350, res: 0.25, envAmt: 0.5, fD: 0.3, fS: 0.3 } },
  ],
};
