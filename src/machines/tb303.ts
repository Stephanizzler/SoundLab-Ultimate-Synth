// Acid Bass: the Roland TB-303 Bass Line (1981). The whole panel is here:
// waveform, tuning, cutoff, resonance, env mod, decay and accent. Accent and
// slide come from the sequencer, as they did from the 303's own.
import { Osc } from "../dsp/osc.ts";
import { Cascade4, OnePole } from "../dsp/filters.ts";
import { tanh } from "../dsp/util.ts";
import { Voice, indexOf, type MachineDef, type ParamDef, type VoiceCtx } from "../engine/machine.ts";
import { cutoffHz } from "./common.ts";

/* ------------------------------------------------------------------ */
/* Acid Bass: Roland TB-303 (1981)                                     */
/* ------------------------------------------------------------------ */
const acidParams: ParamDef[] = [
  { id: "wave", name: "Waveform", min: 0, max: 1, def: 0, options: ["Saw", "Square"], group: "Bass line" },
  { id: "tune", name: "Tuning", min: -12, max: 12, def: 0, unit: "st", group: "Bass line" },
  { id: "cutoff", name: "Cutoff freq", min: 60, max: 5000, def: 450, unit: "Hz", curve: "exp", group: "Bass line" },
  { id: "res", name: "Resonance", min: 0, max: 1, def: 0.7, unit: "%", group: "Bass line" },
  { id: "envMod", name: "Env mod", min: 0, max: 1, def: 0.5, unit: "%", group: "Bass line" },
  { id: "decay", name: "Decay", min: 0.2, max: 2.5, def: 0.6, unit: "s", curve: "exp", group: "Bass line" },
  { id: "accent", name: "Accent", min: 0, max: 1, def: 0.6, unit: "%", group: "Bass line" },
  { id: "slide", name: "Slide time", min: 0.02, max: 0.3, def: 0.06, unit: "s", group: "Bass line" },
  { id: "dist", name: "Distortion", min: 0, max: 1, def: 0, unit: "%", group: "Bass line" },
];
const AC = indexOf(acidParams);
class AcidVoice extends Voice {
  o = new Osc(); f = new Cascade4("diode"); fenv = 0; aenv = 0; acc = 0; dcHp = new OnePole();
  trigger(legato: boolean) { if (!legato) this.fenv = 1; }
  release() {}
  get active() { return this.aenv > 1e-4 || this.gateOn; }
  render(out: Float32Array, n: number, p: Float64Array, ctx: VoiceCtx) {
    const P = AC, rate = this.rate;
    const sq = p[P.wave] > 0.5, k = p[P.res] * 3.95, envMod = p[P.envMod], accent = this.accent ? p[P.accent] : 0;
    // An accented note uses the shortest decay, as on the original.
    const fdec = Math.exp(-6.9 / ((accent > 0 ? 0.2 : p[P.decay]) * rate));
    const adec = Math.exp(-6.9 / (3 * rate)), arel = Math.exp(-6.9 / (0.008 * rate)), accC = 1 - Math.exp(-1 / (0.09 * rate));
    this.dcHp.set(40, rate);
    const dist = p[P.dist], dg = 1 + dist * 12, slide = p[P.slide], cutoff = p[P.cutoff];
    for (let i = 0; i < n; i++) {
      this.glideStep(slide);
      this.o.step(this.hz(ctx, p[P.tune]), rate);
      let x = sq ? this.o.pulse(0.5) * 0.8 + this.o.saw() * 0.2 : this.o.saw();
      x = this.dcHp.hp(x);
      this.fenv *= fdec;
      this.aenv = this.gateOn ? this.aenv + (1 - this.aenv) * 0.02 : this.aenv * arel;
      if (this.gateOn) this.aenv *= adec;
      // The accent "sweep" capacitor charges with each accented envelope, so repeated accents climb higher.
      this.acc += (this.fenv * accent - this.acc) * accC;
      if ((i & 3) === 0) {
        const oct = envMod * (0.3 + 3.2 * this.fenv) * (accent > 0 ? 0.6 : 1) + this.acc * 2.2 + (this.pitch - 48) / 48;
        this.f.set(cutoffHz(cutoff * (0.5 + envMod * 0.2), oct, rate), rate);
      }
      let y = this.f.process(x * 0.6, k * (0.7 + 0.3 * Math.min(1, cutoff / 800)), 1.6) * (1 + k * 0.4);
      y *= this.aenv * (1 + accent * 0.8);
      if (dist > 0) y = (tanh(y * dg) / Math.sqrt(dg)) * 1.2;
      out[i] += y;
    }
  }
}
export const tb303: MachineDef = {
  id: "acid-bass", name: "TeaBag-303", inspiredBy: "Roland TB-303 Bass Line (1981)", kind: "mono", voices: 1, level: 0.79,
  about: "One oscillator into a diode-ladder-style filter. The sequencer's accent and slide steps drive it like the original: accents shorten the filter decay and charge a sweep circuit, slides glide without retriggering.",
  params: acidParams, glideParam: "slide", slideOnly: true,
  createVoice: (rate, i) => new AcidVoice(rate, i + 61),
  presets: [
    { name: "Squelch", role: "bass", values: {} },
    { name: "Deep square", role: "bass", values: { wave: 1, cutoff: 250, res: 0.5, envMod: 0.35, decay: 1.2 } },
    { name: "Screaming acid", role: "bass", values: { cutoff: 700, res: 0.92, envMod: 0.8, accent: 1, dist: 0.6 } },
    { name: "Rubber", role: "bass", values: { cutoff: 180, res: 0.35, envMod: 0.6, decay: 0.3 } },
    { name: "Long decay squelch", role: "bass", values: { cutoff: 300, res: 0.8, envMod: 0.3, decay: 2.5, accent: 0.4 } },
    { name: "Distorted square", role: "bass", values: { wave: 1, cutoff: 600, res: 0.75, envMod: 0.55, dist: 0.8 } },
    { name: "Bright and thin", role: "bass", values: { cutoff: 1800, res: 0.5, envMod: 0.25, decay: 0.4 } },
    { name: "Bubbles", role: "bass", values: { cutoff: 120, res: 0.95, envMod: 0.9, decay: 0.25, accent: 0.9 } },
    { name: "Classic acid line", role: "bass", values: { cutoff: 350, res: 0.85, envMod: 0.7, decay: 0.5, accent: 0.8 } },
    { name: "Sub thump", role: "bass", values: { cutoff: 110, res: 0.2, envMod: 0.4, decay: 0.3 } },
    { name: "Hollow square", role: "bass", values: { wave: 1, cutoff: 500, res: 0.6, envMod: 0.4, decay: 0.5 } },
    { name: "Acid lead (+12)", role: "lead", values: { tune: 12, cutoff: 600, res: 0.85, envMod: 0.7, decay: 0.8, dist: 0.4 } },
  ],
};

