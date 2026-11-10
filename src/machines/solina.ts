// String Machine: the ARP / Eminent Solina String Ensemble (1974). Six
// voice tabs (violin, viola, trumpet, horn, cello, contrabass), crescendo and
// sustain, the ensemble chorus, and fine tune. Fully polyphonic, as its
// divide-down design was (24 voices here). Contrabass sounds only on the
// lower half of the keyboard, as on the original.
import { Osc } from "../dsp/osc.ts";
import { OnePole, Svf } from "../dsp/filters.ts";
import { Adsr } from "../dsp/env.ts";
import { Ensemble } from "../dsp/fx.ts";
import { Voice, indexOf, type MachineDef, type ParamDef, type VoiceCtx } from "../engine/machine.ts";
import { sw, pct, time, cents } from "./common.ts";

const VT = "Voices", E = "Expression", EN = "Ensemble";
const params: ParamDef[] = [
  sw("violin", "Violin", 1, VT), sw("viola", "Viola", 0, VT), sw("trumpet", "Trumpet", 0, VT), sw("horn", "Horn", 0, VT), sw("cello", "Cello", 1, VT), sw("bass", "Contrabass", 0, VT),
  time("cresc", "Crescendo", 0.25, E, 0.005, 3), time("sustain", "Sustain", 1.2, E, 0.05, 5), cents("fine", "Fine tune", 0, E),
  sw("ensOn", "Ensemble", 1, EN), pct("ens", "Ensemble depth", 0.8, EN),
];
const P = indexOf(params);

class SolinaVoice extends Voice {
  o8 = new Osc(0.1); o4 = new Osc(0.4); o16 = new Osc(0.7); lpV = new OnePole(); lpA = new OnePole(); lpC = new OnePole(); lpB = new OnePole(); hpV = new OnePole();
  tr = new Svf(); hn = new Svf(); e = new Adsr();
  trigger() { this.e.gate(true); }
  release() { this.e.gate(false); }
  get active() { return this.e.active; }
  render(out: Float32Array, n: number, p: Float64Array, ctx: VoiceCtx) {
    const rate = this.rate, on = (k: number) => p[k] > 0.5;
    this.e.set(p[P.cresc], 0.1, 1, p[P.sustain]);
    this.lpV.set(5500, rate); this.hpV.set(250, rate); this.lpA.set(3200, rate); this.lpC.set(2500, rate); this.lpB.set(700, rate);
    this.tr.set(1300, rate, 0.55); this.hn.set(650, rate, 0.45);
    const vio = on(P.violin), via = on(P.viola), trp = on(P.trumpet), hor = on(P.horn), cel = on(P.cello), bas = on(P.bass) && this.note < 60;
    for (let i = 0; i < n; i++) {
      const base = this.hz(ctx, p[P.fine] / 100);
      this.o16.step(base * 0.5, rate); this.o8.step(base, rate); this.o4.step(base * 2, rate);
      const s8 = this.o8.saw(), s4 = this.o4.saw(), s16 = this.o16.saw();
      let x = 0;
      if (vio) x += this.lpV.lp(this.hpV.hp(s8 + 0.5 * s4)) * 0.9; // bright 8' + 4'
      if (via) x += this.lpA.lp(s8) * 0.8; // darker 8'
      if (cel) x += this.lpC.lp(s16 + 0.4 * s8) * 0.8; // 16' + 8'
      if (bas) x += this.lpB.lp(s16) * 1.2; // 16' only, lower half
      if (trp) { this.tr.process(this.o8.pulse(0.25)); x += this.tr.bp * 2; } // brass formant
      if (hor) { this.hn.process(this.o16.pulse(0.3)); x += this.hn.bp * 2; }
      out[i] += x * 0.22 * this.e.next(rate);
    }
  }
}
class SolinaFx { e: Ensemble; constructor(rate: number) { this.e = new Ensemble(rate); } process(L: Float32Array, R: Float32Array, n: number, p: Float64Array) { if (p[P.ensOn] > 0.5) this.e.process(L, R, n, p[P.ens]); } }

export const solina: MachineDef = {
  id: "string-machine", name: "Saline Ensemble", inspiredBy: "ARP / Eminent Solina String Ensemble (1974)", kind: "poly", voices: 24, level: 0.92,
  about: "Divide-down sawtooth registers voiced as violin (bright 8' and 4'), viola, cello (16' and 8'), contrabass (16', lower half only), trumpet and horn (pulse waves through brass formants), each switched on or off like the original's tabs; crescendo and sustain; and the three-line ensemble chorus that turns them into a section.",
  params,
  createVoice: (rate, i) => new SolinaVoice(rate, i + 131),
  createFx: (rate) => new SolinaFx(rate),
  presets: [
    { name: "Ensemble strings", values: {} },
    { name: "Dark cellos", values: { violin: 0, cello: 1, bass: 1, ens: 0.7 } },
    { name: "Horn section", values: { violin: 0, cello: 0, horn: 1, trumpet: 1, cresc: 0.08, sustain: 0.4 } },
    { name: "Full ensemble", values: { violin: 1, viola: 1, cello: 1, bass: 1, trumpet: 0, horn: 1 } },
    { name: "Dry violins", values: { cello: 0, ensOn: 0, cresc: 0.05 } },
    { name: "Slow swell", values: { viola: 1, cresc: 2.2, sustain: 3 } },
    { name: "Brass and strings", values: { trumpet: 1, ens: 1 } },
    { name: "Viola solo", values: { violin: 0, cello: 0, viola: 1, ens: 0.4, cresc: 0.15 } },
  ],
};
