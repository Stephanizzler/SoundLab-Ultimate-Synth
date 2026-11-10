// Subtractive machines modelled on classic analog and virtual-analog synths.
// Each one keeps the architecture that gave its original its sound: the
// oscillator set, the filter circuit and where it saturates, the envelopes.
import { Osc, Noise, SuperSaw } from "../dsp/osc.ts";
import { Cascade4, Svf, Korg35, OnePole } from "../dsp/filters.ts";
import { Adsr, Lfo } from "../dsp/env.ts";
import { JunoChorus } from "../dsp/fx.ts";
import { table, readTable, WAVETABLES } from "../dsp/wavetable.ts";
import { clamp, tanh, Rng } from "../dsp/util.ts";
import { Voice, indexOf, adsrParams, cutoffParam, type MachineDef, type ParamDef, type VoiceCtx } from "../engine/machine.ts";

const OCT = ["32'", "16'", "8'", "4'", "2'"] as const;
const octSemis = (i: number) => (Math.round(i) - 2) * 12;
const ONOFF = ["Off", "On"] as const;
// Filter cutoff with envelope (octaves), key tracking and a ceiling.
const cutoffHz = (base: number, octaves: number, rate: number) => clamp(base * 2 ** octaves, 20, rate * 0.45);

/* ------------------------------------------------------------------ */
/* Ladder Mono: Moog Minimoog Model D (1970)                           */
/* ------------------------------------------------------------------ */
const MOOG_WAVES = ["Triangle", "Tri-saw", "Saw", "Square", "Wide pulse", "Narrow pulse"] as const;
const moogParams: ParamDef[] = [
  { id: "w1", name: "Osc 1 wave", min: 0, max: 5, def: 2, options: MOOG_WAVES, group: "Oscillators" },
  { id: "o1", name: "Osc 1 range", min: 0, max: 4, def: 1, options: OCT, group: "Oscillators" },
  { id: "w2", name: "Osc 2 wave", min: 0, max: 5, def: 2, options: MOOG_WAVES, group: "Oscillators" },
  { id: "o2", name: "Osc 2 range", min: 0, max: 4, def: 1, options: OCT, group: "Oscillators" },
  { id: "t2", name: "Osc 2 tune", min: -7, max: 7, def: 0.08, unit: "st", group: "Oscillators" },
  { id: "w3", name: "Osc 3 wave", min: 0, max: 5, def: 3, options: MOOG_WAVES, group: "Oscillators" },
  { id: "o3", name: "Osc 3 range", min: 0, max: 4, def: 0, options: OCT, group: "Oscillators" },
  { id: "t3", name: "Osc 3 tune", min: -7, max: 7, def: -0.06, unit: "st", group: "Oscillators" },
  { id: "m1", name: "Osc 1 level", min: 0, max: 1, def: 0.8, unit: "%", group: "Mixer" },
  { id: "m2", name: "Osc 2 level", min: 0, max: 1, def: 0.6, unit: "%", group: "Mixer" },
  { id: "m3", name: "Osc 3 level", min: 0, max: 1, def: 0.4, unit: "%", group: "Mixer" },
  { id: "noise", name: "Noise", min: 0, max: 1, def: 0, unit: "%", group: "Mixer" },
  { id: "drive", name: "Overload", min: 0, max: 1, def: 0.3, unit: "%", group: "Mixer" },
  cutoffParam(600),
  { id: "emph", name: "Emphasis", min: 0, max: 1, def: 0.35, unit: "%", group: "Filter" },
  { id: "contour", name: "Contour amount", min: 0, max: 1, def: 0.55, unit: "%", group: "Filter" },
  { id: "kbd", name: "Keyboard control", min: 0, max: 3, def: 2, options: ["Off", "1/3", "2/3", "Full"], group: "Filter" },
  { id: "fA", name: "Filter attack", min: 0.001, max: 10, def: 0.002, unit: "s", curve: "exp", group: "Filter contour" },
  { id: "fD", name: "Filter decay", min: 0.005, max: 10, def: 0.35, unit: "s", curve: "exp", group: "Filter contour" },
  { id: "fS", name: "Filter sustain", min: 0, max: 1, def: 0.2, unit: "%", group: "Filter contour" },
  { id: "aA", name: "Loudness attack", min: 0.001, max: 10, def: 0.002, unit: "s", curve: "exp", group: "Loudness contour" },
  { id: "aD", name: "Loudness decay", min: 0.005, max: 10, def: 0.6, unit: "s", curve: "exp", group: "Loudness contour" },
  { id: "aS", name: "Loudness sustain", min: 0, max: 1, def: 0.85, unit: "%", group: "Loudness contour" },
  { id: "decaySw", name: "Decay switch", min: 0, max: 1, def: 1, options: ONOFF, group: "Loudness contour" },
  { id: "glide", name: "Glide", min: 0, max: 2, def: 0, unit: "s", group: "Controllers" },
  { id: "drift", name: "Drift", min: 0, max: 1, def: 0.3, unit: "%", group: "Controllers" },
];
const MP = indexOf(moogParams);
function moogWave(o: Osc, w: number) {
  switch (w) { case 0: return o.tri(); case 1: return o.shark(); case 2: return o.saw(); case 3: return o.pulse(0.5); case 4: return o.pulse(0.3); default: return o.pulse(0.12); }
}
class MoogVoice extends Voice {
  o = [new Osc(0), new Osc(0.33), new Osc(0.66)]; nz = new Noise(3); f = new Cascade4("ladder"); fe = new Adsr(); ae = new Adsr();
  trigger(legato: boolean) { if (!legato) { this.fe.gate(true); this.ae.gate(true); } }
  release() { this.fe.gate(false); this.ae.gate(false); }
  get active() { return this.ae.active; }
  render(out: Float32Array, n: number, p: Float64Array, ctx: VoiceCtx) {
    const P = MP, rate = this.rate;
    const w = [p[P.w1], p[P.w2], p[P.w3]].map(Math.round);
    const ratio = [2 ** (octSemis(p[P.o1]) / 12), 2 ** ((octSemis(p[P.o2]) + p[P.t2]) / 12), 2 ** ((octSemis(p[P.o3]) + p[P.t3]) / 12)];
    const lv = [p[P.m1], p[P.m2], p[P.m3]], noise = p[P.noise];
    const drive = 1 + p[P.drive] * 5, k = p[P.emph] * 4.1, contour = p[P.contour] * 5, kbd = Math.round(p[P.kbd]) / 3;
    const decayOn = p[P.decaySw] > 0.5;
    this.fe.set(p[P.fA], p[P.fD], p[P.fS], decayOn ? p[P.fD] : 0.01);
    this.ae.set(p[P.aA], p[P.aD], p[P.aS], decayOn ? p[P.aD] : 0.01);
    const glide = p[P.glide], drift = p[P.drift] * 8, cutoff = p[P.cutoff];
    for (let i = 0; i < n; i++) {
      this.glideStep(glide);
      const base = this.hz(ctx, this.wander(drift));
      let mix = 0;
      for (let j = 0; j < 3; j++) { this.o[j].step(base * ratio[j], rate); mix += moogWave(this.o[j], w[j]) * lv[j]; }
      mix += this.nz.pink() * noise * 2;
      const fe = this.fe.next(rate);
      if ((i & 3) === 0) this.f.set(cutoffHz(cutoff, contour * fe + kbd * (this.pitch - 60) / 12, rate), rate);
      const y = this.f.process(mix * 0.5 * (1 + p[P.drive]), k, drive) * (1 + k * 0.35);
      out[i] += y * this.ae.next(rate) * (0.6 + 0.4 * this.vel);
    }
  }
}
export const ladderMono: MachineDef = {
  id: "ladder-mono", name: "Ladder Mono", inspiredBy: "Moog Minimoog Model D (1970)", kind: "mono", voices: 1, level: 1.3,
  about: "Three oscillators into a transistor-ladder filter: 24 dB per octave, saturating at its input, losing bass as emphasis rises. Overload drives the mixer into the filter as players did on the original.",
  params: moogParams, glideParam: "glide",
  createVoice: (rate, i) => new MoogVoice(rate, i),
  presets: [
    { name: "Fat bass", values: {} },
    { name: "Lead with glide", values: { o1: 2, o2: 2, o3: 3, t2: 0.12, t3: 7.02, m3: 0.3, cutoff: 1400, emph: 0.5, contour: 0.4, fS: 0.6, glide: 0.08, aD: 1, decaySw: 1 } },
    { name: "Plucked bass", values: { w1: 3, w2: 2, cutoff: 220, emph: 0.6, contour: 0.8, fD: 0.18, fS: 0, aD: 0.4, aS: 0, decaySw: 1 } },
    { name: "Brass swell", values: { cutoff: 400, emph: 0.25, contour: 0.6, fA: 0.25, fD: 1.2, fS: 0.5, aA: 0.08 } },
  ],
};

/* ------------------------------------------------------------------ */
/* Studio Poly: Sequential Prophet-5 (1978)                            */
/* ------------------------------------------------------------------ */
const p5Params: ParamDef[] = [
  { id: "aSaw", name: "Osc A saw", min: 0, max: 1, def: 1, options: ONOFF, group: "Osc A" },
  { id: "aPulse", name: "Osc A pulse", min: 0, max: 1, def: 0, options: ONOFF, group: "Osc A" },
  { id: "aPw", name: "Osc A width", min: 0.05, max: 0.5, def: 0.4, unit: "%", group: "Osc A" },
  { id: "aOct", name: "Osc A octave", min: 0, max: 4, def: 2, options: OCT, group: "Osc A" },
  { id: "sync", name: "Sync", min: 0, max: 1, def: 0, options: ONOFF, group: "Osc A" },
  { id: "bSaw", name: "Osc B saw", min: 0, max: 1, def: 1, options: ONOFF, group: "Osc B" },
  { id: "bTri", name: "Osc B triangle", min: 0, max: 1, def: 0, options: ONOFF, group: "Osc B" },
  { id: "bPulse", name: "Osc B pulse", min: 0, max: 1, def: 0, options: ONOFF, group: "Osc B" },
  { id: "bPw", name: "Osc B width", min: 0.05, max: 0.5, def: 0.3, unit: "%", group: "Osc B" },
  { id: "bOct", name: "Osc B octave", min: 0, max: 4, def: 2, options: OCT, group: "Osc B" },
  { id: "bTune", name: "Osc B tune", min: -12, max: 12, def: 0, unit: "st", step: 1, group: "Osc B" },
  { id: "bFine", name: "Osc B fine", min: -50, max: 50, def: 7, unit: "ct", group: "Osc B" },
  { id: "pmEnv", name: "Poly-mod filter env", min: 0, max: 1, def: 0, unit: "%", group: "Poly-mod" },
  { id: "pmOsc", name: "Poly-mod osc B", min: 0, max: 1, def: 0, unit: "%", group: "Poly-mod" },
  { id: "pmDest", name: "Poly-mod to", min: 0, max: 2, def: 0, options: ["Freq A", "Width A", "Filter"], group: "Poly-mod" },
  { id: "mixA", name: "Osc A level", min: 0, max: 1, def: 0.8, unit: "%", group: "Mixer" },
  { id: "mixB", name: "Osc B level", min: 0, max: 1, def: 0.7, unit: "%", group: "Mixer" },
  { id: "noise", name: "Noise", min: 0, max: 1, def: 0, unit: "%", group: "Mixer" },
  cutoffParam(1800),
  { id: "res", name: "Resonance", min: 0, max: 1, def: 0.25, unit: "%", group: "Filter" },
  { id: "envAmt", name: "Env amount", min: 0, max: 1, def: 0.45, unit: "%", group: "Filter" },
  { id: "kbd", name: "Keyboard", min: 0, max: 1, def: 0.5, unit: "%", group: "Filter" },
  ...adsrParams("f", "Filter env", 0.003, 0.5, 0.3, 0.4),
  ...adsrParams("a", "Amp env", 0.003, 0.5, 0.8, 0.4),
  { id: "vel", name: "Velocity", min: 0, max: 1, def: 0.3, unit: "%", group: "Voice" },
  { id: "glide", name: "Glide", min: 0, max: 1, def: 0, unit: "s", group: "Voice" },
  { id: "vintage", name: "Vintage", min: 0, max: 1, def: 0.35, unit: "%", group: "Voice" },
];
const PP = indexOf(p5Params);
class P5Voice extends Voice {
  a = new Osc(); b = new Osc(0.5); nz = new Noise(5); f = new Cascade4("ota"); fe = new Adsr(); ae = new Adsr(); bOut = 0;
  trigger() { this.fe.gate(true); this.ae.gate(true); }
  release() { this.fe.gate(false); this.ae.gate(false); }
  get active() { return this.ae.active; }
  render(out: Float32Array, n: number, p: Float64Array, ctx: VoiceCtx) {
    const P = PP, rate = this.rate;
    const ra = 2 ** (octSemis(p[P.aOct]) / 12), rb = 2 ** ((octSemis(p[P.bOct]) + p[P.bTune] + p[P.bFine] / 100) / 12);
    const aSaw = p[P.aSaw] > 0.5, aPul = p[P.aPulse] > 0.5, bSaw = p[P.bSaw] > 0.5, bTri = p[P.bTri] > 0.5, bPul = p[P.bPulse] > 0.5, sync = p[P.sync] > 0.5;
    const pmEnv = p[P.pmEnv], pmOsc = p[P.pmOsc], dest = Math.round(p[P.pmDest]);
    const k = p[P.res] * 4, env = p[P.envAmt] * 6, kbd = p[P.kbd], velAmt = p[P.vel];
    const vgain = 1 - velAmt + velAmt * this.vel, vfilt = velAmt * (this.vel - 0.5) * 2;
    this.fe.set(p[P.fA], p[P.fD], p[P.fS], p[P.fR]); this.ae.set(p[P.aA], p[P.aD], p[P.aS], p[P.aR]);
    const drift = p[P.vintage] * 10, glide = p[P.glide], cutoff = p[P.cutoff];
    for (let i = 0; i < n; i++) {
      this.glideStep(glide);
      const base = this.hz(ctx, this.wander(drift));
      const fe = this.fe.next(rate);
      const pm = pmEnv * fe + pmOsc * this.bOut;
      this.b.step(base * rb, rate);
      const bo = (bSaw ? this.b.saw() : 0) + (bTri ? this.b.tri() : 0) + (bPul ? this.b.pulse(p[P.bPw]) : 0);
      this.bOut = bo;
      this.a.step(base * ra * (dest === 0 ? 2 ** (pm * 4) : 1), rate);
      if (sync) this.a.syncTo(this.b);
      const pw = dest === 1 ? clamp(p[P.aPw] + pm * 0.4, 0.05, 0.95) : p[P.aPw];
      const ao = (aSaw ? this.a.saw() : 0) + (aPul ? this.a.pulse(pw) : 0);
      const mix = ao * p[P.mixA] + bo * p[P.mixB] + this.nz.white() * p[P.noise];
      if ((i & 3) === 0) this.f.set(cutoffHz(cutoff, env * fe + kbd * (this.pitch - 60) / 12 + vfilt + (dest === 2 ? pm * 3 : 0), rate), rate);
      out[i] += this.f.process(mix * 0.4, k, 1.3) * this.ae.next(rate) * vgain;
    }
  }
}
export const studioPoly: MachineDef = {
  id: "studio-poly", name: "Studio Poly", inspiredBy: "Sequential Prophet-5 (1978)", kind: "poly", voices: 8, level: 0.96,
  about: "Two oscillators with sync and the famous poly-mod (filter envelope and oscillator B bending oscillator A or the filter), into a 4-pole IC filter that saturates gently in every stage. Vintage adds per-voice drift.",
  params: p5Params,
  createVoice: (rate, i) => new P5Voice(rate, i + 11),
  presets: [
    { name: "Warm poly", values: {} },
    { name: "Sync sweep", values: { sync: 1, bOct: 1, aOct: 3, pmEnv: 0.6, pmDest: 0, envAmt: 0.3, cutoff: 3000, fD: 0.8, fS: 0.2 } },
    { name: "Bell poly-mod", values: { aSaw: 0, aPulse: 1, aPw: 0.5, bSaw: 0, bTri: 1, pmOsc: 0.55, mixA: 0.8, mixB: 0, bOct: 3, bTune: 7, cutoff: 2600, envAmt: 0.25, fD: 1.2, fS: 0, aD: 1.8, aS: 0, aR: 1.4 } },
    { name: "Soft pad", values: { cutoff: 900, res: 0.15, envAmt: 0.3, fA: 0.8, fD: 2, aA: 0.6, aR: 1.5, vintage: 0.5 } },
  ],
};

/* ------------------------------------------------------------------ */
/* Chorus Poly: Roland Juno-60 (1982)                                  */
/* ------------------------------------------------------------------ */
const junoParams: ParamDef[] = [
  { id: "range", name: "Range", min: 0, max: 2, def: 1, options: ["16'", "8'", "4'"], group: "DCO" },
  { id: "saw", name: "Saw", min: 0, max: 1, def: 1, options: ONOFF, group: "DCO" },
  { id: "pulse", name: "Pulse", min: 0, max: 1, def: 0, options: ONOFF, group: "DCO" },
  { id: "pw", name: "Pulse width", min: 0, max: 1, def: 0.3, unit: "%", group: "DCO" },
  { id: "pwm", name: "Width from", min: 0, max: 2, def: 1, options: ["Manual", "LFO", "Env"], group: "DCO" },
  { id: "sub", name: "Sub osc", min: 0, max: 1, def: 0.4, unit: "%", group: "DCO" },
  { id: "noise", name: "Noise", min: 0, max: 1, def: 0, unit: "%", group: "DCO" },
  { id: "hpf", name: "HPF", min: 0, max: 3, def: 1, options: ["Boost", "Off", "Low", "High"], group: "Filter" },
  cutoffParam(1500),
  { id: "res", name: "Resonance", min: 0, max: 1, def: 0.2, unit: "%", group: "Filter" },
  { id: "envAmt", name: "Env", min: -1, max: 1, def: 0.4, group: "Filter" },
  { id: "lfoF", name: "LFO", min: 0, max: 1, def: 0, unit: "%", group: "Filter" },
  { id: "kbd", name: "Keyboard", min: 0, max: 1, def: 0.5, unit: "%", group: "Filter" },
  { id: "vca", name: "VCA", min: 0, max: 1, def: 0, options: ["Env", "Gate"], group: "Envelope" },
  ...adsrParams("", "Env", 0.003, 0.6, 0.6, 0.35, "Envelope"),
  { id: "lfoRate", name: "LFO rate", min: 0.1, max: 20, def: 3, unit: "Hz", curve: "exp", group: "LFO" },
  { id: "lfoDelay", name: "LFO delay", min: 0, max: 3, def: 0.3, unit: "s", group: "LFO" },
  { id: "lfoP", name: "LFO to pitch", min: 0, max: 1, def: 0, unit: "%", group: "LFO" },
  { id: "chorus", name: "Chorus", min: 0, max: 3, def: 1, options: ["Off", "I", "II", "I+II"], group: "Chorus" },
];
const JP = indexOf(junoParams);
class JunoVoice extends Voice {
  o = new Osc(); nz = new Noise(9); f = new Cascade4("ota"); hp = new OnePole(); boost = new OnePole(); e = new Adsr(); lfo = new Lfo(3); held = 0;
  trigger() { this.e.gate(true); this.held = 0; }
  release() { this.e.gate(false); }
  get active() { return this.e.active || this.gateOn; }
  render(out: Float32Array, n: number, p: Float64Array, ctx: VoiceCtx) {
    const P = JP, rate = this.rate;
    const ratio = 2 ** ((Math.round(p[P.range]) - 1) * 12 / 12);
    const saw = p[P.saw] > 0.5, pul = p[P.pulse] > 0.5, pwm = Math.round(p[P.pwm]);
    const k = p[P.res] * 4.05, env = p[P.envAmt] * 6, kbd = p[P.kbd], gateMode = p[P.vca] > 0.5;
    const hpf = Math.round(p[P.hpf]); this.hp.set(hpf === 3 ? 720 : 240, rate); this.boost.set(90, rate);
    this.e.set(p[P.A], p[P.D], p[P.S], p[P.R]);
    const lfoInc = p[P.lfoRate] / rate, delay = p[P.lfoDelay] * rate, cutoff = p[P.cutoff];
    if (!gateMode && !this.e.active) this.gateOn = false;
    for (let i = 0; i < n; i++) {
      this.held++;
      const lfoAmt = delay <= 0 ? 1 : Math.min(1, this.held / delay);
      const l = this.lfo.advance(lfoInc, 1) * lfoAmt;
      const e = this.e.next(rate);
      this.o.step(this.hz(ctx, l * p[P.lfoP] * 0.5) * ratio, rate);
      const width = 0.5 - 0.45 * clamp(pwm === 0 ? p[P.pw] : pwm === 1 ? p[P.pw] * (0.5 + 0.5 * l) : p[P.pw] * e, 0, 1);
      let x = (saw ? this.o.saw() : 0) + (pul ? this.o.pulse(width) : 0) + this.o.subSquare() * p[P.sub] + this.nz.white() * p[P.noise];
      if (hpf >= 2) x = this.hp.hp(x); else if (hpf === 0) x += this.boost.lp(x) * 0.6;
      if ((i & 3) === 0) this.f.set(cutoffHz(cutoff, env * e + p[P.lfoF] * l * 2 + kbd * (this.pitch - 60) / 12, rate), rate);
      const amp = gateMode ? (this.gateOn ? 1 : 0) : e;
      out[i] += this.f.process(x * 0.35, k, 1.1) * amp * (0.7 + 0.3 * this.vel);
    }
  }
}
class JunoFx { c: JunoChorus; constructor(rate: number) { this.c = new JunoChorus(rate); } process(L: Float32Array, R: Float32Array, n: number, p: Float64Array) { this.c.process(L, R, n, Math.round(p[JP.chorus])); } }
export const chorusPoly: MachineDef = {
  id: "chorus-poly", name: "Chorus Poly", inspiredBy: "Roland Juno-60 (1982)", kind: "poly", voices: 8, level: 1.29,
  about: "One stable oscillator per voice with saw, pulse (width swept by LFO or envelope), sub-octave square and noise, a stepped high-pass, a 4-pole filter and the stereo bucket-brigade chorus with its three modes.",
  params: junoParams,
  createVoice: (rate, i) => new JunoVoice(rate, i + 21),
  createFx: (rate) => new JunoFx(rate),
  presets: [
    { name: "Classic chorus poly", values: {} },
    { name: "PWM strings", values: { saw: 0, pulse: 1, pw: 0.6, pwm: 1, lfoRate: 0.8, sub: 0.2, cutoff: 3000, envAmt: 0.1, A: 0.4, R: 1.2, chorus: 2 } },
    { name: "Hoover-ish bass", values: { range: 0, saw: 1, pulse: 1, pw: 0.7, pwm: 1, lfoRate: 6, sub: 0.8, cutoff: 700, res: 0.3, envAmt: 0.5, D: 0.4, S: 0.3, chorus: 3 } },
    { name: "Organ (gate)", values: { saw: 0, pulse: 1, pw: 0, pwm: 0, sub: 0.6, cutoff: 6000, envAmt: 0, vca: 1, chorus: 3 } },
  ],
};

/* ------------------------------------------------------------------ */
/* Flagship Poly: Roland Jupiter-8 (1981)                              */
/* ------------------------------------------------------------------ */
const jupParams: ParamDef[] = [
  { id: "w1", name: "VCO-1 wave", min: 0, max: 3, def: 1, options: ["Triangle", "Saw", "Pulse", "Square"], group: "VCO-1" },
  { id: "o1", name: "VCO-1 range", min: 0, max: 4, def: 2, options: OCT, group: "VCO-1" },
  { id: "xmod", name: "Cross mod", min: 0, max: 1, def: 0, unit: "%", group: "VCO-1" },
  { id: "sync", name: "Sync", min: 0, max: 1, def: 0, options: ONOFF, group: "VCO-1" },
  { id: "w2", name: "VCO-2 wave", min: 0, max: 3, def: 1, options: ["Sine", "Saw", "Pulse", "Noise"], group: "VCO-2" },
  { id: "o2", name: "VCO-2 range", min: 0, max: 4, def: 2, options: OCT, group: "VCO-2" },
  { id: "t2", name: "VCO-2 fine", min: -50, max: 50, def: 9, unit: "ct", group: "VCO-2" },
  { id: "pw", name: "Pulse width", min: 0.05, max: 0.5, def: 0.35, unit: "%", group: "VCO-2" },
  { id: "bal", name: "Balance", min: 0, max: 1, def: 0.5, unit: "%", group: "Mixer" },
  { id: "hpf", name: "HPF", min: 20, max: 2000, def: 20, unit: "Hz", curve: "exp", group: "Filter" },
  cutoffParam(2200),
  { id: "res", name: "Resonance", min: 0, max: 1, def: 0.2, unit: "%", group: "Filter" },
  { id: "slope", name: "Slope", min: 0, max: 1, def: 1, options: ["12 dB", "24 dB"], group: "Filter" },
  { id: "envAmt", name: "Env-1 amount", min: 0, max: 1, def: 0.4, unit: "%", group: "Filter" },
  { id: "kbd", name: "Keyboard", min: 0, max: 1, def: 0.5, unit: "%", group: "Filter" },
  { id: "lfoRate", name: "LFO rate", min: 0.1, max: 20, def: 5, unit: "Hz", curve: "exp", group: "LFO" },
  { id: "lfoP", name: "LFO to pitch", min: 0, max: 1, def: 0, unit: "%", group: "LFO" },
  { id: "lfoF", name: "LFO to filter", min: 0, max: 1, def: 0, unit: "%", group: "LFO" },
  ...adsrParams("f", "Env-1", 0.005, 0.7, 0.3, 0.5),
  ...adsrParams("a", "Env-2", 0.005, 0.7, 0.8, 0.5),
  { id: "drift", name: "Drift", min: 0, max: 1, def: 0.2, unit: "%", group: "Voice" },
];
const JU = indexOf(jupParams);
class JupVoice extends Voice {
  a = new Osc(); b = new Osc(0.25); nz = new Noise(4); f = new Cascade4("ota"); hp = new OnePole(); fe = new Adsr(); ae = new Adsr(); lfo = new Lfo(5); bOut = 0;
  trigger() { this.fe.gate(true); this.ae.gate(true); }
  release() { this.fe.gate(false); this.ae.gate(false); }
  get active() { return this.ae.active; }
  render(out: Float32Array, n: number, p: Float64Array, ctx: VoiceCtx) {
    const P = JU, rate = this.rate;
    const r1 = 2 ** (octSemis(p[P.o1]) / 12), r2 = 2 ** ((octSemis(p[P.o2]) + p[P.t2] / 100) / 12);
    const w1 = Math.round(p[P.w1]), w2 = Math.round(p[P.w2]), sync = p[P.sync] > 0.5, xm = p[P.xmod] * 3;
    const k = p[P.res] * 4, env = p[P.envAmt] * 6, two = p[P.slope] < 0.5, bal = p[P.bal];
    this.fe.set(p[P.fA], p[P.fD], p[P.fS], p[P.fR]); this.ae.set(p[P.aA], p[P.aD], p[P.aS], p[P.aR]);
    this.hp.set(p[P.hpf], rate);
    const drift = p[P.drift] * 8, cutoff = p[P.cutoff];
    for (let i = 0; i < n; i++) {
      const l = this.lfo.advance(p[P.lfoRate] / rate, 0);
      const base = this.hz(ctx, this.wander(drift) + l * p[P.lfoP]);
      this.b.step(base * r2, rate);
      const bo = w2 === 0 ? this.b.sine() : w2 === 1 ? this.b.saw() : w2 === 2 ? this.b.pulse(p[P.pw]) : this.nz.white();
      this.a.step(base * r1 * (1 + xm * this.bOut), rate);
      this.bOut = bo;
      if (sync) this.a.syncTo(this.b);
      const ao = w1 === 0 ? this.a.tri() : w1 === 1 ? this.a.saw() : w1 === 2 ? this.a.pulse(p[P.pw]) : this.a.pulse(0.5);
      const fe = this.fe.next(rate);
      if ((i & 3) === 0) this.f.set(cutoffHz(cutoff, env * fe + l * p[P.lfoF] * 2 + p[P.kbd] * (this.pitch - 60) / 12, rate), rate);
      const x = this.hp.hp(ao * (1 - bal) + bo * bal);
      const lp4 = this.f.process(x * 0.45, k, 1.2);
      const y = two ? this.f.out[1] : lp4;
      out[i] += y * this.ae.next(rate) * (0.7 + 0.3 * this.vel);
    }
  }
}
export const flagshipPoly: MachineDef = {
  id: "flagship-poly", name: "Flagship Poly", inspiredBy: "Roland Jupiter-8 (1981)", kind: "poly", voices: 8, level: 1.21,
  about: "Two oscillators with cross-modulation and sync, a high-pass then a 4-pole filter switchable between 12 and 24 dB per octave, two ADSRs and an LFO. Bright, wide and polished.",
  params: jupParams,
  createVoice: (rate, i) => new JupVoice(rate, i + 31),
  presets: [
    { name: "Big poly", values: {} },
    { name: "Cross-mod bell", values: { w1: 0, w2: 0, xmod: 0.5, o2: 3, cutoff: 6000, envAmt: 0.1, aD: 1.6, aS: 0, aR: 1.5 } },
    { name: "Sync lead", values: { sync: 1, o1: 3, w1: 1, w2: 1, bal: 0, cutoff: 5000, envAmt: 0.2, lfoP: 0.15, aS: 1 } },
    { name: "12 dB pad", values: { slope: 0, cutoff: 1500, res: 0.4, fA: 1.2, fD: 2, aA: 0.8, aR: 2 } },
  ],
};

/* ------------------------------------------------------------------ */
/* Multimode Poly: Oberheim OB-X / SEM (1974-79)                       */
/* ------------------------------------------------------------------ */
const OBW = ["Saw", "Pulse", "Saw + pulse"] as const;
const obParams: ParamDef[] = [
  { id: "w1", name: "Osc 1 wave", min: 0, max: 2, def: 0, options: OBW, group: "Oscillators" },
  { id: "w2", name: "Osc 2 wave", min: 0, max: 2, def: 0, options: OBW, group: "Oscillators" },
  { id: "t2", name: "Osc 2 tune", min: -12, max: 12, def: 0, unit: "st", step: 1, group: "Oscillators" },
  { id: "detune", name: "Detune", min: 0, max: 40, def: 12, unit: "ct", group: "Oscillators" },
  { id: "pw", name: "Pulse width", min: 0.05, max: 0.5, def: 0.4, unit: "%", group: "Oscillators" },
  { id: "sync", name: "Sync", min: 0, max: 1, def: 0, options: ONOFF, group: "Oscillators" },
  { id: "noise", name: "Noise", min: 0, max: 1, def: 0, unit: "%", group: "Oscillators" },
  cutoffParam(1600),
  { id: "res", name: "Resonance", min: 0, max: 1, def: 0.3, unit: "%", group: "Filter" },
  { id: "mode", name: "Mode (LP–notch–HP)", min: 0, max: 1, def: 0, unit: "%", group: "Filter" },
  { id: "bp", name: "Band-pass", min: 0, max: 1, def: 0, options: ONOFF, group: "Filter" },
  { id: "envAmt", name: "Env amount", min: 0, max: 1, def: 0.5, unit: "%", group: "Filter" },
  { id: "kbd", name: "Keyboard", min: 0, max: 1, def: 0.5, unit: "%", group: "Filter" },
  ...adsrParams("f", "Filter env", 0.02, 0.6, 0.4, 0.4),
  ...adsrParams("a", "Amp env", 0.01, 0.6, 0.85, 0.4),
  { id: "vib", name: "Vibrato", min: 0, max: 1, def: 0, unit: "%", group: "Voice" },
  { id: "glide", name: "Glide", min: 0, max: 1, def: 0, unit: "s", group: "Voice" },
  { id: "drift", name: "Voice drift", min: 0, max: 1, def: 0.5, unit: "%", group: "Voice" },
];
const OB = indexOf(obParams);
class ObVoice extends Voice {
  a = new Osc(); b = new Osc(0.7); nz = new Noise(8); f = new Svf(); fe = new Adsr(); ae = new Adsr(); lfo = new Lfo(9);
  trigger() { this.fe.gate(true); this.ae.gate(true); }
  release() { this.fe.gate(false); this.ae.gate(false); }
  get active() { return this.ae.active; }
  render(out: Float32Array, n: number, p: Float64Array, ctx: VoiceCtx) {
    const P = OB, rate = this.rate;
    const w1 = Math.round(p[P.w1]), w2 = Math.round(p[P.w2]), pw = p[P.pw], sync = p[P.sync] > 0.5;
    const r2 = 2 ** ((p[P.t2] + p[P.detune] / 100) / 12);
    const res = p[P.res], env = p[P.envAmt] * 6, mode = p[P.mode], bp = p[P.bp] > 0.5;
    this.fe.set(p[P.fA], p[P.fD], p[P.fS], p[P.fR]); this.ae.set(p[P.aA], p[P.aD], p[P.aS], p[P.aR]);
    const drift = p[P.drift] * 14, glide = p[P.glide], cutoff = p[P.cutoff];
    const wave = (o: Osc, w: number) => (w === 0 ? o.saw() : w === 1 ? o.pulse(pw) : 0.6 * (o.saw() + o.pulse(pw)));
    for (let i = 0; i < n; i++) {
      this.glideStep(glide);
      const vib = this.lfo.advance(5.5 / rate, 0) * (p[P.vib] * 0.4 + ctx.wheel * 0.3);
      const base = this.hz(ctx, this.wander(drift) + vib);
      this.a.step(base, rate); this.b.step(base * r2, rate);
      if (sync) this.b.syncTo(this.a);
      const x = wave(this.a, w1) + wave(this.b, w2) + this.nz.white() * p[P.noise];
      const fe = this.fe.next(rate);
      if ((i & 3) === 0) this.f.set(cutoffHz(cutoff, env * fe + p[P.kbd] * (this.pitch - 60) / 12, rate), rate, res * 0.97);
      this.f.process(x * 0.3, 1.4);
      const y = bp ? this.f.bp : this.f.morph(mode);
      out[i] += y * this.ae.next(rate) * (0.7 + 0.3 * this.vel);
    }
  }
}
export const multimodePoly: MachineDef = {
  id: "multimode-poly", name: "Multimode Poly", inspiredBy: "Oberheim OB-X / SEM (1974–1979)", kind: "poly", voices: 8, level: 0.49,
  about: "Two oscillators into a 12 dB state-variable filter whose mode sweeps from low-pass through notch to high-pass (plus band-pass). Large per-voice drift for the loose, brassy ensemble sound.",
  params: obParams,
  createVoice: (rate, i) => new ObVoice(rate, i + 41),
  presets: [
    { name: "Brass stab", values: {} },
    { name: "Jumpy brass", values: { w1: 0, w2: 0, detune: 16, cutoff: 900, res: 0.2, envAmt: 0.6, fA: 0.04, fD: 0.3, fS: 0.5, aS: 1 } },
    { name: "Notch pad", values: { mode: 0.5, res: 0.6, cutoff: 1200, envAmt: 0.2, fA: 1.5, aA: 0.7, aR: 1.5 } },
    { name: "Band-pass pluck", values: { bp: 1, res: 0.55, cutoff: 900, envAmt: 0.7, fD: 0.25, fS: 0, aD: 0.4, aS: 0 } },
  ],
};

/* ------------------------------------------------------------------ */
/* Scream Mono: Korg MS-20 (1978)                                      */
/* ------------------------------------------------------------------ */
const msParams: ParamDef[] = [
  { id: "w1", name: "VCO-1 wave", min: 0, max: 3, def: 1, options: ["Triangle", "Saw", "Pulse", "Noise"], group: "VCO-1" },
  { id: "pw", name: "Pulse width", min: 0.05, max: 0.5, def: 0.3, unit: "%", group: "VCO-1" },
  { id: "o1", name: "VCO-1 scale", min: 0, max: 4, def: 1, options: OCT, group: "VCO-1" },
  { id: "w2", name: "VCO-2 wave", min: 0, max: 3, def: 0, options: ["Saw", "Square", "Narrow pulse", "Ring mod"], group: "VCO-2" },
  { id: "o2", name: "VCO-2 scale", min: 0, max: 4, def: 1, options: OCT, group: "VCO-2" },
  { id: "t2", name: "VCO-2 pitch", min: -12, max: 12, def: 0.1, unit: "st", group: "VCO-2" },
  { id: "m1", name: "VCO-1 level", min: 0, max: 1, def: 0.8, unit: "%", group: "Mixer" },
  { id: "m2", name: "VCO-2 level", min: 0, max: 1, def: 0.5, unit: "%", group: "Mixer" },
  { id: "hpCut", name: "HPF cutoff", min: 20, max: 5000, def: 60, unit: "Hz", curve: "exp", group: "High-pass" },
  { id: "hpPeak", name: "HPF peak", min: 0, max: 1, def: 0.2, unit: "%", group: "High-pass" },
  { id: "cutoff", name: "LPF cutoff", min: 20, max: 20000, def: 900, unit: "Hz", curve: "exp", group: "Low-pass" },
  { id: "lpPeak", name: "LPF peak", min: 0, max: 1, def: 0.5, unit: "%", group: "Low-pass" },
  { id: "envAmt", name: "EG to cutoffs", min: 0, max: 1, def: 0.5, unit: "%", group: "Low-pass" },
  { id: "kbd", name: "Keyboard", min: 0, max: 1, def: 0.5, unit: "%", group: "Low-pass" },
  { id: "drive", name: "Drive", min: 0, max: 1, def: 0.4, unit: "%", group: "Low-pass" },
  ...adsrParams("", "EG", 0.002, 0.4, 0.5, 0.25, "Envelope"),
  { id: "glide", name: "Portamento", min: 0, max: 1, def: 0, unit: "s", group: "Voice" },
];
const MS = indexOf(msParams);
class MsVoice extends Voice {
  a = new Osc(); b = new Osc(0.4); nz = new Noise(12); hp = new Korg35("hp"); lp = new Korg35("lp"); e = new Adsr();
  trigger(legato: boolean) { if (!legato) this.e.gate(true); }
  release() { this.e.gate(false); }
  get active() { return this.e.active; }
  render(out: Float32Array, n: number, p: Float64Array, ctx: VoiceCtx) {
    const P = MS, rate = this.rate;
    const r1 = 2 ** (octSemis(p[P.o1]) / 12), r2 = 2 ** ((octSemis(p[P.o2]) + p[P.t2]) / 12);
    const w1 = Math.round(p[P.w1]), w2 = Math.round(p[P.w2]), env = p[P.envAmt] * 6, sat = 1 + p[P.drive] * 4;
    this.e.set(p[P.A], p[P.D], p[P.S], p[P.R]);
    const glide = p[P.glide], hpCut = p[P.hpCut], lpCut = p[P.cutoff];
    for (let i = 0; i < n; i++) {
      this.glideStep(glide);
      const base = this.hz(ctx, this.wander(4));
      this.a.step(base * r1, rate); this.b.step(base * r2, rate);
      const ao = w1 === 0 ? this.a.tri() : w1 === 1 ? this.a.saw() : w1 === 2 ? this.a.pulse(p[P.pw]) : this.nz.white();
      const bo = w2 === 0 ? this.b.saw() : w2 === 1 ? this.b.pulse(0.5) : w2 === 2 ? this.b.pulse(0.1) : this.b.pulse(0.5) * (this.a.phase < 0.5 ? 1 : -1);
      const e = this.e.next(rate);
      if ((i & 3) === 0) {
        const mod = env * e + p[P.kbd] * (this.pitch - 60) / 12;
        this.hp.set(cutoffHz(hpCut, mod * 0.3, rate), rate, p[P.hpPeak] * 1.95);
        this.lp.set(cutoffHz(lpCut, mod, rate), rate, p[P.lpPeak] * 1.98);
      }
      const x = ao * p[P.m1] + bo * p[P.m2];
      const y = this.lp.process(this.hp.process(x * 0.5, sat), sat);
      out[i] += y * e * (0.7 + 0.3 * this.vel);
    }
  }
}
export const screamMono: MachineDef = {
  id: "scream-mono", name: "Scream Mono", inspiredBy: "Korg MS-20 (1978)", kind: "mono", voices: 1, level: 2.2,
  about: "Two oscillators (one can ring-modulate) into a resonant high-pass then low-pass, both of the Korg 35 type with nonlinear positive feedback: push the peaks for the aggressive, screaming resonance.",
  params: msParams, glideParam: "glide",
  createVoice: (rate, i) => new MsVoice(rate, i + 51),
  presets: [
    { name: "Gritty bass", values: {} },
    { name: "Screaming lead", values: { o1: 2, o2: 2, t2: 7, lpPeak: 0.85, hpPeak: 0.5, hpCut: 300, cutoff: 1500, drive: 0.7, S: 0.9, glide: 0.05 } },
    { name: "Ring-mod clang", values: { w1: 2, w2: 3, t2: 5, cutoff: 3000, lpPeak: 0.3, D: 0.6, S: 0 } },
    { name: "Resonant zap", values: { cutoff: 200, lpPeak: 0.92, envAmt: 0.9, D: 0.15, S: 0 } },
  ],
};

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
export const acidBass: MachineDef = {
  id: "acid-bass", name: "Acid Bass", inspiredBy: "Roland TB-303 Bass Line (1981)", kind: "mono", voices: 1, level: 0.79,
  about: "One oscillator into a diode-ladder-style filter. The sequencer's accent and slide steps drive it like the original: accents shorten the filter decay and charge a sweep circuit, slides glide without retriggering.",
  params: acidParams, glideParam: "slide",
  createVoice: (rate, i) => new AcidVoice(rate, i + 61),
  presets: [
    { name: "Squelch", values: {} },
    { name: "Deep square", values: { wave: 1, cutoff: 250, res: 0.5, envMod: 0.35, decay: 1.2 } },
    { name: "Screaming acid", values: { cutoff: 700, res: 0.92, envMod: 0.8, accent: 1, dist: 0.6 } },
    { name: "Rubber", values: { cutoff: 180, res: 0.35, envMod: 0.6, decay: 0.3 } },
  ],
};

/* ------------------------------------------------------------------ */
/* Super VA: Access Virus (1997)                                       */
/* ------------------------------------------------------------------ */
const virusParams: ParamDef[] = [
  { id: "o1", name: "Osc 1", min: 0, max: 2, def: 0, options: ["Super saw", "Wavetable", "Pulse"], group: "Osc 1" },
  { id: "density", name: "Density", min: 1, max: 9, def: 7, step: 1, group: "Osc 1" },
  { id: "spread", name: "Spread", min: 0, max: 1, def: 0.45, unit: "%", group: "Osc 1" },
  { id: "table", name: "Wavetable", min: 0, max: WAVETABLES.length - 1, def: 0, options: WAVETABLES, group: "Osc 2" },
  { id: "pos", name: "Wave position", min: 0, max: 1, def: 0.3, unit: "%", group: "Osc 2" },
  { id: "posEnv", name: "Env to position", min: -1, max: 1, def: 0.2, group: "Osc 2" },
  { id: "o2Semi", name: "Osc 2 semitone", min: -24, max: 24, def: 12, unit: "st", step: 1, group: "Osc 2" },
  { id: "bal", name: "Osc balance", min: 0, max: 1, def: 0.3, unit: "%", group: "Mixer" },
  { id: "sub", name: "Sub osc", min: 0, max: 1, def: 0.2, unit: "%", group: "Mixer" },
  { id: "fMode", name: "Filter 1 mode", min: 0, max: 2, def: 0, options: ["Low-pass", "Band-pass", "High-pass"], group: "Filters" },
  { id: "route", name: "Filter routing", min: 0, max: 2, def: 1, options: ["Filter 1 only", "Serial 1→2", "Parallel"], group: "Filters" },
  cutoffParam(2500, "Filters"),
  { id: "res", name: "Resonance", min: 0, max: 1, def: 0.25, unit: "%", group: "Filters" },
  { id: "envAmt", name: "Env amount", min: -1, max: 1, def: 0.35, group: "Filters" },
  { id: "kbd", name: "Key follow", min: 0, max: 1, def: 0.4, unit: "%", group: "Filters" },
  { id: "sat", name: "Saturation", min: 0, max: 1, def: 0.2, unit: "%", group: "Filters" },
  ...adsrParams("f", "Filter env", 0.005, 0.5, 0.4, 0.4),
  ...adsrParams("a", "Amp env", 0.005, 0.5, 0.8, 0.5),
  { id: "velF", name: "Velocity to filter", min: 0, max: 1, def: 0.3, unit: "%", group: "Voice" },
  { id: "chorus", name: "Chorus", min: 0, max: 2, def: 1, options: ["Off", "Light", "Deep"], group: "Voice" },
];
const VP = indexOf(virusParams);
class VirusVoice extends Voice {
  ss: SuperSaw; w = new Osc(); pulse = new Osc(); sub = new Osc(); f1 = new Svf(); f2 = new Cascade4("ladder"); fe = new Adsr(); ae = new Adsr();
  constructor(rate: number, seed: number) { super(rate, seed); this.ss = new SuperSaw(new Rng(seed * 31 + 1)); }
  trigger() { this.fe.gate(true); this.ae.gate(true); }
  release() { this.fe.gate(false); this.ae.gate(false); }
  get active() { return this.ae.active; }
  render(out: Float32Array, n: number, p: Float64Array, ctx: VoiceCtx) {
    const P = VP, rate = this.rate, tab = table(Math.round(p[P.table]));
    const o1 = Math.round(p[P.o1]), dens = p[P.density], spread = p[P.spread], r2 = 2 ** (p[P.o2Semi] / 12);
    const bal = p[P.bal], sub = p[P.sub], mode = Math.round(p[P.fMode]), route = Math.round(p[P.route]);
    const res = p[P.res], env = p[P.envAmt] * 6, sat = p[P.sat], satG = 1 + sat * 6;
    const vf = p[P.velF] * (this.vel - 0.5) * 3;
    this.fe.set(p[P.fA], p[P.fD], p[P.fS], p[P.fR]); this.ae.set(p[P.aA], p[P.aD], p[P.aS], p[P.aR]);
    const cutoff = p[P.cutoff];
    for (let i = 0; i < n; i++) {
      const base = this.hz(ctx, this.wander(2));
      const fe = this.fe.next(rate);
      let a: number;
      if (o1 === 0) a = this.ss.render(base, rate, dens, spread);
      else if (o1 === 1) { this.pulse.step(base, rate); a = readTable(tab, p[P.pos] + p[P.posEnv] * fe, this.pulse.phase, this.pulse.dt); }
      else { this.pulse.step(base, rate); a = this.pulse.pulse(0.5 - spread * 0.45); }
      this.w.step(base * r2, rate);
      const b = readTable(tab, p[P.pos] + p[P.posEnv] * fe, this.w.phase, this.w.dt);
      this.sub.step(base * 0.5, rate);
      let x = a * (1 - bal) + b * bal + this.sub.sine() * sub;
      if (sat > 0) x = tanh(x * satG) / Math.sqrt(satG);
      if ((i & 3) === 0) {
        const hz = cutoffHz(cutoff, env * fe + p[P.kbd] * (this.pitch - 60) / 12 + vf, rate);
        this.f1.set(hz, rate, res * 0.95);
        if (route > 0) this.f2.set(route === 1 ? hz * 1.5 : hz * 0.7, rate);
      }
      this.f1.process(x * 0.35);
      const y1 = mode === 0 ? this.f1.lp : mode === 1 ? this.f1.bp : this.f1.hp;
      const y = route === 0 ? y1 : route === 1 ? this.f2.process(y1, res * 2.5, 1.5) : 0.6 * (y1 + this.f2.process(x * 0.35, res * 3, 1.5));
      out[i] += y * this.ae.next(rate) * (0.7 + 0.3 * this.vel);
    }
  }
}
class VirusFx { c: JunoChorus; constructor(rate: number) { this.c = new JunoChorus(rate); } process(L: Float32Array, R: Float32Array, n: number, p: Float64Array) { this.c.process(L, R, n, Math.round(p[VP.chorus])); } }
export const superVa: MachineDef = {
  id: "super-va", name: "Super VA", inspiredBy: "Access Virus (1997)", kind: "poly", voices: 8, level: 1.08,
  about: "A virtual-analog flagship: a stack of up to nine detuned saws (or a wavetable or pulse) plus a wavetable oscillator and sub, saturation, then two filters, a multimode state-variable and a ladder, in serial or parallel.",
  params: virusParams,
  createVoice: (rate, i) => new VirusVoice(rate, i + 71),
  createFx: (rate) => new VirusFx(rate),
  presets: [
    { name: "Trance supersaw", values: { bal: 0, sub: 0.15, cutoff: 6000, res: 0.15, envAmt: 0.1, aA: 0.01, aR: 0.6 } },
    { name: "Wavetable pluck", values: { o1: 1, table: 0, pos: 0.1, posEnv: 0.7, bal: 0.5, cutoff: 1800, envAmt: 0.6, fD: 0.3, fS: 0, aD: 0.5, aS: 0 } },
    { name: "Vocal pad", values: { o1: 1, table: 2, pos: 0.2, posEnv: 0.5, fA: 1.5, fD: 3, aA: 0.8, aR: 2, cutoff: 3000, chorus: 2 } },
    { name: "Hard bass", values: { o1: 2, spread: 0.2, sub: 0.8, bal: 0.2, cutoff: 500, res: 0.4, route: 1, sat: 0.7, envAmt: 0.5, fD: 0.25, fS: 0.1, chorus: 0 } },
  ],
};

/* ------------------------------------------------------------------ */
/* Lead VA: Clavia Nord Lead 2 (1997)                                  */
/* ------------------------------------------------------------------ */
const nordParams: ParamDef[] = [
  { id: "w1", name: "Osc 1 wave", min: 0, max: 3, def: 0, options: ["Saw", "Pulse", "Triangle", "Sine"], group: "Osc 1" },
  { id: "fm", name: "FM amount", min: 0, max: 1, def: 0, unit: "%", group: "Osc 1" },
  { id: "w2", name: "Osc 2 wave", min: 0, max: 3, def: 0, options: ["Saw", "Pulse", "Triangle", "Noise"], group: "Osc 2" },
  { id: "semi", name: "Osc 2 semitones", min: -12, max: 48, def: 12, unit: "st", step: 1, group: "Osc 2" },
  { id: "fine", name: "Osc 2 fine", min: -50, max: 50, def: 0, unit: "ct", group: "Osc 2" },
  { id: "sync", name: "Sync", min: 0, max: 1, def: 1, options: ONOFF, group: "Osc 2" },
  { id: "pw", name: "Pulse width", min: 0.05, max: 0.5, def: 0.5, unit: "%", group: "Oscillators" },
  { id: "mix", name: "Osc mix", min: 0, max: 1, def: 0.6, unit: "%", group: "Oscillators" },
  { id: "modAmt", name: "Mod env to osc 2", min: 0, max: 48, def: 24, unit: "st", group: "Mod env" },
  { id: "modA", name: "Mod env attack", min: 0.001, max: 5, def: 0.001, unit: "s", curve: "exp", group: "Mod env" },
  { id: "modD", name: "Mod env decay", min: 0.005, max: 5, def: 0.6, unit: "s", curve: "exp", group: "Mod env" },
  { id: "fType", name: "Filter type", min: 0, max: 4, def: 1, options: ["LP 12", "LP 24", "Band-pass", "High-pass", "Notch + LP"], group: "Filter" },
  cutoffParam(2500),
  { id: "res", name: "Resonance", min: 0, max: 1, def: 0.3, unit: "%", group: "Filter" },
  { id: "envAmt", name: "Env amount", min: 0, max: 1, def: 0.4, unit: "%", group: "Filter" },
  { id: "kbd", name: "Keyboard track", min: 0, max: 3, def: 2, options: ["Off", "1/3", "2/3", "Full"], group: "Filter" },
  ...adsrParams("f", "Filter env", 0.002, 0.5, 0.3, 0.3),
  ...adsrParams("a", "Amp env", 0.002, 0.5, 0.9, 0.3),
  { id: "glide", name: "Portamento", min: 0, max: 1, def: 0, unit: "s", group: "Voice" },
];
const NP = indexOf(nordParams);
class NordVoice extends Voice {
  a = new Osc(); b = new Osc(0.2); nz = new Noise(13); f1 = new Svf(); f2 = new Svf(); fe = new Adsr(); ae = new Adsr(); me = new Adsr(); bOut = 0;
  trigger() { this.fe.gate(true); this.ae.gate(true); this.me.gate(true); }
  release() { this.fe.gate(false); this.ae.gate(false); this.me.gate(false); }
  get active() { return this.ae.active; }
  render(out: Float32Array, n: number, p: Float64Array, ctx: VoiceCtx) {
    const P = NP, rate = this.rate;
    const w1 = Math.round(p[P.w1]), w2 = Math.round(p[P.w2]), sync = p[P.sync] > 0.5, fm = p[P.fm] * 4, pw = p[P.pw], mix = p[P.mix];
    const ft = Math.round(p[P.fType]), res = p[P.res], env = p[P.envAmt] * 6, kbd = Math.round(p[P.kbd]) / 3;
    this.fe.set(p[P.fA], p[P.fD], p[P.fS], p[P.fR]); this.ae.set(p[P.aA], p[P.aD], p[P.aS], p[P.aR]); this.me.set(p[P.modA], p[P.modD], 0, p[P.modD]);
    const glide = p[P.glide], cutoff = p[P.cutoff];
    for (let i = 0; i < n; i++) {
      this.glideStep(glide);
      const base = this.hz(ctx, this.wander(1.5));
      const me = this.me.next(rate);
      this.a.step(base * (1 + fm * this.bOut), rate);
      const ao = w1 === 0 ? this.a.saw() : w1 === 1 ? this.a.pulse(pw) : w1 === 2 ? this.a.tri() : this.a.sine();
      this.b.step(base * 2 ** ((p[P.semi] - 12 + p[P.fine] / 100 + me * p[P.modAmt]) / 12), rate);
      if (sync) this.b.syncTo(this.a);
      const bo = w2 === 0 ? this.b.saw() : w2 === 1 ? this.b.pulse(pw) : w2 === 2 ? this.b.tri() : this.nz.white();
      this.bOut = this.b.sine();
      const x = ao * (1 - mix) + bo * mix;
      const fe = this.fe.next(rate);
      if ((i & 3) === 0) {
        const hz = cutoffHz(cutoff, env * fe + kbd * (this.pitch - 60) / 12, rate);
        this.f1.set(hz, rate, res * (ft === 1 ? 0.85 : 0.97)); if (ft === 1) this.f2.set(hz, rate, res * 0.6);
      }
      this.f1.process(x * 0.35);
      let y: number;
      if (ft === 0) y = this.f1.lp; else if (ft === 1) y = this.f2.process(this.f1.lp); else if (ft === 2) y = this.f1.bp; else if (ft === 3) y = this.f1.hp; else y = 0.5 * (this.f1.notch + this.f1.lp);
      out[i] += y * this.ae.next(rate) * (0.7 + 0.3 * this.vel);
    }
  }
}
export const leadVa: MachineDef = {
  id: "lead-va", name: "Lead VA", inspiredBy: "Clavia Nord Lead 2 (1997)", kind: "poly", voices: 8, level: 0.57,
  about: "The red virtual-analog lead: oscillator 2 synced to oscillator 1 with a modulation envelope sweeping its pitch (the classic sync lead), FM between the oscillators, and a multimode filter.",
  params: nordParams,
  createVoice: (rate, i) => new NordVoice(rate, i + 81),
  presets: [
    { name: "Sync sweep lead", values: {} },
    { name: "FM bass", values: { w1: 3, w2: 2, sync: 0, semi: 12, fm: 0.4, mix: 0.2, fType: 1, cutoff: 900, envAmt: 0.5, fD: 0.3, fS: 0.2 } },
    { name: "Notch keys", values: { sync: 0, fType: 4, res: 0.6, cutoff: 1500, modAmt: 0, aD: 0.8, aS: 0.3 } },
    { name: "Hard sync stab", values: { modAmt: 36, modD: 0.25, aD: 0.3, aS: 0, cutoff: 6000, envAmt: 0.2 } },
  ],
};

/* ------------------------------------------------------------------ */
/* Wave Scanner: PPG Wave 2.2 (1982)                                   */
/* ------------------------------------------------------------------ */
const ppgParams: ParamDef[] = [
  { id: "table", name: "Wavetable", min: 0, max: WAVETABLES.length - 1, def: 0, options: WAVETABLES, group: "Waves" },
  { id: "pos", name: "Wave", min: 0, max: 1, def: 0.2, unit: "%", group: "Waves" },
  { id: "envPos", name: "Env to wave", min: -1, max: 1, def: 0.5, group: "Waves" },
  { id: "lfoPos", name: "LFO to wave", min: 0, max: 1, def: 0, unit: "%", group: "Waves" },
  { id: "lfoRate", name: "LFO rate", min: 0.05, max: 20, def: 1, unit: "Hz", curve: "exp", group: "Waves" },
  { id: "semi2", name: "Osc 2 semitones", min: -24, max: 24, def: 0, unit: "st", step: 1, group: "Osc 2" },
  { id: "fine2", name: "Osc 2 detune", min: -50, max: 50, def: 8, unit: "ct", group: "Osc 2" },
  { id: "lvl2", name: "Osc 2 level", min: 0, max: 1, def: 0.5, unit: "%", group: "Osc 2" },
  { id: "grit", name: "Digital grit", min: 0, max: 1, def: 0.3, unit: "%", group: "Osc 2" },
  cutoffParam(2500),
  { id: "res", name: "Resonance", min: 0, max: 1, def: 0.2, unit: "%", group: "Filter" },
  { id: "envAmt", name: "Env amount", min: 0, max: 1, def: 0.3, unit: "%", group: "Filter" },
  { id: "kbd", name: "Keyboard", min: 0, max: 1, def: 0.5, unit: "%", group: "Filter" },
  ...adsrParams("e", "Env 1 (wave + filter)", 0.005, 1, 0.2, 0.5),
  ...adsrParams("a", "Env 3 (amp)", 0.005, 1, 0.8, 0.5),
];
const PG = indexOf(ppgParams);
class PpgVoice extends Voice {
  a = new Osc(); b = new Osc(0.5); f = new Cascade4("ota"); e = new Adsr(); ae = new Adsr(); lfo = new Lfo(17);
  trigger() { this.e.gate(true); this.ae.gate(true); }
  release() { this.e.gate(false); this.ae.gate(false); }
  get active() { return this.ae.active; }
  render(out: Float32Array, n: number, p: Float64Array, ctx: VoiceCtx) {
    const P = PG, rate = this.rate, tab = table(Math.round(p[P.table]));
    const r2 = 2 ** ((p[P.semi2] + p[P.fine2] / 100) / 12), l2 = p[P.lvl2];
    const levels = 2 ** (12 - 7 * p[P.grit]), k = p[P.res] * 4, env = p[P.envAmt] * 6;
    this.e.set(p[P.eA], p[P.eD], p[P.eS], p[P.eR]); this.ae.set(p[P.aA], p[P.aD], p[P.aS], p[P.aR]);
    const cutoff = p[P.cutoff];
    for (let i = 0; i < n; i++) {
      const base = this.hz(ctx);
      const e = this.e.next(rate), l = this.lfo.advance(p[P.lfoRate] / rate, 1);
      const pos = p[P.pos] + p[P.envPos] * e + p[P.lfoPos] * l * 0.5 + ctx.wheel * 0.5;
      this.a.step(base, rate); this.b.step(base * r2, rate);
      let x = readTable(tab, pos, this.a.phase, this.a.dt) + l2 * readTable(tab, pos, this.b.phase, this.b.dt);
      x = Math.round(x * levels) / levels; // the original's 8-bit waves and DAC
      if ((i & 3) === 0) this.f.set(cutoffHz(cutoff, env * e + p[P.kbd] * (this.pitch - 60) / 12, rate), rate);
      out[i] += this.f.process(x * 0.35, k, 1.2) * this.ae.next(rate) * (0.7 + 0.3 * this.vel);
    }
  }
}
export const waveScanner: MachineDef = {
  id: "wave-scanner", name: "Wave Scanner", inspiredBy: "PPG Wave 2.2 (1982)", kind: "poly", voices: 8, level: 1.07,
  about: "Two digital wavetable oscillators scanned by an envelope and LFO, with deliberately coarse digital output (Digital grit), into a 4-pole analog-style low-pass. The wavetables are SoundLab's own.",
  params: ppgParams,
  createVoice: (rate, i) => new PpgVoice(rate, i + 91),
  presets: [
    { name: "Glassy sweep", values: {} },
    { name: "Vowel pad", values: { table: 2, pos: 0, envPos: 0.9, eA: 1.5, eD: 3, aA: 0.5, aR: 1.5, cutoff: 4000 } },
    { name: "Sync bass", values: { table: 3, pos: 0.1, envPos: 0.6, eD: 0.3, eS: 0, semi2: -12, cutoff: 1200, envAmt: 0.5 } },
    { name: "Crushed bells", values: { table: 5, pos: 0.6, lfoPos: 0.4, grit: 0.8, aD: 1.5, aS: 0, aR: 1.2 } },
  ],
};

/* ------------------------------------------------------------------ */
/* Expressive Poly: Yamaha CS-80 (1977)                                */
/* ------------------------------------------------------------------ */
const csParams: ParamDef[] = [
  { id: "saw1", name: "Layer I saw", min: 0, max: 1, def: 0.8, unit: "%", group: "Layer I" },
  { id: "sq1", name: "Layer I square", min: 0, max: 1, def: 0, unit: "%", group: "Layer I" },
  { id: "sine1", name: "Layer I sine", min: 0, max: 1, def: 0.2, unit: "%", group: "Layer I" },
  { id: "saw2", name: "Layer II saw", min: 0, max: 1, def: 0.7, unit: "%", group: "Layer II" },
  { id: "sq2", name: "Layer II square", min: 0, max: 1, def: 0.2, unit: "%", group: "Layer II" },
  { id: "detune", name: "Layer II detune", min: 0, max: 30, def: 9, unit: "ct", group: "Layer II" },
  { id: "hpCut", name: "High-pass", min: 20, max: 3000, def: 120, unit: "Hz", curve: "exp", group: "Filter" },
  cutoffParam(1200),
  { id: "res", name: "Resonance", min: 0, max: 1, def: 0.25, unit: "%", group: "Filter" },
  { id: "il", name: "Initial level", min: 0, max: 1, def: 0.2, unit: "%", group: "Filter env" },
  { id: "al", name: "Attack level", min: 0, max: 1, def: 0.8, unit: "%", group: "Filter env" },
  { id: "fA", name: "Filter attack", min: 0.001, max: 5, def: 0.15, unit: "s", curve: "exp", group: "Filter env" },
  { id: "fD", name: "Filter decay", min: 0.01, max: 8, def: 1.2, unit: "s", curve: "exp", group: "Filter env" },
  { id: "fR", name: "Filter release", min: 0.01, max: 8, def: 0.8, unit: "s", curve: "exp", group: "Filter env" },
  ...adsrParams("a", "Amp", 0.08, 1, 0.85, 0.9),
  { id: "touch", name: "Touch (velocity)", min: 0, max: 1, def: 0.6, unit: "%", group: "Expression" },
  { id: "vibRate", name: "Sub-osc rate", min: 0.5, max: 12, def: 5.5, unit: "Hz", curve: "exp", group: "Expression" },
  { id: "vib", name: "Sub-osc vibrato", min: 0, max: 1, def: 0.15, unit: "%", group: "Expression" },
];
const CS = indexOf(csParams);
class CsVoice extends Voice {
  a = new Osc(); b = new Osc(0.6); hp1 = new OnePole(); hp2 = new OnePole(); lp = new Svf(); ae = new Adsr(); lfo = new Lfo(23);
  fe = 0; fstage = 0; // 1 attack (IL->AL), 2 decay (->0), 3 release
  trigger() { this.ae.gate(true); this.fstage = 1; this.fe = -1; }
  release() { this.ae.gate(false); this.fstage = 3; }
  get active() { return this.ae.active; }
  render(out: Float32Array, n: number, p: Float64Array, ctx: VoiceCtx) {
    const P = CS, rate = this.rate;
    const rd = 2 ** (p[P.detune] / 1200), touch = p[P.touch] * this.vel;
    this.ae.set(p[P.aA], p[P.aD], p[P.aS], p[P.aR]);
    this.hp1.set(p[P.hpCut], rate); this.hp2.set(p[P.hpCut], rate);
    if (this.fe < 0) this.fe = p[P.il];
    const ca = 1 - Math.exp(-4 / (p[P.fA] * rate)), cd = 1 - Math.exp(-4 / (p[P.fD] * rate)), cr = 1 - Math.exp(-4 / (p[P.fR] * rate));
    const cutoff = p[P.cutoff];
    for (let i = 0; i < n; i++) {
      const v = this.lfo.advance(p[P.vibRate] / rate, 0) * (p[P.vib] * 0.25 + ctx.wheel * 0.35);
      const base = this.hz(ctx, v + this.wander(6));
      this.a.step(base, rate); this.b.step(base * rd, rate);
      const x = this.a.saw() * p[P.saw1] + this.a.pulse(0.5) * p[P.sq1] + this.a.sine() * p[P.sine1] + this.b.saw() * p[P.saw2] + this.b.pulse(0.5) * p[P.sq2];
      if (this.fstage === 1) { this.fe += (p[P.al] - this.fe) * ca; if (Math.abs(this.fe - p[P.al]) < 0.01) this.fstage = 2; }
      else if (this.fstage === 2) this.fe += (0 - this.fe) * cd;
      else this.fe += (0 - this.fe) * cr;
      if ((i & 3) === 0) this.lp.set(cutoffHz(cutoff, this.fe * 5 + touch * 2 + (this.pitch - 60) / 24, rate), rate, p[P.res] * 0.9);
      const y = this.lp.process(this.hp2.hp(this.hp1.hp(x * 0.3)));
      out[i] += y * this.ae.next(rate) * (1 - p[P.touch] * 0.5 + touch * 0.5);
    }
  }
}
export const expressivePoly: MachineDef = {
  id: "expressive-poly", name: "Expressive Poly", inspiredBy: "Yamaha CS-80 (1977)", kind: "poly", voices: 8, level: 0.84,
  about: "Two layers of saw, square and sine through a 12 dB high-pass and resonant low-pass, with the IL/AL filter envelope (from an initial level to an attack level, then down) and touch: velocity opens the filter and raises the level.",
  params: csParams,
  createVoice: (rate, i) => new CsVoice(rate, i + 101),
  presets: [
    { name: "Velvet brass", values: {} },
    { name: "Blade pad", values: { sine1: 0.4, sq2: 0, detune: 14, il: 0.1, al: 0.5, fA: 1.2, fD: 4, aA: 0.9, aR: 2.5, vib: 0.3 } },
    { name: "Bright keys", values: { sq1: 0.4, saw2: 0.3, il: 0.6, al: 1, fA: 0.005, fD: 0.6, aA: 0.003, aD: 1.2, aS: 0.2, hpCut: 300 } },
  ],
};
