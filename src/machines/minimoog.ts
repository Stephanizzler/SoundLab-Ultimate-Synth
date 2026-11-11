// Ladder Mono: the Moog Minimoog Model D (1970), panel for panel.
// Controllers · Oscillator bank · Mixer · Modifiers (filter and loudness contours).
import { Osc, Noise } from "../dsp/osc.ts";
import { Cascade4 } from "../dsp/filters.ts";
import { Adsr } from "../dsp/env.ts";
import { tanh } from "../dsp/util.ts";
import { Voice, indexOf, type MachineDef, type ParamDef, type VoiceCtx } from "../engine/machine.ts";
import { nativeMiniMood } from "../engine/native.ts";
import { feet, cutoffHz, sw, pct, opt, time, semi, hzp } from "./common.ts";

const RANGES = ["LO", "32'", "16'", "8'", "4'", "2'"] as const;
const RANGE_SEMIS = feet(RANGES);
const WAVES_12 = ["Triangle", "Tri-saw", "Saw", "Square", "Wide pulse", "Narrow pulse"] as const;
const WAVES_3 = ["Triangle", "Reverse saw", "Saw", "Square", "Wide pulse", "Narrow pulse"] as const;
const C = "Controllers", O = "Oscillator bank", M = "Mixer", F = "Filter", L = "Loudness contour", X = "Character";

const params: ParamDef[] = [
  semi("tune", "Tune", 0, C, -2, 2),
  time("glide", "Glide", 0.08, C, 0.001, 5), sw("glideOn", "Glide on", 0, C),
  pct("modMix", "Modulation mix (osc 3 ↔ noise)", 0, C),
  pct("wheel", "Modulation amount (wheel)", 0, C),
  sw("oscMod", "Oscillator modulation", 0, C), sw("filterMod", "Filter modulation", 0, C),
  sw("osc3Kbd", "Osc 3 control (keyboard)", 1, C),
  opt("r1", "Osc 1 range", RANGES, 2, O), opt("w1", "Osc 1 waveform", WAVES_12, 2, O),
  opt("r2", "Osc 2 range", RANGES, 2, O), semi("f2", "Osc 2 frequency", 0.07, O, -7, 7), opt("w2", "Osc 2 waveform", WAVES_12, 2, O),
  opt("r3", "Osc 3 range", RANGES, 2, O), semi("f3", "Osc 3 frequency", -0.05, O, -7, 7), opt("w3", "Osc 3 waveform", WAVES_3, 3, O),
  sw("on1", "Osc 1 on", 1, M), pct("m1", "Osc 1 volume", 0.8, M),
  sw("on2", "Osc 2 on", 1, M), pct("m2", "Osc 2 volume", 0.6, M),
  sw("on3", "Osc 3 on", 1, M), pct("m3", "Osc 3 volume", 0.4, M),
  sw("extOn", "External input on", 0, M), pct("ext", "External input (feedback)", 0.5, M),
  sw("noiseOn", "Noise on", 0, M), pct("noise", "Noise volume", 0.5, M), opt("noiseColor", "Noise", ["White", "Pink"], 0, M),
  hzp("cutoff", "Cutoff frequency", 600, F),
  pct("emph", "Emphasis", 0.35, F), pct("contour", "Amount of contour", 0.55, F),
  sw("kbd1", "Keyboard control 1", 1, F), sw("kbd2", "Keyboard control 2", 0, F),
  time("fA", "Attack time", 0.002, F), time("fD", "Decay time", 0.35, F, 0.005), pct("fS", "Sustain level", 0.2, F),
  time("aA", "Attack time", 0.002, L), time("aD", "Decay time", 0.6, L, 0.005), pct("aS", "Sustain level", 0.85, L),
  sw("decaySw", "Decay (release follows decay)", 1, L),
  pct("drift", "Oscillator drift", 0.3, X),
];
const P = indexOf(params);

function wave(o: Osc, w: number, three: boolean) {
  switch (w) {
    case 0: return o.tri();
    case 1: return three ? -o.saw() : o.shark();
    case 2: return o.saw();
    case 3: return o.pulse(0.5);
    case 4: return o.pulse(0.3);
    default: return o.pulse(0.12);
  }
}

export class MoogVoice extends Voice {
  o = [new Osc(0), new Osc(0.33), new Osc(0.66)]; nz = new Noise(3); f = new Cascade4("ladder"); fe = new Adsr(); ae = new Adsr(); last = 0;
  trigger(legato: boolean) { if (!legato) { this.fe.gate(true); this.ae.gate(true); } } // single triggering, as on the original
  release() { this.fe.gate(false); this.ae.gate(false); }
  get active() { return this.ae.active; }
  render(out: Float32Array, n: number, p: Float64Array, ctx: VoiceCtx) {
    const rate = this.rate;
    const w = [p[P.w1], p[P.w2], p[P.w3]].map(Math.round);
    const r = [RANGE_SEMIS[Math.round(p[P.r1])], RANGE_SEMIS[Math.round(p[P.r2])] + p[P.f2], RANGE_SEMIS[Math.round(p[P.r3])] + p[P.f3]];
    const ratio = [2 ** (r[0] / 12), 2 ** (r[1] / 12)];
    const lv = [p[P.on1] * p[P.m1], p[P.on2] * p[P.m2], p[P.on3] * p[P.m3]];
    const noise = p[P.noiseOn] * p[P.noise], pink = p[P.noiseColor] > 0.5, ext = p[P.extOn] * p[P.ext];
    const k = p[P.emph] * 4.15, contour = p[P.contour] * 5, kbd = (p[P.kbd1] > 0.5 ? 1 / 3 : 0) + (p[P.kbd2] > 0.5 ? 2 / 3 : 0);
    const decayOn = p[P.decaySw] > 0.5, glide = p[P.glideOn] > 0.5 ? p[P.glide] : 0;
    this.fe.set(p[P.fA], p[P.fD], p[P.fS], decayOn ? p[P.fD] : 0.008);
    this.ae.set(p[P.aA], p[P.aD], p[P.aS], decayOn ? p[P.aD] : 0.008);
    const wheel = Math.min(1, p[P.wheel] + ctx.wheel), mix = p[P.modMix], oscMod = p[P.oscMod] > 0.5, filtMod = p[P.filterMod] > 0.5, osc3Kbd = p[P.osc3Kbd] > 0.5;
    const drift = p[P.drift] * 8, cutoff = p[P.cutoff], tune = p[P.tune];
    // Mixer level into the filter: turning the volumes up overdrives the ladder, as players did.
    const drive = 1 + (lv[0] + lv[1] + lv[2]) * 1.2;
    for (let i = 0; i < n; i++) {
      this.glideStep(glide);
      const d = this.wander(drift);
      // Osc 3 first: with keyboard control off it holds its pitch and works as an LFO.
      const p3 = osc3Kbd ? this.pitch + this.detune + ctx.bend : 48;
      this.o[2].step(440 * 2 ** ((p3 + r[2] + tune - 69) / 12), rate);
      const o3 = wave(this.o[2], w[2], true);
      const nzv = pink ? this.nz.pink() * 2.2 : this.nz.white();
      const modSrc = (1 - mix) * o3 + mix * nzv;
      const pm = oscMod ? modSrc * wheel * 7 : 0;
      const base = this.hz(ctx, tune + d + pm);
      let x = 0;
      for (let j = 0; j < 2; j++) { this.o[j].step(base * ratio[j], rate); x += wave(this.o[j], w[j], false) * lv[j]; }
      x += o3 * lv[2] + nzv * noise + tanh(this.last * 3) * ext * 0.8;
      const fe = this.fe.next(rate);
      if ((i & 3) === 0) this.f.set(cutoffHz(cutoff, contour * fe + kbd * (this.pitch - 60) / 12 + (filtMod ? modSrc * wheel * 3 : 0), rate), rate);
      const y = this.f.process(x * 0.4, k, drive) * (1 + k * 0.35);
      this.last = y;
      out[i] += y * this.ae.next(rate);
    }
  }
}

export const minimoog: MachineDef = {
  id: "ladder-mono", name: "MiniMood Model Q", inspiredBy: "Moog Minimoog Model D (1970)", kind: "mono", voices: 1, level: 1.3,
  about: "Three oscillators (32' to 2' plus LO; osc 3 can leave the keyboard and become an LFO), a mixer with noise and the external-input feedback trick, and the 24 dB transistor ladder with its contour generators. The modulation mix blends osc 3 and noise; the wheel sets how much reaches the oscillators and the filter. Monophonic with low-note priority and single triggering, as on the original.",
  params, glideParam: "glide", priority: "low",
  // The C++ port (native/) when the native engine is on; this TypeScript voice otherwise.
  createVoice: (rate, i) => nativeMiniMood(rate, i) ?? new MoogVoice(rate, i),
  presets: [
    { name: "Classic bass", values: {} },
    { name: "Lead with glide", values: { r1: 3, r2: 3, r3: 4, f2: 0.12, f3: 7.02, m3: 0.3, cutoff: 1400, emph: 0.5, contour: 0.4, fS: 0.6, glideOn: 1, glide: 0.09, aD: 1 } },
    { name: "Plucked bass", values: { w1: 3, cutoff: 220, emph: 0.6, contour: 0.8, fD: 0.18, fS: 0, aD: 0.4, aS: 0 } },
    { name: "Brass swell", values: { cutoff: 400, emph: 0.25, contour: 0.6, fA: 0.25, fD: 1.2, fS: 0.5, aA: 0.08 } },
    { name: "Osc 3 vibrato lead", values: { r1: 3, r2: 3, on3: 0, osc3Kbd: 0, r3: 0, f3: 3, w3: 0, oscMod: 1, wheel: 0.12, cutoff: 1800, emph: 0.3, fS: 0.7, glideOn: 1, glide: 0.05 } },
    { name: "Filter trill", values: { osc3Kbd: 0, r3: 0, f3: 5, w3: 3, on3: 0, filterMod: 1, wheel: 0.6, cutoff: 500, emph: 0.6, contour: 0.2, fS: 0.8 } },
    { name: "Feedback growl", values: { extOn: 1, ext: 0.8, m1: 1, m2: 1, m3: 0.8, cutoff: 350, emph: 0.4, contour: 0.5, fD: 0.5 } },
    { name: "Wind and whistles", values: { on1: 0, on2: 0, on3: 0, noiseOn: 1, noise: 1, noiseColor: 1, cutoff: 900, emph: 0.85, kbd1: 1, kbd2: 1, contour: 0.3, fA: 0.4, aA: 0.3, aS: 1, aD: 2 } },
  ],
};
