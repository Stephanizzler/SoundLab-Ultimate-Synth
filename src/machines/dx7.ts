// FM Six: the Yamaha DX7 (1983). Six operators in any of the 32 algorithms,
// each with ratio or fixed frequency, fine, detune, output level, a 4-rate /
// 4-level envelope, velocity and amplitude-modulation sensitivity; operator
// feedback; the LFO (six waves, delay, pitch and amplitude depth, key sync);
// the pitch envelope. Values use the DX7's own 0-99 scales. 16 voices.
// Not modelled: keyboard level and rate scaling, and the DX7's 12-bit DAC colour.
import { clamp, TAU } from "../dsp/util.ts";
import { Voice, indexOf, assignParams, type MachineDef, type ParamDef, type VoiceCtx } from "../engine/machine.ts";
import { opt, time, VLfo } from "./common.ts";

// The 32 algorithms: modulator → target pairs, carriers, and the feedback
// loop [from, to] (most feed an operator back into itself).
type Alg = { mods: [number, number][]; car: number[]; fb: [number, number] };
const A = (mods: [number, number][], car: number[], fb: [number, number]): Alg => ({ mods, car, fb });
const S1: [number, number][] = [[2, 1], [4, 3], [5, 4], [6, 5]], S3: [number, number][] = [[2, 1], [3, 2], [5, 4], [6, 5]];
const S5: [number, number][] = [[2, 1], [4, 3], [6, 5]], S7: [number, number][] = [[2, 1], [4, 3], [5, 3], [6, 5]];
const S10: [number, number][] = [[2, 1], [3, 2], [5, 4], [6, 4]], S12: [number, number][] = [[2, 1], [4, 3], [5, 3], [6, 3]];
const S14: [number, number][] = [[2, 1], [4, 3], [5, 4], [6, 4]], S16: [number, number][] = [[2, 1], [3, 1], [5, 1], [4, 3], [6, 5]];
const S26: [number, number][] = [[3, 2], [5, 4], [6, 4]];
export const DX_ALGORITHMS: Alg[] = [
  A(S1, [1, 3], [6, 6]), A(S1, [1, 3], [2, 2]), A(S3, [1, 4], [6, 6]), A(S3, [1, 4], [4, 6]),
  A(S5, [1, 3, 5], [6, 6]), A(S5, [1, 3, 5], [5, 6]), A(S7, [1, 3], [6, 6]), A(S7, [1, 3], [4, 4]),
  A(S7, [1, 3], [2, 2]), A(S10, [1, 4], [3, 3]), A(S10, [1, 4], [6, 6]), A(S12, [1, 3], [2, 2]),
  A(S12, [1, 3], [6, 6]), A(S14, [1, 3], [6, 6]), A(S14, [1, 3], [2, 2]), A(S16, [1], [6, 6]),
  A(S16, [1], [2, 2]), A([[2, 1], [3, 1], [4, 1], [5, 4], [6, 5]], [1], [3, 3]), A([[2, 1], [3, 2], [6, 4], [6, 5]], [1, 4, 5], [6, 6]), A([[3, 1], [3, 2], [5, 4], [6, 4]], [1, 2, 4], [3, 3]),
  A([[3, 1], [3, 2], [6, 4], [6, 5]], [1, 2, 4, 5], [3, 3]), A([[2, 1], [6, 3], [6, 4], [6, 5]], [1, 3, 4, 5], [6, 6]), A([[3, 2], [6, 4], [6, 5]], [1, 2, 4, 5], [6, 6]), A([[6, 3], [6, 4], [6, 5]], [1, 2, 3, 4, 5], [6, 6]),
  A([[6, 4], [6, 5]], [1, 2, 3, 4, 5], [6, 6]), A(S26, [1, 2, 4], [6, 6]), A(S26, [1, 2, 4], [3, 3]), A([[2, 1], [4, 3], [5, 4]], [1, 3, 6], [5, 5]),
  A([[4, 3], [6, 5]], [1, 2, 3, 5], [6, 6]), A([[4, 3], [5, 4]], [1, 2, 3, 6], [5, 5]), A([[6, 5]], [1, 2, 3, 4, 5], [6, 6]), A([], [1, 2, 3, 4, 5, 6], [6, 6]),
];
const SOURCES = DX_ALGORITHMS.map((a) => [0, 1, 2, 3, 4, 5, 6].map((op) => a.mods.filter(([, t]) => t === op).map(([m]) => m)));

const n99 = (id: string, name: string, def: number, group: string): ParamDef => ({ id, name, min: 0, max: 99, def, step: 1, group });
const LW = ["Triangle", "Saw down", "Saw up", "Square", "Sine", "Random (S&H)"] as const;
const opParams = (k: number): ParamDef[] => {
  const g = `Operator ${k}`, o = (s: string) => `o${k}${s}`;
  return [
    opt(o("On"), "On", ["Off", "On"], 1, g), opt(o("Mode"), "Mode", ["Ratio", "Fixed"], 0, g),
    { id: o("Coarse"), name: "Coarse", min: 0, max: 31, def: 1, step: 1, group: g }, n99(o("Fine"), "Fine", 0, g),
    { id: o("Det"), name: "Detune", min: -7, max: 7, def: 0, step: 1, group: g }, n99(o("Lvl"), "Output level", k === 1 ? 99 : 0, g),
    n99(o("R1"), "Rate 1", 99, g), n99(o("R2"), "Rate 2", 99, g), n99(o("R3"), "Rate 3", 99, g), n99(o("R4"), "Rate 4", 99, g),
    n99(o("L1"), "Level 1", 99, g), n99(o("L2"), "Level 2", 99, g), n99(o("L3"), "Level 3", 99, g), n99(o("L4"), "Level 4", 0, g),
    { id: o("Vel"), name: "Velocity sens", min: 0, max: 7, def: 0, step: 1, group: g }, { id: o("Ams"), name: "Amp mod sens", min: 0, max: 3, def: 0, step: 1, group: g },
  ];
};
const G = "Voice", L = "LFO", PE = "Pitch envelope";
const params: ParamDef[] = [
  opt("alg", "Algorithm", DX_ALGORITHMS.map((_, i) => String(i + 1)), 0, G), { id: "fb", name: "Feedback", min: 0, max: 7, def: 0, step: 1, group: G },
  opt("keySync", "Osc key sync", ["Off", "On"], 1, G), time("glide", "Portamento", 0.001, G, 0.001, 3), ...assignParams(0, G),
  n99("lfoSpeed", "Speed", 35, L), n99("lfoDelay", "Delay", 0, L), n99("lfoPmd", "Pitch mod depth", 0, L), n99("lfoAmd", "Amp mod depth", 0, L),
  opt("lfoSync", "Key sync", ["Off", "On"], 1, L), opt("lfoWave", "Wave", LW, 0, L), { id: "pms", name: "Pitch mod sens", min: 0, max: 7, def: 3, step: 1, group: L },
  n99("pR1", "Rate 1", 99, PE), n99("pR2", "Rate 2", 99, PE), n99("pR3", "Rate 3", 99, PE), n99("pR4", "Rate 4", 99, PE),
  n99("pL1", "Level 1", 50, PE), n99("pL2", "Level 2", 50, PE), n99("pL3", "Level 3", 50, PE), n99("pL4", "Level 4", 50, PE),
  ...[1, 2, 3, 4, 5, 6].flatMap(opParams),
];
const P = indexOf(params);
const OI = [1, 2, 3, 4, 5, 6].map((k) => Object.fromEntries(["On", "Mode", "Coarse", "Fine", "Det", "Lvl", "R1", "R2", "R3", "R4", "L1", "L2", "L3", "L4", "Vel", "Ams"].map((s) => [s, P[`o${k}${s}`]])));

// DX scales: level 0-99 in about 0.75 dB steps; rate 0-99 from about 40 s to 10 ms for a full sweep.
const lvlDb = (l: number) => (l - 99) * 0.75;
const sweep = (r: number) => 40 * 2 ** (-r / 8.25);
const PMS = [0, 0.1, 0.2, 0.35, 0.6, 1.1, 2.4, 6], AMS = [0, 4, 12, 30];

// One 4-rate / 4-level envelope, in level units (0-99).
class Eg {
  lv = 0; st = 4; // 0-2 heading for L1-L3, 3 releasing to L4, 4 idle
  on(fromL4: number, fresh: boolean) { if (fresh) this.lv = fromL4; this.st = 0; }
  off() { this.st = 3; }
  // inc: level units per sample for each stage's rate (rising moves 4x faster).
  step(inc: number[], Lv: number[]) {
    if (this.st >= 4) return this.lv;
    const target = Lv[this.st], rising = target > this.lv;
    const d = rising ? inc[this.st] * 4 : inc[this.st];
    if (rising) { this.lv = Math.min(target, this.lv + d); } else { this.lv = Math.max(target, this.lv - d); }
    if (this.lv === target && this.st < 2) this.st++;
    else if (this.lv === target && this.st === 3) this.st = 4;
    return this.lv;
  }
}

class DxVoice extends Voice {
  ph = new Float64Array(7); y = new Float64Array(7); fbPrev = [0, 0]; eg = Array.from({ length: 7 }, () => new Eg()); amp = new Float64Array(7);
  peg = new Eg(); lfo = new VLfo(7); held = 0; needSync = false;
  // A sounding voice restarts its envelopes from where they are, as a DX7 does;
  // an idle one starts from silence.
  trigger(legato: boolean) {
    if (legato) return;
    const idle = !this.active;
    for (let k = 1; k <= 6; k++) this.eg[k].on(0, idle);
    this.peg.on(50, true); this.held = 0; this.needSync = true;
  }
  release() { for (let k = 1; k <= 6; k++) this.eg[k].off(); this.peg.off(); }
  get active() {
    for (let k = 1; k <= 6; k++) if (this.eg[k].st < 4 || this.amp[k] > 1e-3) return true;
    return false;
  }
  render(out: Float32Array, n: number, p: Float64Array, ctx: VoiceCtx) {
    const rate = this.rate, ai = Math.round(p[P.alg]), alg = DX_ALGORITHMS[ai] ?? DX_ALGORITHMS[0], src = SOURCES[ai] ?? SOURCES[0];
    if (this.needSync) { if (p[P.keySync] > 0.5) this.ph.fill(0); if (p[P.lfoSync] > 0.5) this.lfo.reset(); this.needSync = false; }
    const car = new Array(7).fill(false); alg.car.forEach((c) => (car[c] = true));
    const fb = Math.round(p[P.fb]), fbAmt = fb === 0 ? 0 : Math.PI * 2 ** (fb - 7), [fbFrom, fbTo] = alg.fb;
    const norm = 1 / Math.sqrt(alg.car.length);
    // Operator settings for this block.
    const ops = [1, 2, 3, 4, 5, 6].map((k) => {
      const I = OI[k - 1], q = (s: string) => p[I[s]];
      const fixed = q("Mode") > 0.5, coarse = q("Coarse"), fine = q("Fine");
      const freq = fixed ? 10 ** (coarse % 4) * 10 ** (fine / 100) : (coarse === 0 ? 0.5 : coarse) * (1 + fine / 100);
      const velDb = -q("Vel") * (1 - this.vel) * 5;
      return { on: q("On") > 0.5, fixed, freq, det: 2 ** ((q("Det") * 0.5) / 1200), outDb: lvlDb(q("Lvl")) + velDb, zero: q("Lvl") === 0,
        inc: [q("R1"), q("R2"), q("R3"), q("R4")].map((r) => 99 / (sweep(r) * rate)), L: [q("L1"), q("L2"), q("L3"), q("L4")], ams: AMS[Math.round(q("Ams"))] };
    });
    const lw = LW[Math.round(p[P.lfoWave])], lfoHz = 0.062 * (49 / 0.062) ** (p[P.lfoSpeed] / 99), lfoDelay = (p[P.lfoDelay] / 99) ** 2 * 5;
    const pmd = (p[P.lfoPmd] / 99) * PMS[Math.round(p[P.pms])], amd = p[P.lfoAmd] / 99;
    const PR = [p[P.pR1], p[P.pR2], p[P.pR3], p[P.pR4]].map((r) => 99 / (sweep(r) * rate)), PL = [p[P.pL1], p[P.pL2], p[P.pL3], p[P.pL4]];
    const glide = p[P.glide], y = this.y, ph = this.ph, amp = this.amp;
    for (let i = 0; i < n; i++) {
      this.glideStep(glide); this.held++;
      const lfoFade = lfoDelay <= 0 ? 1 : Math.min(1, this.held / (lfoDelay * rate));
      const l = this.lfo.next(lfoHz, rate, lw) * lfoFade;
      const pitchEg = (this.peg.step(PR, PL) - 50) * 0.96;
      const baseHz = this.hz(ctx, pitchEg + l * (pmd + ctx.wheel * 0.5));
      const ampMod = (1 - l) * 0.5 * (amd + ctx.wheel * 0.3); // 0..amd, attenuating
      let sum = 0;
      for (let k = 6; k >= 1; k--) {
        const o = ops[k - 1];
        const lv = this.eg[k].step(o.inc, o.L);
        if ((i & 3) === 0) amp[k] = o.on && !o.zero ? 10 ** ((o.outDb + lvlDb(lv) - ampMod * o.ams) / 20) : 0;
        if (amp[k] === 0 && !car[k] && k !== fbFrom) { y[k] = 0; ph[k] += (o.fixed ? o.freq : baseHz * o.freq) * o.det / rate; if (ph[k] >= 1) ph[k] -= Math.floor(ph[k]); continue; }
        let mod = 0;
        const from = src[k];
        for (let j = 0; j < from.length; j++) mod += y[from[j]];
        if (k === fbTo) mod += fbAmt * (this.fbPrev[0] + this.fbPrev[1]) * 0.5;
        ph[k] += (o.fixed ? o.freq : baseHz * o.freq) * o.det / rate; if (ph[k] >= 1) ph[k] -= Math.floor(ph[k]);
        const s = Math.sin(TAU * ph[k] + mod) * amp[k];
        y[k] = car[k] ? s : s * 9; // modulators: output level as modulation index (radians)
        if (k === fbFrom) { this.fbPrev[1] = this.fbPrev[0]; this.fbPrev[0] = s; }
        if (car[k]) sum += s;
      }
      out[i] += clamp(sum * norm, -2, 2) * 0.55;
    }
  }
}

type Op = { r?: number; fixed?: number; fine?: number; det?: number; lvl: number; R?: number[]; L?: number[]; vel?: number; ams?: number };
function patch(globals: Record<string, number>, ops: (Op | null)[]): Record<string, number> {
  const v: Record<string, number> = { ...globals };
  ops.forEach((o, i) => {
    const k = i + 1, s = (x: string, val: number) => (v[`o${k}${x}`] = val);
    if (!o) { s("Lvl", 0); return; }
    if (o.fixed !== undefined) { s("Mode", 1); s("Coarse", o.fixed); } else { s("Coarse", o.r ?? 1); }
    s("Fine", o.fine ?? 0); s("Det", o.det ?? 0); s("Lvl", o.lvl); s("Vel", o.vel ?? 0); s("Ams", o.ams ?? 0);
    (o.R ?? [99, 99, 99, 99]).forEach((r, j) => s(`R${j + 1}`, r)); (o.L ?? [99, 99, 99, 0]).forEach((l, j) => s(`L${j + 1}`, l));
  });
  return v;
}
const EP_C = [96, 25, 25, 67], EP_L = [99, 75, 0, 0];
export const dx7: MachineDef = {
  id: "fm-six", name: "FM Six", inspiredBy: "Yamaha DX7 (1983)", kind: "poly", voices: 16, level: 0.45,
  about: "Six sine operators in all 32 DX7 algorithms. Each operator has ratio or fixed frequency (coarse, fine, detune), output level, its own four-rate / four-level envelope, velocity sensitivity and amplitude-modulation sensitivity; feedback follows each algorithm's loop. The LFO has six waves, delay, pitch and amplitude depth and key sync; the pitch envelope bends every operator. Values use the DX7's 0-99 scales. Keyboard level and rate scaling are not modelled.",
  params, glideParam: "glide",
  createVoice: (rate, i) => new DxVoice(rate, i + 111),
  presets: [
    { name: "Electric piano", values: patch({ alg: 4, fb: 6 }, [
      { r: 1, lvl: 99, R: EP_C, L: EP_L }, { r: 14, lvl: 60, R: [95, 50, 35, 78], L: [99, 75, 0, 0], vel: 4 },
      { r: 1, lvl: 99, R: EP_C, L: EP_L, det: 3 }, { r: 1, lvl: 86, R: [95, 20, 20, 50], L: [99, 95, 0, 0], vel: 3 },
      { r: 1, lvl: 95, R: [95, 29, 20, 50], L: [99, 95, 0, 0], det: -3 }, { r: 1, lvl: 72, R: [95, 29, 20, 50], L: [99, 95, 0, 0], vel: 2 }]) },
    { name: "Tubular bells", values: patch({ alg: 4, fb: 2 }, [
      { r: 1, lvl: 99, R: [95, 33, 71, 25], L: [99, 0, 32, 0] }, { r: 3, fine: 50, lvl: 76, R: [98, 12, 71, 28], L: [99, 0, 32, 0] },
      { r: 1, lvl: 95, det: 2, R: [95, 33, 71, 25], L: [99, 0, 32, 0] }, { r: 3, fine: 50, lvl: 74, det: 2, R: [98, 12, 71, 28], L: [99, 0, 32, 0] },
      { r: 0, fine: 0, lvl: 70, R: [76, 78, 71, 70], L: [99, 0, 0, 0] }, { r: 1, lvl: 60, R: [98, 91, 0, 28], L: [99, 0, 0, 0] }]) },
    { name: "Slap bass", values: patch({ alg: 15, fb: 7 }, [
      { r: 0, lvl: 99, R: [95, 62, 17, 58], L: [99, 85, 0, 0], vel: 2 }, { r: 0, lvl: 80, R: [99, 76, 34, 63], L: [99, 72, 0, 0], vel: 5 },
      { r: 1, lvl: 72, R: [99, 85, 30, 60], L: [99, 50, 0, 0], vel: 6 }, { r: 3, lvl: 66, R: [99, 70, 30, 60], L: [99, 50, 0, 0] },
      { r: 7, lvl: 55, R: [99, 80, 30, 60], L: [99, 40, 0, 0], vel: 7 }, { r: 1, lvl: 75, R: [99, 75, 30, 60], L: [99, 60, 0, 0] }]) },
    { name: "Brass", values: patch({ alg: 21, fb: 7, pR1: 84, pR2: 95, pR3: 95, pR4: 60, pL1: 49, pL2: 50, pL3: 50, pL4: 50 }, [
      { r: 1, lvl: 99, R: [72, 76, 99, 71], L: [99, 88, 96, 0], vel: 2 }, { r: 1, lvl: 79, R: [62, 51, 29, 71], L: [82, 95, 96, 0], vel: 2 },
      { r: 1, lvl: 99, det: -2, R: [72, 76, 99, 71], L: [99, 88, 96, 0] }, { r: 1, lvl: 99, det: 2, R: [72, 76, 99, 71], L: [99, 88, 96, 0] },
      { r: 1, lvl: 98, det: 1, R: [72, 76, 99, 71], L: [99, 88, 96, 0] }, { r: 1, lvl: 86, R: [53, 61, 15, 70], L: [99, 85, 79, 0], vel: 1 }]) },
    { name: "Marimba", values: patch({ alg: 6, fb: 0 }, [
      { r: 1, lvl: 99, R: [95, 58, 35, 62], L: [99, 0, 0, 0] }, { r: 3, fine: 10, lvl: 65, R: [99, 75, 40, 70], L: [99, 0, 0, 0], vel: 5 },
      { r: 4, lvl: 85, R: [95, 70, 35, 62], L: [99, 0, 0, 0] }, { r: 10, lvl: 60, R: [99, 85, 40, 70], L: [99, 0, 0, 0], vel: 5 }, null, null]) },
    { name: "Drawbar organ", values: patch({ alg: 31, fb: 0, lfoSpeed: 60, lfoPmd: 4 }, [
      { r: 0, lvl: 90, R: [99, 80, 99, 85], L: [99, 99, 99, 0] }, { r: 1, lvl: 92, R: [99, 80, 99, 85], L: [99, 99, 99, 0] },
      { r: 1, fine: 50, lvl: 80, R: [99, 80, 99, 85], L: [99, 99, 99, 0] }, { r: 2, lvl: 86, R: [99, 80, 99, 85], L: [99, 99, 99, 0] },
      { r: 3, lvl: 76, R: [99, 80, 99, 85], L: [99, 99, 99, 0] }, { r: 4, lvl: 74, R: [99, 80, 99, 85], L: [99, 99, 99, 0] }]) },
    { name: "Strings", values: patch({ alg: 1, fb: 5, lfoSpeed: 30, lfoDelay: 40, lfoPmd: 8 }, [
      { r: 1, lvl: 99, R: [45, 24, 20, 41], L: [99, 85, 85, 0] }, { r: 1, lvl: 70, det: 3, R: [75, 71, 17, 49], L: [82, 92, 62, 0] },
      { r: 1, lvl: 97, det: -3, R: [45, 24, 20, 41], L: [99, 85, 85, 0] }, { r: 3, lvl: 64, R: [62, 30, 20, 41], L: [99, 85, 70, 0] },
      { r: 1, lvl: 66, R: [62, 30, 20, 41], L: [99, 85, 70, 0] }, { r: 2, lvl: 58, R: [62, 30, 20, 41], L: [99, 85, 70, 0] }]) },
    { name: "Harmonica", values: patch({ alg: 17, fb: 6, lfoSpeed: 66, lfoPmd: 6 }, [
      { r: 1, lvl: 99, R: [70, 30, 30, 70], L: [99, 92, 90, 0], vel: 2 }, { r: 1, lvl: 72, R: [60, 30, 30, 70], L: [99, 90, 85, 0], vel: 3 },
      { r: 3, lvl: 62, R: [60, 30, 30, 70], L: [99, 90, 80, 0], vel: 3 }, { r: 2, lvl: 58, R: [60, 30, 30, 70], L: [99, 90, 80, 0] },
      { r: 5, lvl: 50, R: [60, 30, 30, 70], L: [99, 90, 80, 0] }, { r: 1, lvl: 66, R: [60, 30, 30, 70], L: [99, 90, 80, 0] }]) },
  ],
};
