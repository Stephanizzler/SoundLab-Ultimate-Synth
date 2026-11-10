// Chorus Poly: the Roland Juno-60 (1982), section by section: Arpeggio,
// LFO, DCO, HPF, VCF, VCA, ENV, Chorus. Six voices.
import { Osc, Noise } from "../dsp/osc.ts";
import { Cascade4, OnePole } from "../dsp/filters.ts";
import { Adsr } from "../dsp/env.ts";
import { JunoChorus } from "../dsp/fx.ts";
import { Voice, indexOf, arpParams, type MachineDef, type ParamDef, type VoiceCtx } from "../engine/machine.ts";
import { cutoffHz, sw, pct, opt, adsr, hzp, time, VLfo, delayFade } from "./common.ts";

const LF = "LFO", D = "DCO", H = "HPF", F = "VCF", A = "VCA", CH = "Chorus";
const params: ParamDef[] = [
  ...arpParams("Arpeggio", 3),
  hzp("lfoRate", "Rate", 3, LF, 0.1, 20), time("lfoDelay", "Delay time", 0.001, LF, 0.001, 3), opt("lfoTrig", "Trigger mode", ["Auto", "Manual"], 0, LF),
  pct("lfoP", "LFO (pitch)", 0, D), opt("range", "Range", ["16'", "8'", "4'"], 1, D),
  pct("pw", "PWM", 0.3, D), opt("pwm", "PWM mode", ["LFO", "Manual"], 0, D),
  sw("pulse", "Pulse", 0, D), sw("saw", "Sawtooth", 1, D), sw("subOn", "Sub osc", 1, D), pct("sub", "Sub level", 0.4, D), pct("noise", "Noise level", 0, D),
  opt("hpf", "HPF", ["0 (bass boost)", "1 (flat)", "2", "3"], 1, H),
  hzp("cutoff", "Frequency", 1500, F), pct("res", "Resonance", 0.2, F), opt("envPol", "Env polarity", ["+", "−"], 0, F),
  pct("envAmt", "Env", 0.4, F), pct("lfoF", "LFO", 0, F), pct("kbd", "Kybd", 0.5, F),
  opt("vca", "Mode", ["Env", "Gate"], 0, A), pct("vcaLevel", "Level", 0.8, A),
  ...adsr("", "ENV", 0.003, 0.6, 0.6, 0.35),
  opt("chorus", "Chorus", ["Off", "I", "II", "I + II"], 1, CH),
];
const P = indexOf(params);
const HPF_HZ = [0, 0, 240, 720];

class JunoVoice extends Voice {
  o = new Osc(); nz = new Noise(9); f = new Cascade4("ota"); hp = new OnePole(); boost = new OnePole(); e = new Adsr(); lfo = new VLfo(33); held = 0;
  trigger() { this.e.gate(true); this.held = 0; }
  release() { this.e.gate(false); }
  get active() { return this.e.active; }
  render(out: Float32Array, n: number, p: Float64Array, ctx: VoiceCtx) {
    const rate = this.rate;
    const ratio = 2 ** (Math.round(p[P.range]) - 1);
    const saw = p[P.saw] > 0.5, pul = p[P.pulse] > 0.5, sub = p[P.subOn] > 0.5 ? p[P.sub] : 0, pwmLfo = p[P.pwm] < 0.5;
    const k = p[P.res] * 4.05, env = p[P.envAmt] * 6 * (p[P.envPol] > 0.5 ? -1 : 1), kbd = p[P.kbd], gateMode = p[P.vca] > 0.5;
    const hpf = Math.round(p[P.hpf]); if (hpf >= 2) this.hp.set(HPF_HZ[hpf], rate); this.boost.set(90, rate);
    this.e.set(p[P.A], p[P.D], p[P.S], p[P.R]);
    const manual = p[P.lfoTrig] > 0.5, cutoff = p[P.cutoff], level = p[P.vcaLevel] * 1.25;
    for (let i = 0; i < n; i++) {
      this.held++;
      // The LFO delay fades in from each new note (Auto) or runs freely (Manual).
      const l = this.lfo.next(p[P.lfoRate], rate, "Triangle") * (manual ? 1 : delayFade(this.held, p[P.lfoDelay], rate));
      const e = this.e.next(rate);
      this.o.step(this.hz(ctx, l * p[P.lfoP] * 1.5) * ratio, rate);
      const width = 0.5 - 0.45 * Math.max(0, Math.min(1, pwmLfo ? p[P.pw] * (0.5 + 0.5 * l) : p[P.pw]));
      let x = (saw ? this.o.saw() : 0) + (pul ? this.o.pulse(width) : 0) + this.o.subSquare() * sub + this.nz.white() * p[P.noise];
      if (hpf >= 2) x = this.hp.hp(x); else if (hpf === 0) x += this.boost.lp(x) * 0.6;
      if ((i & 3) === 0) this.f.set(cutoffHz(cutoff, env * e + p[P.lfoF] * l * 2 + kbd * (this.pitch - 60) / 12, rate), rate);
      const amp = gateMode ? (this.gateOn ? 1 : 0) : e;
      out[i] += this.f.process(x * 0.35, k, 1.1) * amp * level;
    }
    if (gateMode && !this.gateOn) this.e.reset();
  }
}
class JunoFx { c: JunoChorus; constructor(rate: number) { this.c = new JunoChorus(rate); } process(L: Float32Array, R: Float32Array, n: number, p: Float64Array) { this.c.process(L, R, n, Math.round(p[P.chorus])); } }

export const juno60: MachineDef = {
  id: "chorus-poly", name: "Chorus Poly", inspiredBy: "Roland Juno-60 (1982)", kind: "poly", voices: 6, level: 1.29,
  about: "Six voices, each one stable DCO with pulse (width from the LFO or set by hand), sawtooth, a sub-octave square and noise; the four-position high-pass; a 4-pole resonant VCF with envelope polarity, LFO and keyboard follow; a VCA on the envelope or gate; one ADSR; the delayed LFO; the arpeggiator (up, down, up & down over 1-3 octaves); and the stereo bucket-brigade chorus I, II and I + II.",
  params,
  createVoice: (rate, i) => new JunoVoice(rate, i + 21),
  createFx: (rate) => new JunoFx(rate),
  presets: [
    { name: "Classic chorus poly", values: {} },
    { name: "PWM strings", values: { saw: 0, pulse: 1, pw: 0.6, pwm: 0, lfoRate: 0.8, sub: 0.2, cutoff: 3000, envAmt: 0.1, A: 0.4, R: 1.2, chorus: 2 } },
    { name: "Hoover", values: { range: 0, saw: 1, pulse: 1, pw: 0.7, pwm: 0, lfoRate: 6, sub: 0.8, cutoff: 700, res: 0.3, envAmt: 0.5, D: 0.4, S: 0.3, chorus: 3 } },
    { name: "Organ (gate)", values: { saw: 0, pulse: 1, pw: 0, pwm: 1, sub: 0.6, cutoff: 6000, envAmt: 0, vca: 1, chorus: 3 } },
    { name: "Arpeggio pluck", values: { arp: 1, arpRange: 1, arpRate: 3, cutoff: 900, res: 0.45, envAmt: 0.6, D: 0.3, S: 0, R: 0.2, chorus: 1 } },
    { name: "Sub bass", values: { range: 0, saw: 1, subOn: 1, sub: 1, cutoff: 400, res: 0.1, envAmt: 0.3, D: 0.5, S: 0.7, chorus: 0, kbd: 0.2 } },
    { name: "Brass", values: { saw: 1, sub: 0.2, cutoff: 700, envAmt: 0.55, A: 0.05, D: 0.6, S: 0.7, chorus: 1 } },
    { name: "Inverted sweep pad", values: { saw: 1, pulse: 1, pw: 0.4, cutoff: 6000, res: 0.5, envPol: 1, envAmt: 0.6, A: 2, D: 3, S: 0.4, R: 2, chorus: 2, lfoF: 0.15, lfoRate: 0.3 } },
  ],
};
