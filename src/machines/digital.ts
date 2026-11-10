// FM, West Coast and string-machine models.
import { Osc, Noise } from "../dsp/osc.ts";
import { OnePole, Svf, LowPassGate, fold } from "../dsp/filters.ts";
import { Adsr } from "../dsp/env.ts";
import { Ensemble } from "../dsp/fx.ts";
import { TAU } from "../dsp/util.ts";
import { Voice, indexOf, adsrParams, type MachineDef, type ParamDef, type VoiceCtx } from "../engine/machine.ts";

/* ------------------------------------------------------------------ */
/* FM Six: Yamaha DX7 (1983)                                           */
/* ------------------------------------------------------------------ */
// Eight of the DX7's 32 operator layouts. Each lists [modulator, target]
// pairs (operators numbered 1-6), the carriers you hear, and which operator
// feeds back into itself.
export const ALGORITHMS: { name: string; mods: [number, number][]; carriers: number[]; fb: number }[] = [
  { name: "1 · two stacks", mods: [[2, 1], [4, 3], [5, 4], [6, 5]], carriers: [1, 3], fb: 6 },
  { name: "2 · two stacks, fb 2", mods: [[2, 1], [4, 3], [5, 4], [6, 5]], carriers: [1, 3], fb: 2 },
  { name: "5 · three pairs", mods: [[2, 1], [4, 3], [6, 5]], carriers: [1, 3, 5], fb: 6 },
  { name: "7 · pair + branch", mods: [[2, 1], [4, 3], [5, 3], [6, 5]], carriers: [1, 3], fb: 6 },
  { name: "16 · one carrier, three branches", mods: [[2, 1], [3, 1], [5, 1], [4, 3], [6, 5]], carriers: [1], fb: 6 },
  { name: "19 · stack + split", mods: [[2, 1], [3, 2], [6, 4], [6, 5]], carriers: [1, 4, 5], fb: 6 },
  { name: "22 · one to three", mods: [[2, 1], [6, 3], [6, 4], [6, 5]], carriers: [1, 3, 4, 5], fb: 6 },
  { name: "32 · six sines (organ)", mods: [], carriers: [1, 2, 3, 4, 5, 6], fb: 6 },
];
const fmParams: ParamDef[] = [
  { id: "alg", name: "Algorithm", min: 0, max: ALGORITHMS.length - 1, def: 0, options: ALGORITHMS.map((a) => a.name), group: "Algorithm" },
  { id: "fb", name: "Feedback", min: 0, max: 1, def: 0.2, unit: "%", group: "Algorithm" },
  { id: "bright", name: "Brightness", min: 0, max: 1, def: 0.6, unit: "%", group: "Algorithm" },
  { id: "velMod", name: "Velocity to brightness", min: 0, max: 1, def: 0.6, unit: "%", group: "Algorithm" },
  ...[1, 2, 3, 4, 5, 6].flatMap((k): ParamDef[] => [
    { id: `r${k}`, name: `Op ${k} ratio`, min: 0.5, max: 16, def: [1, 1, 1, 1, 1, 1][k - 1], step: 0.5, unit: "x", group: `Operator ${k}` },
    { id: `l${k}`, name: `Op ${k} level`, min: 0, max: 1, def: [0.9, 0.6, 0.9, 0.5, 0.4, 0.3][k - 1], unit: "%", group: `Operator ${k}` },
  ]),
  { id: "detune", name: "Detune", min: 0, max: 10, def: 2, unit: "ct", group: "Algorithm" },
  ...adsrParams("c", "Carrier env", 0.002, 1.2, 0.5, 0.5),
  ...adsrParams("m", "Modulator env", 0.002, 0.6, 0.3, 0.5),
];
const FP = indexOf(fmParams);
const RATIO = [1, 2, 3, 4, 5, 6].map((k) => FP[`r${k}`]);
const LEVEL = [1, 2, 3, 4, 5, 6].map((k) => FP[`l${k}`]);
// For each algorithm, which operators modulate each operator (looked up every sample).
const SOURCES = ALGORITHMS.map((a) => [0, 1, 2, 3, 4, 5, 6].map((op) => a.mods.filter(([, t]) => t === op).map(([m]) => m)));
class FmVoice extends Voice {
  ph = new Float64Array(7); y = new Float64Array(7); prevFb = 0; ce = new Adsr(); me = new Adsr();
  trigger() { this.ce.gate(true); this.me.gate(true); this.ph.fill(0); }
  release() { this.ce.gate(false); this.me.gate(false); }
  get active() { return this.ce.active; }
  render(out: Float32Array, n: number, p: Float64Array, ctx: VoiceCtx) {
    const P = FP, rate = this.rate, ai = Math.round(p[P.alg]), alg = ALGORITHMS[ai] ?? ALGORITHMS[0], src = SOURCES[ai] ?? SOURCES[0];
    const isCarrier = new Array(7).fill(false); alg.carriers.forEach((c) => (isCarrier[c] = true));
    const ratio = RATIO.map((i, k) => p[i] * 2 ** (((k % 2 ? 1 : -1) * p[P.detune] * (k / 6)) / 1200));
    const lvl = LEVEL.map((i) => p[i] * p[i]);
    const index = 7 * p[P.bright] * (1 - p[P.velMod] + p[P.velMod] * this.vel);
    const fb = p[P.fb] * 0.9, norm = 1 / Math.sqrt(alg.carriers.length);
    this.ce.set(p[P.cA], p[P.cD], p[P.cS], p[P.cR]); this.me.set(p[P.mA], p[P.mD], p[P.mS], p[P.mR]);
    const y = this.y, ph = this.ph;
    for (let i = 0; i < n; i++) {
      const base = this.hz(ctx) / rate;
      const ce = this.ce.next(rate), me = this.me.next(rate);
      let sum = 0;
      for (let op = 6; op >= 1; op--) {
        let mod = 0;
        const from = src[op];
        for (let j = 0; j < from.length; j++) mod += y[from[j]];
        if (op === alg.fb) mod += this.prevFb * fb;
        ph[op] += base * ratio[op - 1]; if (ph[op] >= 1) ph[op] -= Math.floor(ph[op]);
        const s = Math.sin(TAU * ph[op] + mod);
        if (isCarrier[op]) { y[op] = s * lvl[op - 1] * ce; sum += y[op]; }
        else y[op] = s * lvl[op - 1] * me * index;
        if (op === alg.fb) this.prevFb = 0.5 * (this.prevFb + s);
      }
      out[i] += sum * norm * 0.5;
    }
  }
}
export const fmSix: MachineDef = {
  id: "fm-six", name: "FM Six", inspiredBy: "Yamaha DX7 (1983)", kind: "poly", voices: 12, level: 0.45,
  about: "Six sine operators modulating each other's phase, in eight of the DX7's layouts, with operator feedback. Glassy electric pianos, bells, slap bass and brass. Envelopes are shared by carriers and by modulators rather than one per operator.",
  params: fmParams,
  createVoice: (rate, i) => new FmVoice(rate, i + 111),
  presets: [
    { name: "Electric piano", values: { alg: 2, r1: 1, r2: 14, r3: 1, r4: 1, r5: 1, r6: 1, l1: 0.9, l2: 0.35, l3: 0.9, l4: 0.5, l5: 0.8, l6: 0.45, fb: 0.3, bright: 0.45, cA: 0.002, cD: 2.5, cS: 0, cR: 0.6, mA: 0.002, mD: 0.8, mS: 0.1 } },
    { name: "Tubular bell", values: { alg: 2, r1: 1, r2: 3.5, r3: 1, r4: 3.5, r5: 1, r6: 1, l2: 0.7, l4: 0.7, l5: 0.2, l6: 0.2, bright: 0.5, cD: 4, cS: 0, cR: 3, mD: 3, mS: 0 } },
    { name: "Slap bass", values: { alg: 0, r1: 0.5, r2: 0.5, r3: 0.5, r4: 1, r5: 3, r6: 7, l2: 0.8, l4: 0.7, l5: 0.5, l6: 0.4, fb: 0.6, bright: 0.7, cD: 0.6, cS: 0.2, cR: 0.15, mD: 0.18, mS: 0 } },
    { name: "FM brass", values: { alg: 3, r1: 1, r2: 1, r3: 1, r4: 1, r5: 1, r6: 1, l2: 0.8, l4: 0.6, l5: 0.5, l6: 0.6, fb: 0.7, bright: 0.6, cA: 0.06, cS: 0.8, mA: 0.08, mD: 0.4, mS: 0.6 } },
    { name: "Drawbar organ", values: { alg: 7, r1: 0.5, r2: 1, r3: 1.5, r4: 2, r5: 3, r6: 4, l1: 0.8, l2: 0.9, l3: 0.6, l4: 0.7, l5: 0.5, l6: 0.4, fb: 0, cA: 0.003, cS: 1, cR: 0.05 } },
  ],
};

/* ------------------------------------------------------------------ */
/* West Coast: Buchla 200 series / Music Easel (1970s)                 */
/* ------------------------------------------------------------------ */
const westParams: ParamDef[] = [
  { id: "ratio", name: "Modulator ratio", min: 0.25, max: 8, def: 2, curve: "exp", unit: "x", group: "Complex oscillator" },
  { id: "modShape", name: "Modulator wave", min: 0, max: 2, def: 0, options: ["Sine", "Triangle", "Square"], group: "Complex oscillator" },
  { id: "fm", name: "FM index", min: 0, max: 1, def: 0.25, unit: "%", group: "Complex oscillator" },
  { id: "fmEnv", name: "Env to FM", min: 0, max: 1, def: 0.4, unit: "%", group: "Complex oscillator" },
  { id: "timbre", name: "Timbre (fold)", min: 0, max: 1, def: 0.35, unit: "%", group: "Wave folder" },
  { id: "timbreEnv", name: "Env to timbre", min: 0, max: 1, def: 0.4, unit: "%", group: "Wave folder" },
  { id: "sym", name: "Symmetry", min: -1, max: 1, def: 0, group: "Wave folder" },
  { id: "lpgMode", name: "Gate mode", min: 0, max: 2, def: 1, options: ["Low-pass", "Combo", "VCA"], group: "Low-pass gate" },
  { id: "vactrol", name: "Vactrol decay", min: 0.03, max: 2, def: 0.25, unit: "s", curve: "exp", group: "Low-pass gate" },
  { id: "attack", name: "Attack", min: 0.001, max: 2, def: 0.002, unit: "s", curve: "exp", group: "Envelope" },
  { id: "decay", name: "Decay", min: 0.01, max: 4, def: 0.25, unit: "s", curve: "exp", group: "Envelope" },
  { id: "sustain", name: "Sustain", min: 0, max: 1, def: 0, options: ["Off (strike)", "On (hold)"], group: "Envelope" },
];
const WP = indexOf(westParams);
class WestVoice extends Voice {
  car = new Osc(); mod = new Osc(); lpg = new LowPassGate(); env = 0; stage = 0;
  trigger() { this.stage = 1; }
  release() { this.stage = 3; }
  get active() { return this.stage !== 0 || this.lpg.level > 1e-4; }
  render(out: Float32Array, n: number, p: Float64Array, ctx: VoiceCtx) {
    const P = WP, rate = this.rate;
    const shape = Math.round(p[P.modShape]), hold = p[P.sustain] > 0.5, mode = Math.round(p[P.lpgMode]);
    const ca = 1 - Math.exp(-3 / (p[P.attack] * rate)), cd = Math.exp(-6.9 / (p[P.decay] * rate));
    for (let i = 0; i < n; i++) {
      if (this.stage === 1) { this.env += (1.2 - this.env) * ca; if (this.env >= 1) { this.env = 1; this.stage = hold ? 2 : 3; } }
      else if (this.stage === 3) { this.env *= cd; if (this.env < 1e-4) { this.env = 0; this.stage = 0; } }
      const base = this.hz(ctx, this.wander(3));
      this.mod.step(base * p[P.ratio], rate);
      const m = shape === 0 ? this.mod.sine() : shape === 1 ? this.mod.tri() : this.mod.pulse(0.5) * 0.7;
      const idx = (p[P.fm] + p[P.fmEnv] * this.env) * 2;
      this.car.step(base * (1 + idx * m), rate);
      const amt = Math.min(1, p[P.timbre] + p[P.timbreEnv] * this.env * (0.5 + 0.5 * this.vel));
      const x = fold(this.car.sine() * 0.9, amt, p[P.sym] * 0.5);
      out[i] += this.lpg.process(x * 0.6, this.env * (0.5 + 0.5 * this.vel), rate, p[P.vactrol], mode);
    }
  }
}
export const westCoast: MachineDef = {
  id: "west-coast", name: "West Coast", inspiredBy: "Buchla 259 / 292 and Music Easel (1970s)", kind: "poly", voices: 8, level: 0.59,
  about: "No subtractive filter: a complex oscillator (one oscillator frequency-modulating another), a wave folder that adds harmonics by folding the wave back on itself, and a vactrol low-pass gate that closes slowly, for plucked, woody, liquid tones.",
  params: westParams,
  createVoice: (rate, i) => new WestVoice(rate, i + 121),
  presets: [
    { name: "Bongo pluck", values: {} },
    { name: "Liquid lead", values: { ratio: 1.5, fm: 0.15, fmEnv: 0.2, timbre: 0.6, timbreEnv: 0.2, sustain: 1, decay: 0.8, vactrol: 0.4, attack: 0.02 } },
    { name: "Metal rain", values: { ratio: 3.7, fm: 0.5, fmEnv: 0.6, timbre: 0.2, sym: 0.4, decay: 0.15, vactrol: 0.6 } },
    { name: "Folded bass", values: { ratio: 0.5, fm: 0.1, timbre: 0.5, timbreEnv: 0.5, lpgMode: 1, decay: 0.5 } },
  ],
};

/* ------------------------------------------------------------------ */
/* String Machine: ARP Solina String Ensemble (1974)                   */
/* ------------------------------------------------------------------ */
const strParams: ParamDef[] = [
  { id: "violin", name: "Violin (8')", min: 0, max: 1, def: 0.8, unit: "%", group: "Voices" },
  { id: "viola", name: "Viola (4')", min: 0, max: 1, def: 0.3, unit: "%", group: "Voices" },
  { id: "cello", name: "Cello (16')", min: 0, max: 1, def: 0.6, unit: "%", group: "Voices" },
  { id: "horn", name: "Horn", min: 0, max: 1, def: 0, unit: "%", group: "Voices" },
  { id: "bright", name: "Brightness", min: 0, max: 1, def: 0.5, unit: "%", group: "Tone" },
  { id: "attack", name: "Crescendo", min: 0.005, max: 3, def: 0.25, unit: "s", curve: "exp", group: "Tone" },
  { id: "release", name: "Sustain", min: 0.05, max: 5, def: 1.2, unit: "s", curve: "exp", group: "Tone" },
  { id: "ensemble", name: "Ensemble", min: 0, max: 1, def: 0.8, unit: "%", group: "Ensemble" },
];
const SP = indexOf(strParams);
class StringVoice extends Voice {
  o = [new Osc(0.1), new Osc(0.4), new Osc(0.7)]; lp = new OnePole(); form = new Svf(); e = new Adsr(); nz = new Noise(31);
  trigger() { this.e.gate(true); }
  release() { this.e.gate(false); }
  get active() { return this.e.active; }
  render(out: Float32Array, n: number, p: Float64Array, ctx: VoiceCtx) {
    const P = SP, rate = this.rate;
    this.e.set(p[P.attack], 0.1, 1, p[P.release]);
    this.lp.set(800 + p[P.bright] ** 2 * 9000, rate);
    this.form.set(1100, rate, 0.4);
    const lv = [p[P.cello], p[P.violin], p[P.viola]], horn = p[P.horn];
    for (let i = 0; i < n; i++) {
      const base = this.hz(ctx);
      let x = 0;
      for (let k = 0; k < 3; k++) { this.o[k].step(base * 2 ** (k - 1), rate); x += this.o[k].saw() * lv[k]; }
      // Horn: a narrow pulse through a vocal-ish band-pass.
      if (horn > 0) { this.form.process(this.o[1].pulse(0.2)); x += this.form.bp * horn * 2; }
      out[i] += this.lp.lp(x * 0.25) * this.e.next(rate) * (0.8 + 0.2 * this.vel);
    }
  }
}
class StringFx { e: Ensemble; constructor(rate: number) { this.e = new Ensemble(rate); } process(L: Float32Array, R: Float32Array, n: number, p: Float64Array) { this.e.process(L, R, n, p[SP.ensemble]); } }
export const stringMachine: MachineDef = {
  id: "string-machine", name: "String Machine", inspiredBy: "ARP / Eminent Solina String Ensemble (1974)", kind: "poly", voices: 16, level: 0.92,
  about: "Bright saw 'registers' at three octaves, a slow crescendo and long sustain, and the three-line ensemble chorus that turns them into a section. Everything that made late-70s string pads.",
  params: strParams,
  createVoice: (rate, i) => new StringVoice(rate, i + 131),
  createFx: (rate) => new StringFx(rate),
  presets: [
    { name: "Ensemble strings", values: {} },
    { name: "Dark cellos", values: { violin: 0.3, viola: 0, cello: 1, bright: 0.25 } },
    { name: "Horn section", values: { horn: 0.8, violin: 0.3, cello: 0.2, attack: 0.08, release: 0.4 } },
  ],
};
