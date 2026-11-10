// Drum machines. Every sound is synthesised from the circuit ideas of the
// originals: bridged-T resonators (decaying sines) for kicks and toms, tone
// plus filtered noise for snares, six detuned square waves through band-pass
// filters for the 808's hats, cymbal and cowbell. Nothing is sampled.
import { Noise } from "../dsp/osc.ts";
import { Biquad, OnePole } from "../dsp/filters.ts";
import { TAU, tanh } from "../dsp/util.ts";
import { Voice, indexOf, type MachineDef, type ParamDef, type VoiceCtx } from "../engine/machine.ts";

type Kind = "kick" | "rim" | "snare" | "clap" | "tomL" | "tomM" | "tomH" | "ch" | "oh" | "cow" | "cym" | "ride";
const KIT: Record<number, { kind: Kind; name: string }> = {
  36: { kind: "kick", name: "Kick" }, 37: { kind: "rim", name: "Rim shot" }, 38: { kind: "snare", name: "Snare" }, 39: { kind: "clap", name: "Clap" },
  41: { kind: "tomL", name: "Low tom" }, 45: { kind: "tomM", name: "Mid tom" }, 50: { kind: "tomH", name: "High tom" },
  42: { kind: "ch", name: "Closed hat" }, 46: { kind: "oh", name: "Open hat" }, 56: { kind: "cow", name: "Cowbell" }, 49: { kind: "cym", name: "Cymbal" }, 51: { kind: "ride", name: "Ride" },
};
// The 808's six metal oscillators (Hz), from its service notes.
const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800];

const drumParams = (nine: boolean): ParamDef[] => [
  { id: "kTune", name: "Kick tune", min: 35, max: 90, def: nine ? 52 : 48, unit: "Hz", group: "Kick" },
  { id: "kDecay", name: "Kick decay", min: 0.08, max: 3, def: nine ? 0.45 : 0.9, unit: "s", curve: "exp", group: "Kick" },
  { id: "kAttack", name: nine ? "Kick attack" : "Kick tone", min: 0, max: 1, def: nine ? 0.6 : 0.3, unit: "%", group: "Kick" },
  { id: "kDrive", name: "Kick drive", min: 0, max: 1, def: nine ? 0.4 : 0.1, unit: "%", group: "Kick" },
  { id: "sTune", name: "Snare tune", min: -12, max: 12, def: 0, unit: "st", group: "Snare" },
  { id: "sTone", name: "Snare tone", min: 0, max: 1, def: 0.5, unit: "%", group: "Snare" },
  { id: "snappy", name: "Snappy", min: 0, max: 1, def: 0.6, unit: "%", group: "Snare" },
  { id: "clap", name: "Clap decay", min: 0.05, max: 1, def: 0.2, unit: "s", curve: "exp", group: "Snare" },
  { id: "tTune", name: "Tom tune", min: -12, max: 12, def: 0, unit: "st", group: "Toms" },
  { id: "tDecay", name: "Tom decay", min: 0.08, max: 1.5, def: 0.35, unit: "s", curve: "exp", group: "Toms" },
  { id: "hTone", name: "Hat tone", min: 0, max: 1, def: 0.5, unit: "%", group: "Hats & cymbals" },
  { id: "chDecay", name: "Closed hat decay", min: 0.01, max: 0.3, def: 0.05, unit: "s", curve: "exp", group: "Hats & cymbals" },
  { id: "ohDecay", name: "Open hat decay", min: 0.08, max: 2, def: 0.45, unit: "s", curve: "exp", group: "Hats & cymbals" },
  { id: "cDecay", name: nine ? "Crash / ride decay" : "Cymbal decay", min: 0.2, max: 5, def: 1.4, unit: "s", curve: "exp", group: "Hats & cymbals" },
  { id: "accent", name: "Velocity response", min: 0, max: 1, def: 0.6, unit: "%", group: "Global" },
];

class DrumVoice extends Voice {
  kind: Kind = "kick"; t = 0; ph = 0; ph2 = 0; mph = new Float64Array(6); nz: Noise;
  bp1 = new Biquad(); bp2 = new Biquad(); hp = new Biquad(); lp = new OnePole(); amp = 1; choked = false; dur = 0;
  P: Record<string, number>;
  readonly nine: boolean;
  constructor(rate: number, seed: number, nine: boolean) { super(rate, seed); this.nine = nine; this.nz = new Noise(seed * 101 + 7); this.P = nine ? NINE : EIGHT; }
  trigger() { this.kind = KIT[this.note]?.kind ?? "rim"; this.t = 0; this.ph = 0; this.ph2 = 0.25; this.choked = false; this.dur = 0; this.bp1.z1 = this.bp1.z2 = this.bp2.z1 = this.bp2.z2 = this.hp.z1 = this.hp.z2 = 0; }
  release() {}
  choke(note: number) { if (note === 42 && this.kind === "oh") this.choked = true; }
  get active() { return this.note >= 0 && (this.dur === 0 || this.t < this.dur); }
  metal(rate: number, scale: number) {
    let s = 0;
    for (let k = 0; k < 6; k++) { this.mph[k] += (METAL[k] * scale) / rate; if (this.mph[k] >= 1) this.mph[k] -= 1; s += this.mph[k] < 0.5 ? 1 : -1; }
    return s / 6;
  }
  render(out: Float32Array, n: number, p: Float64Array, _ctx: VoiceCtx) {
    const P = this.P, rate = this.rate, nine = this.nine;
    const acc = p[P.accent], gain = (1 - acc + acc * this.vel) * (1 + (this.accent ? 0.4 : 0));
    const kind = this.kind;
    if (this.t === 0) {
      // Set up filters and length for this hit.
      const hTone = p[P.hTone];
      if (kind === "ch" || kind === "oh") { this.bp1.bandpass(nine ? 9000 : 7100 + hTone * 3000, 1.2, rate); this.hp.highpass(6000 + hTone * 2500, 0.7, rate); }
      else if (kind === "cym" || kind === "ride") { this.bp1.bandpass(kind === "ride" ? 5200 : 3440, 1.0, rate); this.bp2.bandpass(7100 + hTone * 2000, 1.2, rate); this.hp.highpass(kind === "ride" ? 3000 : 2400, 0.7, rate); }
      else if (kind === "cow") { this.bp1.bandpass(2640, 3, rate); }
      else if (kind === "clap") { this.bp1.bandpass(1050, 1.8, rate); }
      else if (kind === "snare") { this.hp.highpass(nine ? 1800 : 2200, 0.7, rate); this.lp.set(nine ? 9000 : 7500, rate); }
      else if (kind === "rim") { this.bp1.bandpass(1700, 4, rate); this.bp2.bandpass(500, 3, rate); }
      const tomD = p[P.tDecay];
      this.dur = { kick: p[P.kDecay] * 1.2, rim: 0.05, snare: 0.4, clap: p[P.clap] + 0.1, tomL: tomD * 1.4, tomM: tomD * 1.2, tomH: tomD, ch: p[P.chDecay] * 2, oh: p[P.ohDecay] * 1.6, cow: 0.5, cym: p[P.cDecay] * 1.5, ride: p[P.cDecay] * 1.8 }[kind] * 1.1 + 0.02;
    }
    const sT = 2 ** (p[P.sTune] / 12), tT = 2 ** (p[P.tTune] / 12);
    for (let i = 0; i < n; i++) {
      const t = this.t / rate; this.t++;
      if (this.t >= this.dur * rate) break;
      let y = 0;
      switch (kind) {
        case "kick": {
          const sweep = nine ? 1 + (2.5 + p[P.kAttack] * 2) * Math.exp(-t / 0.018) : 1 + 0.5 * Math.exp(-t / 0.006);
          this.ph += (p[P.kTune] * sweep) / rate; if (this.ph >= 1) this.ph -= 1;
          const body = nine ? 0.85 * Math.sin(TAU * this.ph) + 0.15 * (1 - 4 * Math.abs(this.ph - 0.5)) : Math.sin(TAU * this.ph);
          const env = Math.exp(-t / (p[P.kDecay] / 4.5));
          const click = nine ? this.nz.white() * Math.exp(-t / 0.003) * p[P.kAttack] * 0.6 : (t < 0.0015 ? 1 : 0) * p[P.kAttack] * 0.8;
          const d = 1 + p[P.kDrive] * 6;
          y = (tanh((body * env + click) * d) / tanh(d)) * 0.9;
          break;
        }
        case "tomL": case "tomM": case "tomH": {
          const base = (kind === "tomL" ? 90 : kind === "tomM" ? 130 : 180) * tT * (nine ? 1.1 : 1);
          this.ph += (base * (1 + (nine ? 0.6 : 0.25) * Math.exp(-t / 0.03))) / rate; if (this.ph >= 1) this.ph -= 1;
          const d = p[P.tDecay] * (kind === "tomL" ? 1.3 : kind === "tomM" ? 1.1 : 1);
          y = Math.sin(TAU * this.ph) * Math.exp(-t / (d / 4.5)) * 0.8 + this.nz.white() * Math.exp(-t / 0.02) * (nine ? 0.15 : 0.05);
          break;
        }
        case "snare": {
          const f1 = (nine ? 180 : 238) * sT, f2 = (nine ? 330 : 476) * sT;
          const sw = nine ? 1 + 0.3 * Math.exp(-t / 0.02) : 1;
          this.ph += (f1 * sw) / rate; this.ph2 += (f2 * sw) / rate; if (this.ph >= 1) this.ph -= 1; if (this.ph2 >= 1) this.ph2 -= 1;
          const tone = (Math.sin(TAU * this.ph) + 0.6 * Math.sin(TAU * this.ph2)) * Math.exp(-t / (nine ? 0.04 : 0.05));
          const noise = this.lp.lp(this.hp.process(this.nz.white())) * Math.exp(-t / (0.04 + p[P.snappy] * 0.12));
          y = tone * (1 - p[P.sTone] * 0.6) * 0.6 + noise * p[P.snappy] * 1.6 * (0.4 + p[P.sTone] * 0.6);
          break;
        }
        case "clap": {
          // Three quick bursts, then the diffuse tail.
          const burst = t < 0.03 ? Math.exp(-((t % 0.0105) / 0.0035)) : 0;
          const tail = t >= 0.02 ? Math.exp(-(t - 0.02) / (p[P.clap] / 3)) : 0;
          y = this.bp1.process(this.nz.white()) * (burst * 1.4 + tail) * 2.4;
          break;
        }
        case "rim": {
          this.ph += 1700 / rate; if (this.ph >= 1) this.ph -= 1;
          const exc = (t < 0.0008 ? 1 : 0) + Math.sin(TAU * this.ph) * 0.3 * Math.exp(-t / 0.006);
          y = (this.bp1.process(exc) + this.bp2.process(exc) * 0.6) * Math.exp(-t / 0.012) * 3;
          break;
        }
        case "ch": case "oh": {
          const src = nine ? 0.55 * this.metal(rate, 1.8) + 0.45 * this.nz.white() : this.metal(rate, 1);
          const dec = kind === "ch" ? p[P.chDecay] : p[P.ohDecay];
          const env = Math.exp(-t / (dec / 4.5)) * (this.choked ? Math.exp(-this.t / (rate * 0.004)) : 1);
          y = this.hp.process(this.bp1.process(src)) * env * 2.4;
          if (this.choked && env < 1e-4) this.t = this.dur * rate;
          break;
        }
        case "cow": {
          this.ph += 540 / rate; this.ph2 += 800 / rate; if (this.ph >= 1) this.ph -= 1; if (this.ph2 >= 1) this.ph2 -= 1;
          const sq = (this.ph < 0.5 ? 1 : -1) + (this.ph2 < 0.5 ? 1 : -1);
          y = this.bp1.process(sq) * (0.6 * Math.exp(-t / 0.015) + 0.4 * Math.exp(-t / 0.12)) * 2;
          break;
        }
        case "cym": case "ride": {
          const src = nine ? 0.6 * this.metal(rate, kind === "ride" ? 2.2 : 1.6) + 0.4 * this.nz.white() : this.metal(rate, 1);
          const dec = p[P.cDecay] * (kind === "ride" ? 1.2 : 1);
          y = (this.hp.process(this.bp1.process(src)) * 0.7 + this.bp2.process(src) * 0.5) * Math.exp(-t / (dec / 4.5)) * 2;
          break;
        }
      }
      out[i] += y * gain * 0.6;
    }
    if (this.t >= this.dur * rate) this.note = -1;
  }
}
const EIGHT = indexOf(drumParams(false));
const NINE = indexOf(drumParams(true));

const kitList = (notes: number[]) => notes.map((note) => ({ note, name: KIT[note].name }));
export const boomKit: MachineDef = {
  id: "boom-kit", name: "Boom Kit", inspiredBy: "Roland TR-808 (1980)", kind: "drum", voices: 16, level: 2.0,
  about: "Fully analog-style drum synthesis: a long, booming sine kick, tuned toms, a snare from two tones and noise, a three-burst clap, and hats, cymbal and cowbell from six square-wave 'metal' oscillators through band-pass filters. The closed hat chokes the open hat.",
  params: drumParams(false),
  createVoice: (rate, i) => new DrumVoice(rate, i + 141, false),
  drums: kitList([36, 38, 39, 42, 46, 41, 45, 50, 37, 56, 49]),
  presets: [
    { name: "Classic boom", values: {} },
    { name: "Long sub kick", values: { kTune: 42, kDecay: 2.2, kAttack: 0.1, kDrive: 0.25 } },
    { name: "Tight and snappy", values: { kDecay: 0.35, snappy: 0.9, sTone: 0.7, chDecay: 0.03, ohDecay: 0.25 } },
  ],
};
export const punchKit: MachineDef = {
  id: "punch-kit", name: "Punch Kit", inspiredBy: "Roland TR-909 (1984)", kind: "drum", voices: 16, level: 1.49,
  about: "A punchier kit: a kick with a fast pitch sweep, click and drive, a brighter snare, and toms with a pitch drop. The original's hats and cymbals were samples; here they are synthesised from metal oscillators and noise, so they are close in role, not identical.",
  params: drumParams(true),
  createVoice: (rate, i) => new DrumVoice(rate, i + 151, true),
  drums: kitList([36, 38, 39, 42, 46, 41, 45, 50, 37, 49, 51]),
  presets: [
    { name: "Club punch", values: {} },
    { name: "Hard techno", values: { kTune: 46, kDecay: 0.6, kAttack: 0.9, kDrive: 0.8, chDecay: 0.04 } },
    { name: "Soft house", values: { kDecay: 0.35, kAttack: 0.3, kDrive: 0.1, snappy: 0.4, clap: 0.35 } },
  ],
};
export const drumName = (m: MachineDef, note: number) => m.drums?.find((d) => d.note === note)?.name ?? KIT[note]?.name;

