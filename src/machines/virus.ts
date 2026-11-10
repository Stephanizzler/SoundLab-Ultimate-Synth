// Super VA: the Access Virus (B/C generation, 1999-2002, with the TI's
// wavetables): three oscillators plus sub and noise, ring modulator, two
// multimode filters in four routings, saturation, two envelopes with
// sustain slope, three LFOs, unison, arpeggiator and chorus. 16 voices here.
import { Osc, Noise, SuperSaw } from "../dsp/osc.ts";
import { Svf, OnePole } from "../dsp/filters.ts";
import { Adsr } from "../dsp/env.ts";
import { JunoChorus } from "../dsp/fx.ts";
import { table, readTable, WAVETABLES } from "../dsp/wavetable.ts";
import { clamp, tanh, Rng } from "../dsp/util.ts";
import { Voice, indexOf, assignParams, arpParams, type MachineDef, type ParamDef, type VoiceCtx } from "../engine/machine.ts";
import { cutoffHz, sw, pct, opt, adsr, hzp, time, semi, bip, cents, VLfo } from "./common.ts";

const O1 = "Oscillator 1", O2 = "Oscillator 2", O3 = "Oscillator 3", MX = "Mixer", FI = "Filters", FE = "Filter envelope", AE = "Amp envelope", L1 = "LFO 1", L2 = "LFO 2", L3 = "LFO 3", V = "Common";
const LFO_W = ["Sine", "Triangle", "Saw up", "Square", "Random (S&H)", "Smooth random"] as const;
const MODES = ["Low-pass", "High-pass", "Band-pass", "Band-stop"] as const;
const SAT = ["Off", "Light", "Soft", "Middle", "Hard", "Digital", "Shaper", "Rectifier"] as const;
const params: ParamDef[] = [
  opt("o1Mode", "Model", ["Classic", "HyperSaw", "Wavetable"], 0, O1), pct("o1Shape", "Shape (sine–tri–saw–pulse) / wave", 0.66, O1),
  opt("o1Table", "Wavetable", WAVETABLES, 0, O1), pct("o1Pw", "Pulse width", 0.5, O1), semi("o1Semi", "Semitone", 0, O1, -48, 48, 1),
  { id: "density", name: "HyperSaw density", min: 1, max: 9, def: 7, step: 1, group: O1 }, pct("hsSpread", "HyperSaw spread", 0.45, O1),
  opt("o2Mode", "Model", ["Classic", "Wavetable"], 0, O2), pct("o2Shape", "Shape / wave", 0.66, O2), opt("o2Table", "Wavetable", WAVETABLES, 1, O2),
  pct("o2Pw", "Pulse width", 0.5, O2), semi("o2Semi", "Semitone", 0, O2, -48, 48, 1), cents("o2Detune", "Detune", 8, O2),
  pct("fm", "FM amount", 0, O2), sw("sync", "Sync", 0, O2), bip("fEnvPitch", "Filter env → pitch", 0, O2), pct("fEnvFm", "Filter env → FM", 0, O2),
  opt("o3Mode", "Model", ["Off", "Slave (osc 2)", "Saw", "Pulse", "Sine", "Triangle"], 0, O3), semi("o3Semi", "Semitone", 0, O3, -48, 48, 1), cents("o3Detune", "Detune", 0, O3), pct("o3Vol", "Volume", 0.5, O3),
  pct("bal", "Osc balance (1 ↔ 2)", 0.5, MX), pct("sub", "Sub osc", 0, MX), opt("subShape", "Sub shape", ["Square", "Triangle"], 0, MX),
  pct("noise", "Noise", 0, MX), pct("noiseColor", "Noise colour", 0.5, MX), pct("ring", "Ring modulator", 0, MX),
  opt("f1Mode", "Filter 1 mode", MODES, 0, FI), opt("f2Mode", "Filter 2 mode", MODES, 0, FI), opt("route", "Routing", ["Serial 4", "Serial 6", "Parallel 4", "Split"], 0, FI),
  hzp("cutoff", "Cutoff", 2500, FI), bip("cutoff2", "Cutoff 2 offset", 0, FI), pct("res", "Resonance", 0.25, FI), pct("res2", "Resonance 2", 0.1, FI),
  bip("envAmt", "Env amount", 0.35, FI), bip("env2Amt", "Env amount 2", 0.2, FI), pct("kbd", "Key follow", 0.4, FI), pct("fBal", "Filter balance", 0.5, FI),
  opt("satCurve", "Saturation curve", SAT, 1, FI), pct("satDrive", "Saturation drive", 0.3, FI),
  ...adsr("f", FE, 0.005, 0.5, 0.4, 0.4), bip("fSlope", "Sustain slope", 0, FE),
  ...adsr("a", AE, 0.005, 0.5, 0.8, 0.5), bip("aSlope", "Sustain slope", 0, AE),
  hzp("l1Rate", "Rate", 2, L1, 0.02, 30), opt("l1Wave", "Shape", LFO_W, 1, L1), bip("l1Osc", "→ osc 1 + 2 pitch", 0, L1), pct("l1Pw", "→ pulse width", 0, L1), bip("l1Cut", "→ cutoff 1", 0, L1),
  hzp("l2Rate", "Rate", 0.5, L2, 0.02, 30), opt("l2Wave", "Shape", LFO_W, 0, L2), bip("l2Shape", "→ osc shape", 0, L2), bip("l2Cut", "→ cutoff 2", 0, L2), bip("l2Pan", "→ panorama", 0, L2),
  hzp("l3Rate", "Rate", 5.5, L3, 0.02, 30), opt("l3Wave", "Shape", LFO_W, 0, L3), pct("l3Osc", "→ pitch (vibrato)", 0, L3), time("l3Fade", "Fade in", 0.001, L3, 0.001, 5),
  pct("velCut", "Velocity → cutoff", 0.3, V), pct("velVol", "Velocity → volume", 0.3, V), time("glide", "Portamento", 0.001, V, 0.001, 3),
  ...assignParams(0, V), ...arpParams("Arpeggiator", 4), opt("chorus", "Chorus", ["Off", "Light", "Deep"], 1, "Effects"),
];
const P = indexOf(params);

// Classic oscillator: one knob morphs sine → triangle → saw → pulse.
function classicWave(o: Osc, j: number, pw: number) { return j === 0 ? o.sine() : j === 1 ? o.tri() : j === 2 ? o.saw() : o.pulse(pw); }
function classic(o: Osc, shape: number, pw: number) {
  const x = clamp(shape, 0, 1) * 3, k = Math.min(2, Math.floor(x)), f = x - k;
  return f < 1e-6 ? classicWave(o, k, pw) : classicWave(o, k, pw) * (1 - f) + classicWave(o, k + 1, pw) * f;
}
function saturate(x: number, curve: number, drive: number) {
  const g = 1 + drive * 8;
  switch (curve) {
    case 1: return tanh(x * (1 + drive * 2));
    case 2: return tanh(x * g) / Math.sqrt(g);
    case 3: return Math.max(-1, Math.min(1, x * g)) * 0.7;
    case 4: { const y = x * g * 1.5; return (y > 1 ? 1 : y < -1 ? -1 : y - (y * y * y) / 3) * 0.8; }
    case 5: return Math.round(x * (32 - drive * 28)) / (32 - drive * 28);
    case 6: return Math.sin(x * g * 1.2) * 0.8;
    case 7: return (Math.abs(x * g) - 0.3) * 0.8;
    default: return x;
  }
}
function filt(f: Svf, mode: number) { return mode === 0 ? f.lp : mode === 1 ? f.hp : mode === 2 ? f.bp : f.notch; }

class VirusVoice extends Voice {
  ss: SuperSaw; o1 = new Osc(); o2 = new Osc(0.3); o3 = new Osc(0.6); sub = new Osc(); nz = new Noise(71); nlp = new OnePole();
  f1a = new Svf(); f1b = new Svf(); f2 = new Svf(); fe = new Adsr(); ae = new Adsr(); l1 = new VLfo(1); l2 = new VLfo(2); l3 = new VLfo(3);
  held = 0; basePan = 0;
  constructor(rate: number, seed: number) { super(rate, seed); this.ss = new SuperSaw(new Rng(seed * 31 + 1)); }
  trigger() { this.fe.gate(true); this.ae.gate(true); this.held = 0; this.basePan = this.pan; }
  release() { this.fe.gate(false); this.ae.gate(false); }
  get active() { return this.ae.active; }
  render(out: Float32Array, n: number, p: Float64Array, ctx: VoiceCtx) {
    const rate = this.rate, m1 = Math.round(p[P.o1Mode]), m2 = Math.round(p[P.o2Mode]), m3 = Math.round(p[P.o3Mode]);
    const t1 = table(Math.round(p[P.o1Table])), t2 = table(Math.round(p[P.o2Table]));
    const route = Math.round(p[P.route]), mode1 = Math.round(p[P.f1Mode]), mode2 = Math.round(p[P.f2Mode]), sat = Math.round(p[P.satCurve]);
    const vc = p[P.velCut] * (this.vel - 0.5) * 3, vv = 1 - p[P.velVol] + p[P.velVol] * this.vel;
    // Sustain slope: the sustain level rises or falls while the key is held.
    const heldSec = this.held / rate;
    this.fe.set(p[P.fA], p[P.fD], clamp(p[P.fS] + p[P.fSlope] * heldSec * 0.25, 0, 1), p[P.fR]);
    this.ae.set(p[P.aA], p[P.aD], clamp(p[P.aS] + p[P.aSlope] * heldSec * 0.25, 0, 1), p[P.aR]);
    const w1 = LFO_W[Math.round(p[P.l1Wave])], w2 = LFO_W[Math.round(p[P.l2Wave])], w3 = LFO_W[Math.round(p[P.l3Wave])];
    this.nlp.set(300 + p[P.noiseColor] ** 2 * 18000, rate);
    const glide = p[P.glide], cutoff = p[P.cutoff];
    // Frequency ratios once per block.
    const r1 = 2 ** (p[P.o1Semi] / 12), r2 = 2 ** ((p[P.o2Semi] + p[P.o2Detune] / 100) / 12), r3 = 2 ** ((p[P.o3Semi] + p[P.o3Detune] / 100) / 12);
    const envPitch = p[P.fEnvPitch] * 24;
    for (let i = 0; i < n; i++) {
      this.glideStep(glide); this.held++;
      const fe = this.fe.next(rate);
      const l1 = this.l1.next(p[P.l1Rate], rate, w1), l2 = this.l2.next(p[P.l2Rate], rate, w2);
      const l3 = this.l3.next(p[P.l3Rate], rate, w3) * Math.min(1, this.held / (p[P.l3Fade] * rate));
      const vib = l1 * p[P.l1Osc] * 2 + l3 * (p[P.l3Osc] * 1 + ctx.wheel * 0.5);
      const shapeMod = l2 * p[P.l2Shape] * 0.5;
      const base = this.hz(ctx, vib + this.wander(1.5));
      // Osc 1, then osc 2, which syncs to osc 1 and is frequency-modulated by it.
      let a: number;
      this.o1.step(base * r1, rate);
      const pw1 = clamp(p[P.o1Pw] + l1 * p[P.l1Pw] * 0.45, 0.03, 0.97);
      if (m1 === 1) a = this.ss.render(base * r1, rate, p[P.density], p[P.hsSpread]) * 0.45;
      else if (m1 === 2) a = readTable(t1, p[P.o1Shape] + shapeMod, this.o1.phase, this.o1.dt);
      else a = classic(this.o1, p[P.o1Shape] + shapeMod, pw1);
      const fm = (p[P.fm] + fe * p[P.fEnvFm]) * 3;
      this.o2.step(base * r2 * (envPitch !== 0 ? 2 ** ((fe * envPitch) / 12) : 1) * (fm !== 0 ? 1 + fm * this.o1.sine() : 1), rate);
      if (p[P.sync] > 0.5) this.o2.syncTo(this.o1);
      const b = m2 === 1 ? readTable(t2, p[P.o2Shape] + shapeMod, this.o2.phase, this.o2.dt) : classic(this.o2, p[P.o2Shape] + shapeMod, p[P.o2Pw]);
      let c = 0;
      if (m3 > 0) {
        this.o3.step(base * r3, rate);
        c = (m3 === 1 ? this.o3.saw() * 0.5 + b * 0.5 : m3 === 2 ? this.o3.saw() : m3 === 3 ? this.o3.pulse(0.5) : m3 === 4 ? this.o3.sine() : this.o3.tri()) * p[P.o3Vol];
      }
      this.sub.step(base * r1 * 0.5, rate);
      const sub = (p[P.subShape] > 0.5 ? this.sub.tri() : this.sub.pulse(0.5)) * p[P.sub];
      const nz = this.nlp.lp(this.nz.white()) * p[P.noise] * 1.5;
      const ring = a * b * p[P.ring];
      const bal = p[P.bal];
      if ((i & 3) === 0) {
        const oct = p[P.envAmt] * 6 * fe + p[P.kbd] * (this.pitch - 60) / 12 + vc + l1 * p[P.l1Cut] * 2;
        const hz1 = cutoffHz(cutoff, oct, rate), hz2 = cutoffHz(cutoff, p[P.env2Amt] * 6 * fe + p[P.kbd] * (this.pitch - 60) / 12 + vc + p[P.cutoff2] * 4 + l2 * p[P.l2Cut] * 2, rate);
        this.f1a.set(hz1, rate, p[P.res] * 0.95); this.f1b.set(hz1, rate, p[P.res] * 0.6); this.f2.set(hz2, rate, p[P.res2] * 0.95);
      }
      let y: number;
      if (route === 3) {
        // Split: osc 1 through filter 1, osc 2 through filter 2.
        this.f1a.process(saturate((a * (1 - bal) + sub + nz * 0.5) * 0.35, sat, p[P.satDrive]));
        this.f2.process((b * bal + c + ring + nz * 0.5) * 0.35);
        y = filt(this.f1a, mode1) * (1 - p[P.fBal]) * 2 + filt(this.f2, mode2) * p[P.fBal] * 2;
      } else {
        const x = (a * (1 - bal) + b * bal + c + sub + nz + ring) * 0.35;
        this.f1a.process(x);
        let y1 = filt(this.f1a, mode1);
        if (route === 1) { this.f1b.process(y1); y1 = filt(this.f1b, mode1); } // Serial 6: filter 1 as 4-pole
        if (route === 2) { this.f2.process(x); y = filt(this.f1a, mode1) * (1 - p[P.fBal]) * 2 + filt(this.f2, mode2) * p[P.fBal] * 2; }
        else { this.f2.process(saturate(y1, sat, p[P.satDrive])); y = filt(this.f2, mode2); }
      }
      if (route >= 2) y = saturate(y, sat, p[P.satDrive] * 0.5);
      out[i] += y * this.ae.next(rate) * vv;
      if (i === 0) this.pan = clamp(this.basePan + l2 * p[P.l2Pan], -1, 1); // LFO 2 → panorama, once per block
    }
  }
}
class VirusFx { c: JunoChorus; constructor(rate: number) { this.c = new JunoChorus(rate); } process(L: Float32Array, R: Float32Array, n: number, p: Float64Array) { this.c.process(L, R, n, Math.round(p[P.chorus])); } }

export const virus: MachineDef = {
  id: "super-va", name: "Super VA", inspiredBy: "Access Virus B / C / TI (1999-2005)", kind: "poly", voices: 16, level: 1.08,
  about: "Three oscillators: osc 1 Classic (one knob morphs sine, triangle, saw and pulse), HyperSaw (up to nine detuned saws) or Wavetable; osc 2 Classic or Wavetable with sync, FM from osc 1 and filter-envelope pitch and FM; osc 3 (slave, saw, pulse, sine, triangle). Sub, coloured noise and ring modulator. Two multimode filters (low, high, band, band-stop) routed Serial 4, Serial 6, Parallel or Split, with eight saturation curves; envelopes with sustain slope; three LFOs; unison with detune and spread; arpeggiator; chorus. Multi mode is the rack itself: give slots their own MIDI channels.",
  params, glideParam: "glide",
  createVoice: (rate, i) => new VirusVoice(rate, i + 71),
  createFx: (rate) => new VirusFx(rate),
  presets: [
    { name: "Trance HyperSaw", values: { o1Mode: 1, bal: 0, sub: 0.15, cutoff: 6000, res: 0.15, envAmt: 0.1, aA: 0.01, aR: 0.6, assign: 0 } },
    { name: "Wavetable pluck", values: { o1Mode: 2, o1Table: 0, o1Shape: 0.1, bal: 0.5, o2Mode: 1, cutoff: 1800, envAmt: 0.6, fD: 0.3, fS: 0, aD: 0.5, aS: 0 } },
    { name: "Vocal pad", values: { o1Mode: 2, o1Table: 2, o1Shape: 0.2, l2Shape: 0.6, l2Rate: 0.2, fA: 1.5, fD: 3, aA: 0.8, aR: 2, cutoff: 3000, chorus: 2 } },
    { name: "Hard bass", values: { o1Shape: 1, o1Pw: 0.3, sub: 0.8, bal: 0.2, cutoff: 500, res: 0.4, route: 1, satCurve: 4, satDrive: 0.7, envAmt: 0.5, fD: 0.25, fS: 0.1, chorus: 0, assign: 2 } },
    { name: "Sync lead", values: { sync: 1, bal: 1, o2Semi: 7, fEnvPitch: 0.6, fD: 0.6, fS: 0.2, cutoff: 5000, assign: 1, uniDetune: 8, glide: 0.04 } },
    { name: "FM bell", values: { o1Shape: 0, o2Shape: 0, bal: 1, o2Semi: 19, fm: 0.4, fEnvFm: 0.5, fD: 1.5, fS: 0, cutoff: 9000, aD: 2, aS: 0, aR: 1.5 } },
    { name: "Unison stab", values: { assign: 1, uniDetune: 22, spread: 1, o1Shape: 0.66, o2Shape: 0.66, o2Detune: 12, cutoff: 2500, envAmt: 0.4, fD: 0.35, fS: 0.2, aD: 0.6, aS: 0.3 } },
    { name: "Arp split", values: { arp: 1, arpRange: 2, route: 3, f1Mode: 0, f2Mode: 1, cutoff: 1500, res: 0.6, envAmt: 0.5, fD: 0.2, fS: 0, aD: 0.3, aS: 0 } },
  ],
};
