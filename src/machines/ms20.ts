// Scream Mono: the Korg MS-20 (1978): VCO-1/2, mixer, high-pass and low-pass
// (Korg 35), modulation generator, EG1 (delay-attack-release), EG2
// (hold-attack-decay-sustain-release) and the modulation knobs. The patch
// panel's normalled connections are modelled; external patching is done with
// the patch bay instead.
import { Osc, Noise } from "../dsp/osc.ts";
import { Korg35 } from "../dsp/filters.ts";
import { Adsr } from "../dsp/env.ts";
import { Voice, indexOf, type MachineDef, type ParamDef, type VoiceCtx } from "../engine/machine.ts";
import { cutoffHz, pct, opt, time, hzp, semi, feet, bip } from "./common.ts";

const SC = ["32'", "16'", "8'", "4'"] as const, SCS = feet(SC);
const V1 = "VCO-1", V2 = "VCO-2", MX = "VCO mixer", HP = "High-pass filter", LP = "Low-pass filter", MG = "Modulation generator", FM = "Frequency modulation", E1 = "EG 1", E2 = "EG 2", C = "Controller";
const params: ParamDef[] = [
  time("glide", "Portamento", 0.001, C, 0.001, 3), semi("tune", "Master tune", 0, C, -2, 2),
  opt("w1", "Waveform", ["Triangle", "Sawtooth", "Pulse", "White noise"], 1, V1), pct("pw", "Pulse width", 0.5, V1), opt("s1", "Scale", SC, 1, V1),
  opt("w2", "Waveform", ["Sawtooth", "Square", "Narrow pulse", "Ring mod"], 0, V2), opt("s2", "Scale", SC, 1, V2), semi("t2", "Pitch", 0.1, V2, -12, 12),
  pct("m1", "VCO-1 level", 0.8, MX), pct("m2", "VCO-2 level", 0.5, MX),
  hzp("hpCut", "Cutoff frequency", 60, HP, 20, 6000), pct("hpPeak", "Peak", 0.2, HP), bip("hpMg", "MG / T.ext mod", 0, HP), bip("hpEg", "EG2 / ext mod", 0, HP),
  hzp("cutoff", "Cutoff frequency", 900, LP), pct("lpPeak", "Peak", 0.5, LP), bip("lpMg", "MG / T.ext mod", 0, LP), bip("lpEg", "EG2 / ext mod", 0.5, LP),
  hzp("mgRate", "Frequency", 4, MG, 0.05, 40), pct("mgShape", "Waveform (ramp – triangle – saw)", 0.5, MG),
  pct("fmMg", "MG / T.ext", 0, FM), bip("fmEg", "EG1 / ext", 0, FM),
  time("e1D", "Delay time", 0.001, E1, 0.001, 3), time("e1A", "Attack time", 0.001, E1, 0.001, 5), time("e1R", "Release time", 0.1, E1, 0.005, 5),
  time("e2H", "Hold time", 0.001, E2, 0.001, 3), time("e2A", "Attack time", 0.002, E2), time("e2D", "Decay time", 0.4, E2, 0.005), pct("e2S", "Sustain level", 0.5, E2), time("e2R", "Release time", 0.25, E2, 0.005),
  pct("drive", "Input level (drive)", 0.4, "Character"),
];
const P = indexOf(params);

class MsVoice extends Voice {
  a = new Osc(); b = new Osc(0.4); nz = new Noise(12); hp = new Korg35("hp"); lp = new Korg35("lp"); e2 = new Adsr();
  mg = 0; e1 = 0; e1t = 0; e2hold = 0;
  trigger(legato: boolean) { if (!legato) { this.e2.reset(); this.e2hold = 0; this.e1t = 0; this.e1 = 0; } }
  release() { this.e2.gate(false); }
  get active() { return this.e2.active || this.gateOn; }
  render(out: Float32Array, n: number, p: Float64Array, ctx: VoiceCtx) {
    const rate = this.rate;
    const s1 = SCS[Math.round(p[P.s1])] + p[P.tune], s2 = SCS[Math.round(p[P.s2])] + p[P.t2] + p[P.tune];
    const w1 = Math.round(p[P.w1]), w2 = Math.round(p[P.w2]), sat = 1 + p[P.drive] * 4;
    this.e2.set(p[P.e2A], p[P.e2D], p[P.e2S], p[P.e2R]);
    const holdN = p[P.e2H] * rate, e1D = p[P.e1D] * rate, e1A = 1 - Math.exp(-4 / (p[P.e1A] * rate)), e1R = Math.exp(-6.9 / (p[P.e1R] * rate));
    const mgInc = p[P.mgRate] / rate, skew = Math.min(0.999, Math.max(0.001, p[P.mgShape]));
    const glide = p[P.glide], hpCut = p[P.hpCut], lpCut = p[P.cutoff];
    for (let i = 0; i < n; i++) {
      this.glideStep(glide);
      // MG: a triangle whose rising part can be squeezed into a ramp or a saw.
      this.mg += mgInc; if (this.mg >= 1) this.mg -= 1;
      const mg = this.mg < skew ? (this.mg / skew) * 2 - 1 : 1 - ((this.mg - skew) / (1 - skew)) * 2;
      // EG1: waits for the delay, rises while the key is held, falls on release.
      this.e1t++;
      if (this.gateOn) { if (this.e1t > e1D) this.e1 += (1 - this.e1) * e1A; } else this.e1 *= e1R;
      // EG2: holds before starting.
      if (this.gateOn && this.e2.stage === 0 && ++this.e2hold > holdN) this.e2.gate(true);
      const e2 = this.e2.next(rate);
      const base = this.hz(ctx, mg * p[P.fmMg] * 12 + this.e1 * p[P.fmEg] * 24 + this.wander(4) + ctx.wheel * mg * 0.5);
      this.a.step(base * 2 ** (s1 / 12), rate); this.b.step(base * 2 ** (s2 / 12), rate);
      const ao = w1 === 0 ? this.a.tri() : w1 === 1 ? this.a.saw() : w1 === 2 ? this.a.pulse(0.5 - p[P.pw] * 0.45) : this.nz.white();
      const bo = w2 === 0 ? this.b.saw() : w2 === 1 ? this.b.pulse(0.5) : w2 === 2 ? this.b.pulse(0.1) : (this.b.pulse(0.5) * (this.a.phase < 0.5 ? 1 : -1));
      if ((i & 3) === 0) {
        this.hp.set(cutoffHz(hpCut, mg * p[P.hpMg] * 3 + e2 * p[P.hpEg] * 6, rate), rate, p[P.hpPeak] * 1.95);
        this.lp.set(cutoffHz(lpCut, mg * p[P.lpMg] * 3 + e2 * p[P.lpEg] * 6 + (this.pitch - 60) / 24, rate), rate, p[P.lpPeak] * 1.98);
      }
      const x = ao * p[P.m1] + bo * p[P.m2];
      out[i] += this.lp.process(this.hp.process(x * 0.5, sat), sat) * e2;
    }
  }
}

export const ms20: MachineDef = {
  id: "scream-mono", name: "Scream Mono", inspiredBy: "Korg MS-20 (1978)", kind: "mono", voices: 1, level: 2.2,
  about: "VCO-1 (triangle, saw, variable pulse, white noise) and VCO-2 (saw, square, narrow pulse, ring mod with VCO-1), then the resonant high-pass and low-pass, both Korg 35 circuits with nonlinear positive feedback that scream and self-oscillate. The modulation generator morphs from ramp through triangle to saw; EG1 (delay, attack, release) bends pitch, EG2 (hold, attack, decay, sustain, release) drives the filters and the amplifier. Low-note priority, as on the original.",
  params, glideParam: "glide", priority: "low",
  createVoice: (rate, i) => new MsVoice(rate, i + 51),
  presets: [
    { name: "Gritty bass", values: {} },
    { name: "Screaming lead", values: { s1: 2, s2: 2, t2: 7, lpPeak: 0.85, hpPeak: 0.5, hpCut: 300, cutoff: 1500, drive: 0.7, e2S: 0.9, glide: 0.05 } },
    { name: "Ring-mod clang", values: { w1: 2, w2: 3, t2: 5, cutoff: 3000, lpPeak: 0.3, e2D: 0.6, e2S: 0 } },
    { name: "Resonant zap", values: { cutoff: 200, lpPeak: 0.92, lpEg: 0.9, e2D: 0.15, e2S: 0 } },
    { name: "Wah sweep (MG)", values: { mgRate: 1.5, mgShape: 0.5, lpMg: 0.6, lpPeak: 0.75, cutoff: 700, lpEg: 0, e2S: 1 } },
    { name: "Laser (EG1 pitch)", values: { fmEg: -0.8, e1A: 0.001, e1R: 0.2, s1: 3, w1: 2, cutoff: 4000, lpPeak: 0.4, e2D: 0.3, e2S: 0 } },
    { name: "Noise percussion", values: { w1: 3, m2: 0, hpCut: 1200, hpPeak: 0.6, cutoff: 3000, lpPeak: 0.7, e2A: 0.001, e2D: 0.12, e2S: 0, e2R: 0.1 } },
    { name: "Vibrato lead", values: { s1: 2, s2: 2, fmMg: 0.04, mgRate: 6, cutoff: 2000, lpPeak: 0.5, e2S: 0.9 } },
  ],
};
