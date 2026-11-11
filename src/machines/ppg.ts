// Wave Scanner: the PPG Wave 2.2 / 2.3 (1982-84): a wavetable oscillator
// and a sub-oscillator per voice, ENV 1 (filter), ENV 2 (wave), ENV 3 (VCA),
// a delayed LFO, key-tracked wave, the 8-bit sound path and an analog 24 dB
// low-pass. Eight voices. The wavetables are SoundLab's own, not the PPG ROM.
import { Osc } from "../dsp/osc.ts";
import { Cascade4 } from "../dsp/filters.ts";
import { Adsr } from "../dsp/env.ts";
import { table, readTable, WAVETABLES } from "../dsp/wavetable.ts";
import { Voice, indexOf, assignParams, type MachineDef, type ParamDef, type VoiceCtx } from "../engine/machine.ts";
import { cutoffHz, pct, opt, adsr, hzp, time, semi, bip, cents, VLfo, delayFade } from "./common.ts";

const W = "Wave", B = "Sub-oscillator", L = "LFO", F = "Filter", V = "Voice";
const LW = ["Triangle", "Saw down", "Square", "Random (S&H)"] as const;
const params: ParamDef[] = [
  opt("table", "Wavetable", WAVETABLES, 0, W), pct("pos", "Wave (start)", 0.2, W),
  bip("env2Wave", "ENV 2 → wave", 0.5, W), pct("lfoWave", "LFO → wave", 0, W), bip("kbdWave", "Keyboard → wave", 0, W), pct("wheelWave", "Mod wheel → wave", 0.5, W),
  semi("bSemi", "Semitone", 0, B, -24, 24, 1), cents("bDetune", "Detune", 8, B), pct("bLevel", "Level", 0.5, B), bip("bOffset", "Wave offset", 0, B),
  hzp("lfoRate", "Rate", 4, L, 0.05, 25), time("lfoDelay", "Delay", 0.001, L, 0.001, 4), opt("lfoShape", "Waveform", LW, 0, L),
  pct("lfoPitch", "LFO → pitch", 0, L), pct("lfoFilter", "LFO → filter", 0, L), pct("lfoAmp", "LFO → amp", 0, L),
  hzp("cutoff", "Cutoff", 2500, F), pct("res", "Emphasis", 0.2, F), bip("env1Amt", "ENV 1 amount", 0.3, F), pct("kbd", "Keyboard tracking", 0.5, F), pct("velF", "Velocity → filter", 0.2, F),
  ...adsr("e1", "ENV 1 (filter)", 0.005, 1, 0.2, 0.5),
  ...adsr("e2", "ENV 2 (wave)", 0.005, 1, 0.2, 0.5),
  ...adsr("e3", "ENV 3 (VCA)", 0.005, 1, 0.8, 0.5),
  pct("grit", "Digital grit (8-bit path)", 0.3, V), ...assignParams(0, V),
];
const P = indexOf(params);

class PpgVoice extends Voice {
  a = new Osc(); b = new Osc(0.5); f = new Cascade4("ota"); e1 = new Adsr(); e2 = new Adsr(); e3 = new Adsr(); lfo = new VLfo(17); held = 0;
  trigger() { this.e1.gate(true); this.e2.gate(true); this.e3.gate(true); this.held = 0; }
  release() { this.e1.gate(false); this.e2.gate(false); this.e3.gate(false); }
  get active() { return this.e3.active; }
  render(out: Float32Array, n: number, p: Float64Array, ctx: VoiceCtx) {
    const rate = this.rate, tab = table(Math.round(p[P.table])), lw = LW[Math.round(p[P.lfoShape])];
    const rb = 2 ** ((p[P.bSemi] + p[P.bDetune] / 100) / 12), bl = p[P.bLevel];
    const levels = 2 ** (12 - 7 * p[P.grit]), k = p[P.res] * 4, env = p[P.env1Amt] * 6, vf = p[P.velF] * (this.vel - 0.5) * 3;
    this.e1.set(p[P.e1A], p[P.e1D], p[P.e1S], p[P.e1R]); this.e2.set(p[P.e2A], p[P.e2D], p[P.e2S], p[P.e2R]); this.e3.set(p[P.e3A], p[P.e3D], p[P.e3S], p[P.e3R]);
    const kw = p[P.kbdWave] * (this.pitch - 60) / 48, cutoff = p[P.cutoff];
    for (let i = 0; i < n; i++) {
      this.held++;
      const l = this.lfo.next(p[P.lfoRate], rate, lw) * delayFade(this.held, p[P.lfoDelay], rate);
      const e1 = this.e1.next(rate), e2 = this.e2.next(rate);
      const base = this.hz(ctx, l * p[P.lfoPitch] * 1.5);
      const pos = p[P.pos] + p[P.env2Wave] * e2 + p[P.lfoWave] * l * 0.5 + p[P.wheelWave] * ctx.wheel + kw;
      this.a.step(base, rate); this.b.step(base * rb, rate);
      let x = readTable(tab, pos, this.a.phase, this.a.dt) + bl * readTable(tab, pos + p[P.bOffset], this.b.phase, this.b.dt);
      x = Math.round(x * levels) / levels; // the original's 8-bit waves and converters
      if ((i & 3) === 0) this.f.set(cutoffHz(cutoff, env * e1 + p[P.kbd] * (this.pitch - 60) / 12 + l * p[P.lfoFilter] * 2 + vf, rate), rate);
      out[i] += this.f.process(x * 0.35, k, 1.2) * this.e3.next(rate) * (0.7 + 0.3 * this.vel) * (1 + l * p[P.lfoAmp] * 0.8);
    }
  }
}

export const ppg: MachineDef = {
  id: "wave-scanner", name: "PBJ Wave 2.3", inspiredBy: "PPG Wave 2.2 / 2.3 (1982-84)", kind: "poly", voices: 8, level: 1.07,
  about: "A wavetable oscillator and a detunable sub-oscillator reading the same table (with its own offset), scanned by ENV 2, the LFO, the keyboard and the mod wheel; a deliberately coarse 8-bit sound path; and an analog-style 24 dB low-pass with ENV 1 and keyboard tracking; ENV 3 on the VCA; the LFO with delay to pitch, filter and amp. Fourteen generated wavetables, including the classic analog shapes.",
  params,
  createVoice: (rate, i) => new PpgVoice(rate, i + 91),
  presets: [
    { name: "Glassy sweep", role: "pad", values: {} },
    { name: "Vowel pad", role: "pad", values: { table: 2, pos: 0, env2Wave: 0.9, e2A: 1.5, e2D: 3, e3A: 0.5, e3R: 1.5, cutoff: 4000 } },
    { name: "Sync bass", role: "bass", values: { table: 3, pos: 0.1, env2Wave: 0.6, e2D: 0.3, e2S: 0, bSemi: -12, cutoff: 1200, env1Amt: 0.5 } },
    { name: "Crushed bells", role: "bell", values: { table: 5, pos: 0.6, lfoWave: 0.4, grit: 0.8, e3D: 1.5, e3S: 0, e3R: 1.2 } },
    { name: "Organ scan", role: "organ", values: { table: 7, pos: 0, env2Wave: 0, wheelWave: 1, kbdWave: 0.3, cutoff: 8000, env1Amt: 0, e3A: 0.003, e3S: 1, e3R: 0.08 } },
    { name: "Bell partials", role: "bell", values: { table: 8, pos: 0.7, env2Wave: -0.6, e2D: 2, e2S: 0, cutoff: 9000, env1Amt: 0, e3D: 2.5, e3S: 0, e3R: 2 } },
    { name: "Formant lead", role: "lead", values: { table: 10, pos: 0.1, lfoWave: 0.5, lfoRate: 1.2, lfoDelay: 0.5, lfoPitch: 0.1, cutoff: 5000, e3S: 1, assign: 2 } },
    { name: "Digital harp", role: "pluck", values: { table: 13, pos: 0.3, env2Wave: 0.4, e2D: 0.4, e2S: 0, grit: 0.6, cutoff: 6000, e3D: 1.2, e3S: 0, e3R: 1 } },
    { name: "Digital strings", role: "strings", values: { table: 9, pos: 0.7, env2Wave: 0.2, e2A: 1, e2D: 3, bDetune: 12, bLevel: 0.6, e3A: 0.5, e3R: 1.5, cutoff: 5000 } },
    { name: "Upper-waves lead", role: "lead", values: { table: 6, pos: 0.3, lfoWave: 0.2, lfoRate: 5, lfoDelay: 0.4, assign: 2, e3S: 1, cutoff: 6000 } },
    { name: "Metallic pluck", role: "pluck", values: { table: 12, pos: 0.5, env2Wave: -0.5, e2D: 0.3, e2S: 0, e3D: 0.6, e3S: 0, e3R: 0.5 } },
    { name: "Wave bass", role: "bass", values: { table: 1, pos: 0.3, env2Wave: 0.4, e2D: 0.25, e2S: 0.1, bSemi: -12, bLevel: 0.7, cutoff: 900, env1Amt: 0.4, assign: 2, e3S: 0.9 } },
  ],
};
