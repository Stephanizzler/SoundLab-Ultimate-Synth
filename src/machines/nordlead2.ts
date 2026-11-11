// Lead VA: the Clavia Nord Lead 2 (1997): Oscillators, Mod env, LFO 1,
// LFO 2 / Arpeggiator, Filter (with distortion and velocity), envelopes,
// mono/legato/unison and portamento. 16 voices. Its four-slot multitimbral
// mode is the rack: give slots their own MIDI channels.
import { Osc, Noise } from "../dsp/osc.ts";
import { Svf } from "../dsp/filters.ts";
import { Adsr } from "../dsp/env.ts";
import { clamp, tanh } from "../dsp/util.ts";
import { Voice, indexOf, assignParams, arpParams, type MachineDef, type ParamDef, type VoiceCtx } from "../engine/machine.ts";
import { cutoffHz, sw, pct, opt, adsr, hzp, time, semi, bip, cents, VLfo } from "./common.ts";

const O = "Oscillators", ME = "Mod env", L1 = "LFO 1", L2 = "LFO 2", F = "Filter", V = "Voice";
const L1W = ["Triangle", "Saw up", "Square", "Random (S&H)", "Smooth random"] as const;
const params: ParamDef[] = [
  opt("w1", "Osc 1 waveform", ["Pulse", "Sawtooth", "Triangle", "Sine"], 1, O), pct("fm", "FM amount (osc 2 → 1)", 0, O),
  opt("w2", "Osc 2 waveform", ["Pulse", "Sawtooth", "Triangle", "Noise"], 1, O), semi("semi", "Osc 2 semitones", 12, O, -12, 60, 1), cents("fine", "Osc 2 fine tune", 0, O),
  sw("sync", "Sync", 1, O), sw("kbd2", "Osc 2 keyboard track", 1, O), pct("pw", "Pulse width", 0.5, O), pct("mix", "Osc mix (1 ↔ 2)", 0.6, O),
  time("meA", "Attack", 0.001, ME, 0.001, 5), time("meD", "Decay", 0.6, ME, 0.005, 5), bip("meAmt", "Amount", 0.5, ME),
  opt("meDest", "Destination", ["Osc 2 pitch", "FM amount", "Pulse width"], 0, ME),
  hzp("l1Rate", "Rate", 5, L1, 0.02, 50), opt("l1Wave", "Waveform", L1W, 0, L1), pct("l1Amt", "Amount", 0, L1),
  opt("l1Dest", "Destination", ["Osc 1 + 2", "Osc 2", "Filter", "Pulse width", "FM amount"], 0, L1),
  hzp("l2Rate", "Rate", 3, L2, 0.02, 50), pct("l2Amt", "Amount", 0, L2), opt("l2Dest", "Destination", ["Amp", "Osc 1 + 2", "Filter", "FM amount"], 1, L2),
  ...arpParams("Arpeggiator", 4),
  opt("fType", "Filter type", ["LP 12", "LP 24", "Band-pass", "High-pass", "Notch + LP"], 1, F),
  hzp("cutoff", "Cutoff frequency", 2500, F), pct("res", "Resonance", 0.3, F), pct("envAmt", "Env amount", 0.4, F),
  sw("velF", "Velocity", 0, F), opt("kbd", "Keyboard track", ["Off", "1/3", "2/3", "1"], 2, F), sw("dist", "Distortion", 0, F),
  ...adsr("f", "Filter envelope", 0.002, 0.5, 0.3, 0.3),
  ...adsr("a", "Amp envelope", 0.002, 0.5, 0.9, 0.3), sw("velA", "Amp velocity", 0, "Amp envelope"),
  time("glide", "Portamento", 0.001, V, 0.001, 3), opt("octave", "Octave shift", ["−2", "−1", "0", "+1", "+2"], 2, V), ...assignParams(0, V),
];
const P = indexOf(params);

class NordVoice extends Voice {
  a = new Osc(); b = new Osc(0.2); nz = new Noise(13); f1 = new Svf(); f2 = new Svf(); fe = new Adsr(); ae = new Adsr(); me = new Adsr();
  l1 = new VLfo(5); l2 = new VLfo(6); bSine = 0;
  trigger() { this.fe.gate(true); this.ae.gate(true); this.me.gate(true); }
  release() { this.fe.gate(false); this.ae.gate(false); this.me.gate(false); }
  get active() { return this.ae.active; }
  render(out: Float32Array, n: number, p: Float64Array, ctx: VoiceCtx) {
    const rate = this.rate;
    const w1 = Math.round(p[P.w1]), w2 = Math.round(p[P.w2]), sync = p[P.sync] > 0.5, kbd2 = p[P.kbd2] > 0.5, mix = p[P.mix];
    const ft = Math.round(p[P.fType]), res = p[P.res], kbd = Math.round(p[P.kbd]) / 3, dist = p[P.dist] > 0.5;
    const env = p[P.envAmt] * 6 * (p[P.velF] > 0.5 ? this.vel : 1), amp = p[P.velA] > 0.5 ? 0.3 + 0.7 * this.vel : 1;
    const meDest = Math.round(p[P.meDest]), l1Dest = Math.round(p[P.l1Dest]), l2Dest = Math.round(p[P.l2Dest]), l1W = L1W[Math.round(p[P.l1Wave])];
    const oct = (Math.round(p[P.octave]) - 2) * 12;
    this.fe.set(p[P.fA], p[P.fD], p[P.fS], p[P.fR]); this.ae.set(p[P.aA], p[P.aD], p[P.aS], p[P.aR]); this.me.set(p[P.meA], p[P.meD], 0, p[P.meD]);
    const glide = p[P.glide], cutoff = p[P.cutoff];
    for (let i = 0; i < n; i++) {
      this.glideStep(glide);
      const me = this.me.next(rate) * p[P.meAmt];
      const l1 = this.l1.next(p[P.l1Rate], rate, l1W) * p[P.l1Amt], l2 = this.l2.next(p[P.l2Rate], rate, "Triangle") * p[P.l2Amt];
      const vib = (l1Dest === 0 ? l1 * 2 : 0) + (l2Dest === 1 ? l2 * 2 : 0) + ctx.wheel * l1 * 0.5;
      const base = this.hz(ctx, oct + vib + this.wander(1.5));
      const fm = clamp(p[P.fm] + (meDest === 1 ? me : 0) + (l1Dest === 4 ? l1 * 0.5 : 0) + (l2Dest === 3 ? l2 * 0.5 : 0), 0, 1) * 4;
      const pw = clamp(p[P.pw] + (meDest === 2 ? me * 0.45 : 0) + (l1Dest === 3 ? l1 * 0.45 : 0), 0.03, 0.97);
      this.a.step(base * (1 + fm * this.bSine), rate);
      const ao = w1 === 0 ? this.a.pulse(pw) : w1 === 1 ? this.a.saw() : w1 === 2 ? this.a.tri() : this.a.sine();
      const o2 = p[P.semi] - 12 + p[P.fine] / 100 + (meDest === 0 ? me * 48 : 0) + (l1Dest === 1 ? l1 * 2 : 0);
      this.b.step(kbd2 ? base * 2 ** (o2 / 12) : 261.63 * 2 ** ((o2 + oct) / 12), rate);
      if (sync) this.b.syncTo(this.a);
      const bo = w2 === 0 ? this.b.pulse(pw) : w2 === 1 ? this.b.saw() : w2 === 2 ? this.b.tri() : this.nz.white();
      this.bSine = this.b.sine();
      let x = ao * (1 - mix) + bo * mix;
      if (dist) x = tanh(x * 4) * 0.7;
      const fe = this.fe.next(rate);
      if ((i & 3) === 0) {
        const hz = cutoffHz(cutoff, env * fe + kbd * (this.pitch - 60) / 12 + (l1Dest === 2 ? l1 * 2 : 0) + (l2Dest === 2 ? l2 * 2 : 0), rate);
        this.f1.set(hz, rate, res * (ft === 1 ? 0.85 : 0.97)); if (ft === 1) this.f2.set(hz, rate, res * 0.6);
      }
      this.f1.process(x * 0.35);
      const y = ft === 0 ? this.f1.lp : ft === 1 ? this.f2.process(this.f1.lp) : ft === 2 ? this.f1.bp : ft === 3 ? this.f1.hp : 0.5 * (this.f1.notch + this.f1.lp);
      out[i] += y * this.ae.next(rate) * amp * (l2Dest === 0 ? 1 + l2 * 0.8 : 1);
    }
  }
}

export const nordLead2: MachineDef = {
  id: "lead-va", name: "Nerd Lead 2", inspiredBy: "Clavia Nord Lead 2 (1997)", kind: "poly", voices: 16, level: 0.57,
  about: "Osc 1 (pulse, saw, triangle, sine; frequency-modulated by osc 2) and osc 2 (pulse, saw, triangle, noise; sync, keyboard track off), the modulation envelope to osc 2 pitch (the classic sync sweep), FM or width, LFO 1 (five waves, five destinations), LFO 2, the multimode filter (12 and 24 dB low-pass, band-pass, high-pass, notch + low-pass) with distortion and velocity, mono/legato/unison, portamento, octave shift and the arpeggiator.",
  params, glideParam: "glide",
  createVoice: (rate, i) => new NordVoice(rate, i + 81),
  presets: [
    { name: "Sync sweep lead", role: "lead", values: {} },
    { name: "FM bass", role: "bass", values: { w1: 3, w2: 2, sync: 0, semi: 12, fm: 0.4, mix: 0.2, fType: 1, cutoff: 900, envAmt: 0.5, fD: 0.3, fS: 0.2, meAmt: 0, assign: 2 } },
    { name: "Notch keys", role: "keys", values: { sync: 0, fType: 4, res: 0.6, cutoff: 1500, meAmt: 0, aD: 0.8, aS: 0.3 } },
    { name: "Hard sync stab", role: "keys", values: { meAmt: 0.75, meD: 0.25, aD: 0.3, aS: 0, cutoff: 6000, envAmt: 0.2 } },
    { name: "Distorted lead", role: "lead", values: { dist: 1, sync: 0, semi: 19, mix: 0.4, cutoff: 3500, res: 0.4, assign: 2, glide: 0.06, l1Amt: 0.1, l1Rate: 5.5 } },
    { name: "Unison supersaw", role: "lead", values: { assign: 1, uniDetune: 18, spread: 0.9, sync: 0, semi: 12, fine: 7, w2: 1, meAmt: 0, cutoff: 5000, envAmt: 0.15 } },
    { name: "Arpeggio", role: "pluck", values: { arp: 1, arpRange: 2, arpRate: 3, sync: 0, meAmt: 0, fType: 0, cutoff: 1100, res: 0.55, envAmt: 0.6, fD: 0.2, fS: 0, aD: 0.25, aS: 0 } },
    { name: "PWM pad", role: "pad", values: { w1: 0, w2: 0, sync: 0, semi: 12, fine: 6, l1Dest: 3, l1Amt: 0.6, l1Rate: 0.6, cutoff: 2500, aA: 0.6, aR: 1.5, meAmt: 0 } },
    { name: "Pulse bass", role: "bass", values: { w1: 0, pw: 0.4, w2: 1, sync: 0, semi: 0, fine: 8, mix: 0.5, meAmt: 0, fType: 1, cutoff: 600, res: 0.3, envAmt: 0.5, fD: 0.25, fS: 0.2, assign: 2 } },
    { name: "Organ", role: "organ", values: { w1: 3, w2: 2, semi: 12, sync: 0, meAmt: 0, mix: 0.5, cutoff: 8000, envAmt: 0, aA: 0.002, aS: 1, aR: 0.05 } },
    { name: "Synth strings", role: "strings", values: { w1: 1, w2: 1, sync: 0, semi: 0, fine: 10, meAmt: 0, cutoff: 3000, res: 0.15, envAmt: 0.1, aA: 0.5, aR: 1.4, l1Amt: 0.02, l1Rate: 5 } },
    { name: "FM bell", role: "bell", values: { w1: 3, w2: 2, sync: 0, semi: 24, mix: 0, fm: 0.5, meDest: 1, meAmt: 0.5, meD: 0.8, cutoff: 9000, envAmt: 0, aD: 1.5, aS: 0, aR: 1.2 } },
  ],
};
