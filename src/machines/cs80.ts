// Expressive Poly: the Yamaha CS-80 (1977). Two complete channels (I and II)
// per voice, each with its own oscillator, high- and low-pass filters with
// the IL/AL envelope, and amplifier envelope; plus the sub oscillator (LFO),
// initial and after touch, the ring modulator, detune and brilliance. Eight voices.
import { Osc, Noise } from "../dsp/osc.ts";
import { Svf } from "../dsp/filters.ts";
import { Adsr } from "../dsp/env.ts";
import { Voice, indexOf, type MachineDef, type ParamDef, type VoiceCtx } from "../engine/machine.ts";
import { cutoffHz, sw, pct, opt, time, hzp, bip, cents, feet, VLfo } from "./common.ts";

const FT = ["16'", "8'", "4'"] as const, FS = feet(FT);
const channel = (c: "i" | "ii", g: string, on: number): ParamDef[] => [
  opt(`${c}Feet`, "Feet", FT, 1, g),
  sw(`${c}Sq`, "Square", c === "i" ? 0 : 1, g), pct(`${c}Pw`, "Pulse width", 0.5, g), hzp(`${c}PwmRate`, "PWM speed", 2, g, 0.1, 15), pct(`${c}PwmDepth`, "PWM depth", 0, g),
  sw(`${c}Saw`, "Sawtooth", 1, g), pct(`${c}Noise`, "Noise", 0, g), pct(`${c}Sine`, "Sine", c === "i" ? 0.2 : 0, g),
  hzp(`${c}Hp`, "HPF cutoff", 80, g, 20, 4000), pct(`${c}HpRes`, "HPF resonance", 0, g),
  hzp(`${c}Lp`, "LPF cutoff", 1200, g), pct(`${c}LpRes`, "LPF resonance", 0.2, g),
  pct(`${c}IL`, "Initial level", 0.2, g), pct(`${c}AL`, "Attack level", 0.8, g),
  time(`${c}fA`, "Filter attack", 0.15, g, 0.001, 5), time(`${c}fD`, "Filter decay", 1.2, g, 0.01, 8), time(`${c}fR`, "Filter release", 0.8, g, 0.01, 8),
  pct(`${c}Level`, "Level", on, g),
  time(`${c}aA`, "VCA attack", 0.08, g), time(`${c}aD`, "VCA decay", 1, g, 0.005), pct(`${c}aS`, "VCA sustain", 0.85, g), time(`${c}aR`, "VCA release", 0.9, g, 0.005),
];
const SUB_W = ["Sine", "Saw down", "Saw up", "Square", "Random (S&H)", "Smooth random"] as const;
const G = "Global", SO = "Sub oscillator", T = "Touch response", RM = "Ring modulator";
const params: ParamDef[] = [
  ...channel("i", "Channel I", 0.8), ...channel("ii", "Channel II", 0.7),
  pct("balance", "Channel I ↔ II", 0.5, G), cents("detune", "Channel II detune", 9, G, 50),
  bip("bril", "Brilliance", 0, G), bip("resAll", "Resonance", 0, G),
  hzp("subRate", "Speed", 5.5, SO, 0.1, 30), opt("subWave", "Function", SUB_W, 0, SO),
  pct("subVco", "VCO depth", 0.1, SO), pct("subVcf", "VCF depth", 0, SO), pct("subVca", "VCA depth", 0, SO),
  pct("tBril", "Initial: brilliance", 0.6, T), pct("tLevel", "Initial: level", 0.5, T),
  pct("aBril", "After: brilliance", 0.4, T), pct("aLevel", "After: level", 0.2, T), pct("aPitch", "After: pitch", 0, T),
  pct("ring", "Depth", 0, RM), hzp("ringRate", "Speed", 30, RM, 1, 2000), time("ringA", "Attack", 0.001, RM, 0.001, 5), time("ringD", "Decay", 2, RM, 0.01, 10),
];
const P = indexOf(params);
type Ch = { o: Osc; hp: Svf; lp: Svf; ae: Adsr; fe: number; fst: number; pwm: VLfo };
const mkCh = (seed: number): Ch => ({ o: new Osc(seed / 10), hp: new Svf(), lp: new Svf(), ae: new Adsr(), fe: 0, fst: 0, pwm: new VLfo(seed) });

class CsVoice extends Voice {
  ch: Ch[] = [mkCh(1), mkCh(7)]; nz = new Noise(23); sub = new VLfo(23); ringPh = 0; ringEnv = 0; ringUp = true;
  trigger() { for (const c of this.ch) { c.ae.gate(true); c.fst = 1; c.fe = -1; } this.ringEnv = 0; this.ringUp = true; }
  release() { for (const c of this.ch) { c.ae.gate(false); c.fst = 3; } }
  get active() { return this.ch[0].ae.active || this.ch[1].ae.active; }
  render(out: Float32Array, n: number, p: Float64Array, ctx: VoiceCtx) {
    const rate = this.rate, sw = SUB_W[Math.round(p[P.subWave])];
    const touchB = p[P.tBril] * this.vel + p[P.aBril] * ctx.press, touchL = 1 - p[P.tLevel] * (1 - this.vel) + p[P.aLevel] * ctx.press * 0.5;
    const bal = p[P.balance], gains = [1 - bal, bal].map((g) => Math.min(1, g * 2));
    const rA = 1 - Math.exp(-4 / (p[P.ringA] * rate)), rD = Math.exp(-4 / (p[P.ringD] * rate));
    const cfg = (["i", "ii"] as const).map((c, k) => {
      const q = (id: string) => p[P[`${c}${id}`]];
      this.ch[k].ae.set(q("aA"), q("aD"), q("aS"), q("aR"));
      return {
        ratio: 2 ** ((FS[Math.round(q("Feet"))] + (k === 1 ? p[P.detune] / 100 : 0)) / 12), sq: q("Sq") > 0.5, saw: q("Saw") > 0.5, pw: q("Pw"), pwmR: q("PwmRate"), pwmD: q("PwmDepth"),
        noise: q("Noise"), sine: q("Sine"), hp: q("Hp"), hpRes: q("HpRes"), lp: q("Lp"), lpRes: Math.max(0, Math.min(1, q("LpRes") + p[P.resAll] * 0.5)),
        il: q("IL"), al: q("AL"), ca: 1 - Math.exp(-4 / (q("fA") * rate)), cd: 1 - Math.exp(-4 / (q("fD") * rate)), cr: 1 - Math.exp(-4 / (q("fR") * rate)), level: q("Level"),
      };
    });
    for (let i = 0; i < n; i++) {
      const s = this.sub.next(p[P.subRate], rate, sw);
      const base = this.hz(ctx, s * (p[P.subVco] * 0.5 + ctx.wheel * 0.4) + ctx.press * p[P.aPitch] * 2 + this.wander(6));
      // Ring modulator with its own attack/decay on depth.
      if (this.ringUp) { this.ringEnv += (1.05 - this.ringEnv) * rA; if (this.ringEnv >= 1) { this.ringEnv = 1; this.ringUp = false; } } else this.ringEnv *= rD;
      this.ringPh += p[P.ringRate] / rate; if (this.ringPh >= 1) this.ringPh -= 1;
      let mix = 0;
      for (let k = 0; k < 2; k++) {
        const c = this.ch[k], g = cfg[k];
        if (!c.ae.active) continue;
        c.o.step(base * g.ratio, rate);
        const pw = Math.max(0.03, Math.min(0.97, g.pw + c.pwm.next(g.pwmR, rate, "Triangle") * g.pwmD * 0.45));
        const x = (g.sq ? c.o.pulse(pw) : 0) + (g.saw ? c.o.saw() : 0) + this.nz.white() * g.noise;
        if (c.fe < 0) c.fe = g.il;
        if (c.fst === 1) { c.fe += (g.al - c.fe) * g.ca; if (Math.abs(c.fe - g.al) < 0.005) c.fst = 2; }
        else if (c.fst === 2) c.fe -= c.fe * g.cd; else c.fe -= c.fe * g.cr;
        if ((i & 3) === 0) {
          const mod = c.fe * 5 + touchB * 2 + p[P.bril] * 2 + s * p[P.subVcf] * 2 + (this.pitch - 60) / 24;
          c.hp.set(cutoffHz(g.hp, mod * 0.3, rate), rate, g.hpRes * 0.9);
          c.lp.set(cutoffHz(g.lp, mod, rate), rate, g.lpRes * 0.92);
        }
        c.hp.process(x * 0.3);
        const y = c.lp.process(c.hp.hp) + c.o.sine() * g.sine * 0.3; // the sine bypasses the filters
        mix += y * c.ae.next(rate) * g.level * gains[k];
      }
      const ring = 1 - p[P.ring] * this.ringEnv * (0.5 - 0.5 * Math.sin(2 * Math.PI * this.ringPh)) * 2;
      out[i] += mix * ring * touchL * (1 + s * p[P.subVca] * 0.6);
    }
  }
}

export const cs80: MachineDef = {
  id: "expressive-poly", name: "SeaSaw-80", inspiredBy: "Yamaha CS-80 (1977)", kind: "poly", voices: 8, level: 0.84,
  about: "Eight voices, each with two full channels: an oscillator with square (and PWM), sawtooth, noise and a sine that skips the filters; a resonant high-pass and low-pass driven by the IL/AL envelope (from an initial level to an attack level, then down); and its own amplifier envelope. The sub oscillator modulates pitch, filters and level; velocity (initial touch) and aftertouch open the brilliance and raise the level; the ring modulator has its own attack and decay. Polyphonic aftertouch and the ribbon are not modelled: aftertouch is per channel, and pitch bend stands in for the ribbon.",
  params,
  createVoice: (rate, i) => new CsVoice(rate, i + 101),
  presets: [
    { name: "Velvet brass", role: "brass", values: {} },
    { name: "Blade pad", role: "pad", values: { iSine: 0.4, iiSq: 0, detune: 14, iIL: 0.1, iAL: 0.5, iifA: 1.2, ifA: 1.2, ifD: 4, iifD: 4, iaA: 0.9, iiaA: 0.9, iaR: 2.5, iiaR: 2.5, subVco: 0.2 } },
    { name: "Bright keys", role: "keys", values: { iSq: 1, iiSaw: 0, iIL: 0.6, iAL: 1, ifA: 0.005, ifD: 0.6, iaA: 0.003, iaD: 1.2, iaS: 0.2, iiaA: 0.003, iiaD: 1.2, iiaS: 0.2, iHp: 300 } },
    { name: "Ring-mod bells", role: "bell", values: { iSaw: 0, iSine: 1, iiSaw: 0, iiSq: 0, iiSine: 1, iiFeet: 2, ring: 0.8, ringRate: 420, ringD: 3, iaA: 0.002, iaD: 3, iaS: 0, iiaA: 0.002, iiaD: 2.5, iiaS: 0 } },
    { name: "Swelling strings", role: "strings", values: { iSq: 1, iPwmDepth: 0.6, iiPwmDepth: 0.6, detune: 12, iaA: 0.6, iiaA: 0.7, iaR: 1.5, iiaR: 1.5, iIL: 0.3, iAL: 0.5, subVco: 0.15, subRate: 5 } },
    { name: "Touch lead", role: "lead", values: { balance: 0.2, iFeet: 1, iLpRes: 0.5, iIL: 0, iAL: 0.6, tBril: 1, aBril: 0.8, aPitch: 0.3, iaS: 1, subVco: 0.25 } },
    { name: "Noise wind", role: "fx", values: { iSaw: 0, iiSaw: 0, iiSq: 0, iNoise: 1, iiNoise: 0.6, iLpRes: 0.8, iiLpRes: 0.8, iLp: 600, iiLp: 1800, iaA: 0.8, iiaA: 1.2 } },
    { name: "Organ", role: "organ", values: { iSaw: 0, iSq: 1, iSine: 0.6, iiFeet: 0, iiSq: 1, iiSaw: 0, iIL: 0.8, iAL: 0.8, iiIL: 0.8, iiAL: 0.8, iaA: 0.003, iaS: 1, iiaA: 0.003, iiaS: 1, iaR: 0.05, iiaR: 0.05 } },
    { name: "Deep bass", role: "bass", values: { iFeet: 0, iiFeet: 0, iSaw: 1, iiSaw: 1, iSq: 0, iiSq: 0, iSine: 0.3, iLp: 380, iiLp: 500, iLpRes: 0.3, iIL: 0.1, iAL: 0.6, iiIL: 0.1, iiAL: 0.5, ifA: 0.005, ifD: 0.3, iifA: 0.005, iifD: 0.4, iaA: 0.003, iaD: 0.5, iaS: 0.6, iiaA: 0.003, iiaD: 0.5, iiaS: 0.6, iaR: 0.2, iiaR: 0.2 } },
    { name: "Soft electric piano", role: "keys", values: { iSaw: 0, iSq: 0, iSine: 1, iiSaw: 1, iiSq: 0, iiLp: 1500, iiLevel: 0.4, iaA: 0.002, iaD: 2, iaS: 0, iiaA: 0.002, iiaD: 0.8, iiaS: 0, iaR: 0.5, iiaR: 0.4 } },
    { name: "Celestial pad", role: "pad", values: { iSq: 1, iPwmDepth: 0.4, iSine: 0.5, iLp: 900, iiLp: 2500, iLpRes: 0.4, ifA: 1.5, iifA: 2, ifD: 4, iifD: 4, iaA: 1.2, iiaA: 1.5, iaR: 3, iiaR: 3, subVco: 0.1, subRate: 4.5 } },
    { name: "Sweeping filter lead", role: "lead", values: { balance: 0.85, iSaw: 1, iSq: 0, iLp: 700, iLpRes: 0.6, iIL: 0.1, iAL: 0.7, ifA: 0.4, ifD: 2, iaS: 1, subVco: 0.2, subRate: 5.5 } },
  ],
};
