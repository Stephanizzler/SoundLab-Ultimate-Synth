// Flagship Poly: the Roland Jupiter-8 (1981): LFO, VCO modulator, VCO-1,
// VCO-2, source mix, HPF, VCF, VCA, ENV-1, ENV-2, assign modes and the
// arpeggio. Eight voices. (Dual and Split keyboard modes are made with two
// slots and key ranges; see the performances.)
import { Osc, Noise } from "../dsp/osc.ts";
import { Cascade4, OnePole } from "../dsp/filters.ts";
import { Adsr } from "../dsp/env.ts";
import { clamp } from "../dsp/util.ts";
import { Voice, indexOf, assignParams, arpParams, type MachineDef, type ParamDef, type VoiceCtx } from "../engine/machine.ts";
import { cutoffHz, sw, pct, opt, adsr, hzp, time, cents, feet, VLfo, delayFade } from "./common.ts";

const LF = "LFO", VM = "VCO modulator", V1 = "VCO-1", V2 = "VCO-2", MX = "Source mix", F = "VCF", A = "VCA", E1 = "ENV-1", E2 = "ENV-2", AS = "Assign";
const R1 = ["16'", "8'", "4'", "2'"] as const, R2 = ["LO", "32'", "16'", "8'", "4'", "2'"] as const;
const LFO_W = ["Sine", "Saw up", "Square", "Random (S&H)"] as const;
const params: ParamDef[] = [
  hzp("lfoRate", "Rate", 5, LF, 0.1, 30), time("lfoDelay", "Delay time", 0.001, LF, 0.001, 4), opt("lfoWave", "Waveform", LFO_W, 0, LF),
  pct("vmLfo", "LFO mod", 0, VM), pct("vmEnv", "ENV-1 mod", 0, VM), opt("vmDest", "Destination", ["VCO-1", "VCO-2", "Both"], 2, VM),
  pct("xmod", "Cross mod", 0, V1), opt("r1", "Range", R1, 1, V1), opt("w1", "Waveform", ["Triangle", "Sawtooth", "Pulse", "Square"], 1, V1),
  sw("sync", "Sync", 0, V2), opt("r2", "Range", R2, 3, V2), cents("t2", "Fine tune", 9, V2), opt("w2", "Waveform", ["Sine", "Sawtooth", "Pulse", "Noise"], 1, V2),
  pct("pw", "Pulse width", 0.35, V2), opt("pwm", "PWM source", ["LFO", "Manual", "ENV-1"], 1, V2),
  pct("mix", "VCO-1 ↔ VCO-2", 0.5, MX),
  hzp("hpf", "HPF", 20, F, 20, 2000), hzp("cutoff", "Cutoff freq", 2200, F), pct("res", "Resonance", 0.2, F), opt("slope", "Slope", ["12 dB", "24 dB"], 1, F),
  pct("envAmt", "ENV mod", 0.4, F), opt("envSel", "ENV", ["ENV-1", "ENV-2"], 0, F), pct("lfoF", "LFO mod", 0, F), pct("kbd", "Key follow", 0.5, F),
  pct("lfoA", "LFO mod", 0, A), pct("vcaLevel", "Level", 0.8, A),
  ...adsr("e1", E1, 0.005, 0.7, 0.3, 0.5), sw("e1Kf", "Key follow", 0, E1), opt("e1Pol", "Polarity", ["Normal", "Inverted"], 0, E1),
  ...adsr("e2", E2, 0.005, 0.7, 0.8, 0.5), sw("e2Kf", "Key follow", 0, E2),
  time("glide", "Portamento", 0.001, AS, 0.001, 3), ...assignParams(0, AS),
  ...arpParams("Arpeggio", 4),
  pct("drift", "Drift", 0.2, "Character"),
];
const P = indexOf(params);
const RS1 = feet(R1), RS2 = feet(R2);

class JupVoice extends Voice {
  a = new Osc(); b = new Osc(0.25); nz = new Noise(4); f = new Cascade4("ota"); hp = new OnePole(); e1 = new Adsr(); e2 = new Adsr(); lfo = new VLfo(55); bOut = 0; held = 0;
  trigger() { this.e1.gate(true); this.e2.gate(true); this.held = 0; }
  release() { this.e1.gate(false); this.e2.gate(false); }
  get active() { return this.e2.active; }
  render(out: Float32Array, n: number, p: Float64Array, ctx: VoiceCtx) {
    const rate = this.rate;
    // Envelope key follow: higher notes get shorter times.
    const kf = (on: boolean) => (on ? 2 ** (-(this.pitch - 60) / 24) : 1);
    const k1 = kf(p[P.e1Kf] > 0.5), k2 = kf(p[P.e2Kf] > 0.5);
    this.e1.set(p[P.e1A] * k1, p[P.e1D] * k1, p[P.e1S], p[P.e1R] * k1); this.e2.set(p[P.e2A] * k2, p[P.e2D] * k2, p[P.e2S], p[P.e2R] * k2);
    const w1 = Math.round(p[P.w1]), w2 = Math.round(p[P.w2]), sync = p[P.sync] > 0.5, xm = p[P.xmod] * 3, wave = LFO_W[Math.round(p[P.lfoWave])];
    const s1 = RS1[Math.round(p[P.r1])], s2 = RS2[Math.round(p[P.r2])] + p[P.t2] / 100, dest = Math.round(p[P.vmDest]), pwm = Math.round(p[P.pwm]);
    const k = p[P.res] * 4, env = p[P.envAmt] * 6, two = p[P.slope] < 0.5, mix = p[P.mix], useE2 = p[P.envSel] > 0.5, inv = p[P.e1Pol] > 0.5 ? -1 : 1;
    this.hp.set(p[P.hpf], rate);
    const drift = p[P.drift] * 8, cutoff = p[P.cutoff], glide = p[P.glide], level = p[P.vcaLevel] * 1.25;
    for (let i = 0; i < n; i++) {
      this.glideStep(glide); this.held++;
      const l = this.lfo.next(p[P.lfoRate], rate, wave) * delayFade(this.held, p[P.lfoDelay], rate);
      const e1 = this.e1.next(rate) * inv, e2 = this.e2.next(rate);
      const vm = l * p[P.vmLfo] * 2 + e1 * p[P.vmEnv] * 24;
      const d = this.wander(drift);
      const pw = clamp(pwm === 1 ? p[P.pw] : pwm === 0 ? p[P.pw] * (0.5 + 0.5 * l) : p[P.pw] * Math.abs(e1), 0, 0.95);
      this.b.step(this.hz(ctx, s2 + d + (dest > 0 ? vm : 0)), rate);
      const bo = w2 === 0 ? this.b.sine() : w2 === 1 ? this.b.saw() : w2 === 2 ? this.b.pulse(0.5 - pw * 0.47) : this.nz.white();
      this.a.step(this.hz(ctx, s1 + d + (dest !== 1 ? vm : 0)) * (1 + xm * this.bOut), rate);
      this.bOut = bo;
      if (sync) this.a.syncTo(this.b);
      const ao = w1 === 0 ? this.a.tri() : w1 === 1 ? this.a.saw() : w1 === 2 ? this.a.pulse(0.5 - pw * 0.47) : this.a.pulse(0.5);
      if ((i & 3) === 0) this.f.set(cutoffHz(cutoff, env * (useE2 ? e2 : e1) + l * p[P.lfoF] * 2 + p[P.kbd] * (this.pitch - 60) / 12, rate), rate);
      const x = this.hp.hp(ao * (1 - mix) + bo * mix);
      const lp4 = this.f.process(x * 0.45, k, 1.2);
      out[i] += (two ? this.f.out[1] : lp4) * e2 * (1 + l * p[P.lfoA] * 0.8) * level;
    }
  }
}

export const jupiter8: MachineDef = {
  id: "flagship-poly", name: "Juniper-8", inspiredBy: "Roland Jupiter-8 (1981)", kind: "poly", voices: 8, level: 1.21,
  about: "Eight voices. VCO-1 (triangle, saw, pulse, square; cross-modulated by VCO-2) and VCO-2 (sine, saw, pulse, noise; syncable, with a low range), PWM from the LFO, by hand or from ENV-1, a VCO modulator, a high-pass, the IR3109-style 4-pole filter switchable to 12 dB, two ADSRs with key follow (ENV-1 invertible), the delayed LFO with four waves, solo/unison/poly assign and the arpeggio.",
  params, glideParam: "glide",
  createVoice: (rate, i) => new JupVoice(rate, i + 31),
  presets: [
    { name: "Big poly", role: "keys", values: {} },
    { name: "Cross-mod bell", role: "bell", values: { w1: 0, w2: 0, xmod: 0.5, r2: 4, cutoff: 6000, envAmt: 0.1, e2D: 1.6, e2S: 0, e2R: 1.5 } },
    { name: "Sync lead", role: "lead", values: { sync: 1, r1: 2, w1: 1, w2: 1, mix: 0, vmEnv: 0.3, vmDest: 0, cutoff: 5000, envAmt: 0.2, e2S: 1, assign: 2, glide: 0.05 } },
    { name: "12 dB pad", role: "pad", values: { slope: 0, cutoff: 1500, res: 0.4, e1A: 1.2, e1D: 2, e2A: 0.8, e2R: 2, lfoF: 0.1, lfoRate: 0.4 } },
    { name: "Unison brass", role: "brass", values: { assign: 1, uniDetune: 12, cutoff: 700, envAmt: 0.55, e1A: 0.06, e1D: 0.5, e1S: 0.5, e2A: 0.03 } },
    { name: "Arpeggio sequence", role: "pluck", values: { arp: 3, arpRange: 1, arpRate: 3, cutoff: 1200, res: 0.5, envAmt: 0.5, e1D: 0.25, e1S: 0, e2D: 0.3, e2S: 0, e2R: 0.2 } },
    { name: "PWM strings", role: "strings", values: { w1: 2, w2: 2, pwm: 0, pw: 0.6, lfoRate: 0.7, mix: 0.5, cutoff: 3500, envAmt: 0.05, e2A: 0.5, e2R: 1.5 } },
    { name: "Delayed vibrato lead", role: "lead", values: { r1: 2, w2: 2, mix: 0.4, vmLfo: 0.25, lfoDelay: 0.8, lfoRate: 6, cutoff: 3000, assign: 2, e2S: 1, glide: 0.04 } },
    { name: "Unison bass", role: "bass", values: { assign: 2, r1: 0, r2: 2, w1: 1, w2: 1, t2: 6, cutoff: 380, res: 0.3, envAmt: 0.5, e1D: 0.3, e1S: 0.2, e2S: 0.9 } },
    { name: "Hollow square keys", role: "keys", values: { w1: 3, w2: 2, pw: 0.3, mix: 0.45, cutoff: 2600, res: 0.15, envAmt: 0.3, e1D: 0.6, e1S: 0.2, e2D: 1.2, e2S: 0.3, e2R: 0.6 } },
    { name: "Glistening pad", role: "pad", values: { w1: 1, w2: 1, r2: 3, t2: 6, hpf: 200, cutoff: 3000, res: 0.2, envAmt: 0.15, e1A: 1.5, e1D: 3, e2A: 1.2, e2R: 2.5, lfoF: 0.05, lfoRate: 0.3 } },
    { name: "S&H bubbles", role: "fx", values: { lfoWave: 3, lfoRate: 8, lfoF: 0.5, res: 0.7, cutoff: 900, envAmt: 0.1, e2S: 1 } },
  ],
};
