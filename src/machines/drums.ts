// Drum machines, synthesised from the circuit ideas of the originals (no
// samples): bridged-T resonators for kicks, toms and congas; tone plus
// filtered noise for snares; six square-wave "metal" oscillators through
// band-pass filters for the 808's hats, cymbal and cowbell. Each kit has
// its original's front-panel controls, instrument by instrument.
import { Noise } from "../dsp/osc.ts";
import { Biquad, OnePole } from "../dsp/filters.ts";
import { TAU, tanh } from "../dsp/util.ts";
import { Voice, indexOf, type MachineDef, type ParamDef, type VoiceCtx } from "../engine/machine.ts";
import { pct, semi, time, hzp } from "./common.ts";

type Kind = "kick" | "rim" | "snare" | "clap" | "tomL" | "tomM" | "tomH" | "congaL" | "congaM" | "congaH" | "claves" | "maracas" | "ch" | "oh" | "cow" | "cym" | "crash" | "ride";
type Kit = Record<number, { kind: Kind; name: string }>;
const KIT808: Kit = {
  36: { kind: "kick", name: "Bass drum" }, 37: { kind: "rim", name: "Rim shot" }, 38: { kind: "snare", name: "Snare drum" }, 39: { kind: "clap", name: "Hand clap" },
  45: { kind: "tomL", name: "Low tom" }, 47: { kind: "tomM", name: "Mid tom" }, 50: { kind: "tomH", name: "High tom" },
  64: { kind: "congaL", name: "Low conga" }, 63: { kind: "congaM", name: "Mid conga" }, 62: { kind: "congaH", name: "High conga" },
  75: { kind: "claves", name: "Claves" }, 70: { kind: "maracas", name: "Maracas" }, 56: { kind: "cow", name: "Cowbell" },
  49: { kind: "cym", name: "Cymbal" }, 46: { kind: "oh", name: "Open hihat" }, 42: { kind: "ch", name: "Closed hihat" },
};
const KIT909: Kit = {
  36: { kind: "kick", name: "Bass drum" }, 37: { kind: "rim", name: "Rim shot" }, 38: { kind: "snare", name: "Snare drum" }, 39: { kind: "clap", name: "Hand clap" },
  45: { kind: "tomL", name: "Low tom" }, 47: { kind: "tomM", name: "Mid tom" }, 50: { kind: "tomH", name: "High tom" },
  42: { kind: "ch", name: "Closed hihat" }, 46: { kind: "oh", name: "Open hihat" }, 49: { kind: "crash", name: "Crash cymbal" }, 51: { kind: "ride", name: "Ride cymbal" },
};
// The 808's six metal oscillators (Hz), from its service notes.
const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800];

const lv = (id: string, g: string, def = 0.8) => pct(id, "Level", def, g);
const P808: ParamDef[] = [
  pct("accent", "Accent", 0.6, "Accent"),
  lv("bdLevel", "Bass drum"), pct("bdTone", "Tone", 0.4, "Bass drum"), time("bdDecay", "Decay", 0.9, "Bass drum", 0.08, 3), hzp("bdTune", "Tuning (internal trimmer)", 49, "Bass drum", 35, 80),
  lv("sdLevel", "Snare drum"), pct("sdTone", "Tone", 0.5, "Snare drum"), pct("sdSnappy", "Snappy", 0.6, "Snare drum"),
  lv("ltLevel", "Low tom / conga"), semi("ltTune", "Tuning", 0, "Low tom / conga", -12, 12),
  lv("mtLevel", "Mid tom / conga"), semi("mtTune", "Tuning", 0, "Mid tom / conga", -12, 12),
  lv("htLevel", "High tom / conga"), semi("htTune", "Tuning", 0, "High tom / conga", -12, 12),
  lv("rsLevel", "Rim shot / claves", 0.7), lv("cpLevel", "Hand clap / maracas", 0.8), lv("cbLevel", "Cowbell", 0.6),
  lv("cyLevel", "Cymbal", 0.6), pct("cyTone", "Tone", 0.5, "Cymbal"), time("cyDecay", "Decay", 1.4, "Cymbal", 0.2, 5),
  lv("ohLevel", "Open hihat", 0.7), time("ohDecay", "Decay", 0.45, "Open hihat", 0.08, 2), lv("chLevel", "Closed hihat", 0.7),
];
const P909: ParamDef[] = [
  pct("accent", "Total accent", 0.6, "Accent"),
  pct("bdTune", "Tune", 0.5, "Bass drum"), lv("bdLevel", "Bass drum"), pct("bdAttack", "Attack", 0.6, "Bass drum"), time("bdDecay", "Decay", 0.45, "Bass drum", 0.08, 2),
  semi("sdTune", "Tune", 0, "Snare drum", -12, 12), lv("sdLevel", "Snare drum"), pct("sdTone", "Tone", 0.5, "Snare drum"), pct("sdSnappy", "Snappy", 0.6, "Snare drum"),
  semi("ltTune", "Tune", 0, "Low tom", -12, 12), lv("ltLevel", "Low tom"), time("ltDecay", "Decay", 0.4, "Low tom", 0.08, 1.5),
  semi("mtTune", "Tune", 0, "Mid tom", -12, 12), lv("mtLevel", "Mid tom"), time("mtDecay", "Decay", 0.35, "Mid tom", 0.08, 1.5),
  semi("htTune", "Tune", 0, "High tom", -12, 12), lv("htLevel", "High tom"), time("htDecay", "Decay", 0.3, "High tom", 0.08, 1.5),
  lv("rsLevel", "Rim shot", 0.7), lv("cpLevel", "Hand clap", 0.8),
  lv("chLevel", "Closed hihat", 0.7), time("chDecay", "Decay", 0.05, "Closed hihat", 0.01, 0.3),
  lv("ohLevel", "Open hihat", 0.7), time("ohDecay", "Decay", 0.45, "Open hihat", 0.08, 2),
  lv("crLevel", "Crash cymbal", 0.6), semi("crTune", "Tune", 0, "Crash cymbal", -12, 12),
  lv("rdLevel", "Ride cymbal", 0.6), semi("rdTune", "Tune", 0, "Ride cymbal", -12, 12),
];
const I808 = indexOf(P808), I909 = indexOf(P909);
// Output trims so every instrument at the same level knob peaks about the same.
const TRIM: Partial<Record<Kind, number>> = { rim: 0.6, cow: 0.45, maracas: 0.55, ch: 1.6, oh: 1.6, cym: 1.1, crash: 1.25, ride: 1.2, claves: 0.95 };
// Some knobs exist on only one of the kits; the voice asks for them by name.
const has = (I: Record<string, number>, id: string) => Object.prototype.hasOwnProperty.call(I, id);

class DrumVoice extends Voice {
  kind: Kind = "kick"; t = 0; ph = 0; ph2 = 0; mph = new Float64Array(6); nz: Noise; dur = 0; choked = false;
  bp1 = new Biquad(); bp2 = new Biquad(); hp = new Biquad(); lp = new OnePole();
  readonly nine: boolean; readonly kit: Kit; readonly P: Record<string, number>;
  constructor(rate: number, seed: number, nine: boolean) {
    super(rate, seed); this.nine = nine; this.kit = nine ? KIT909 : KIT808; this.P = nine ? I909 : I808; this.nz = new Noise(seed * 101 + 7);
  }
  trigger() {
    this.kind = this.kit[this.note]?.kind ?? "rim"; this.t = 0; this.ph = 0; this.ph2 = 0.25; this.choked = false; this.dur = 0;
    for (const b of [this.bp1, this.bp2, this.hp]) { b.z1 = 0; b.z2 = 0; }
  }
  release() {}
  choke(note: number) { if (note === 42 && this.kind === "oh") this.choked = true; }
  get active() { return this.note >= 0 && (this.dur === 0 || this.t < this.dur * this.rate); }
  metal(rate: number, scale: number) {
    let s = 0;
    for (let k = 0; k < 6; k++) { this.mph[k] += (METAL[k] * scale) / rate; if (this.mph[k] >= 1) this.mph[k] -= 1; s += this.mph[k] < 0.5 ? 1 : -1; }
    return s / 6;
  }
  render(out: Float32Array, n: number, p: Float64Array, _ctx: VoiceCtx) {
    const rate = this.rate, nine = this.nine, kind = this.kind, I = this.P;
    const q = (id: string, def = 0.5) => (has(I, id) ? p[I[id]] : def);
    const acc = q("accent"), gain = (1 - acc * 0.6 + acc * 0.6 * this.vel) * (this.accent ? 1 + acc : 1);
    const levels: Record<Kind, number> = {
      kick: q("bdLevel"), rim: q("rsLevel"), claves: q("rsLevel"), snare: q("sdLevel"), clap: q("cpLevel"), maracas: q("cpLevel"),
      tomL: q("ltLevel"), congaL: q("ltLevel"), tomM: q("mtLevel"), congaM: q("mtLevel"), tomH: q("htLevel"), congaH: q("htLevel"),
      ch: q("chLevel"), oh: q("ohLevel"), cow: q("cbLevel"), cym: q("cyLevel"), crash: q("crLevel"), ride: q("rdLevel"),
    };
    const level = levels[kind] * 1.25 * (TRIM[kind] ?? 1) * (nine && (kind === "kick" || kind.startsWith("tom")) ? 1.3 : 1);
    const tune = (id: string) => 2 ** (q(id, 0) / 12);
    if (this.t === 0) {
      if (kind === "ch" || kind === "oh") { this.bp1.bandpass(nine ? 9000 : 8200, 1.2, rate); this.hp.highpass(nine ? 7000 : 7200, 0.7, rate); }
      else if (kind === "cym") { this.bp1.bandpass(3440, 1.0, rate); this.bp2.bandpass(7100, 1.2, rate); this.hp.highpass(2400 + q("cyTone") * 3000, 0.7, rate); }
      else if (kind === "crash" || kind === "ride") { const t2 = tune(kind === "crash" ? "crTune" : "rdTune"); this.bp1.bandpass((kind === "ride" ? 5200 : 3800) * t2, 1.0, rate); this.bp2.bandpass(8000 * t2, 1.2, rate); this.hp.highpass((kind === "ride" ? 3000 : 2200) * t2, 0.7, rate); }
      else if (kind === "cow") this.bp1.bandpass(2640, 3, rate);
      else if (kind === "clap") this.bp1.bandpass(1050, 1.8, rate);
      else if (kind === "maracas") this.hp.highpass(6000, 0.8, rate);
      else if (kind === "snare") { this.hp.highpass(nine ? 1800 : 2200, 0.7, rate); this.lp.set(nine ? 9000 : 7500, rate); }
      else if (kind === "rim") { this.bp1.bandpass(1700, 4, rate); this.bp2.bandpass(500, 3, rate); }
      else if (kind === "kick") this.lp.set(nine ? 6000 : 600 + q("bdTone") * 6000, rate);
      const durs: Record<Kind, number> = {
        kick: q("bdDecay") * 1.2, rim: 0.05, claves: 0.08, maracas: 0.08, snare: 0.4, clap: 0.35,
        tomL: q("ltDecay", 0.45) * 1.4, tomM: q("mtDecay", 0.38) * 1.3, tomH: q("htDecay", 0.32) * 1.3,
        congaL: 0.35, congaM: 0.3, congaH: 0.25, ch: q("chDecay", 0.05) * 2, oh: q("ohDecay") * 1.6, cow: 0.5,
        cym: q("cyDecay") * 1.5, crash: 2.2, ride: 2.6,
      };
      this.dur = durs[kind] * 1.1 + 0.02;
    }
    const end = this.dur * rate;
    for (let i = 0; i < n; i++) {
      const t = this.t / rate; this.t++;
      if (this.t >= end) break;
      let y = 0;
      switch (kind) {
        case "kick": {
          let body: number, click: number;
          if (nine) {
            // 909: a fast, deep pitch sweep (Tune sets its depth), a triangle edge and a noise click (Attack).
            this.ph += (50 * (1 + (1.5 + q("bdTune") * 4) * Math.exp(-t / 0.018))) / rate; if (this.ph >= 1) this.ph -= 1;
            body = 0.85 * Math.sin(TAU * this.ph) + 0.15 * (1 - 4 * Math.abs(this.ph - 0.5));
            click = (this.lp.lp(this.nz.white()) * Math.exp(-t / 0.003) + (t < 0.0012 ? 1 : 0)) * q("bdAttack") * 0.7;
          } else {
            // 808: a ringing bridged-T with a slight pitch drop; Tone lets more of the trigger click through.
            this.ph += (q("bdTune", 49) * (1 + 0.5 * Math.exp(-t / 0.006))) / rate; if (this.ph >= 1) this.ph -= 1;
            body = Math.sin(TAU * this.ph);
            click = this.lp.lp(t < 0.0015 ? 1 : 0) * q("bdTone") * 3;
          }
          y = tanh((body * Math.exp(-t / (q("bdDecay") / 4.5)) + click) * (nine ? 2.2 : 1.2)) * 0.9;
          break;
        }
        case "tomL": case "tomM": case "tomH": case "congaL": case "congaM": case "congaH": {
          const conga = kind.startsWith("conga"), last = kind[kind.length - 1];
          const tid = last === "L" ? "ltTune" : last === "M" ? "mtTune" : "htTune";
          const base = (conga ? (last === "L" ? 165 : last === "M" ? 250 : 370) : (last === "L" ? 90 : last === "M" ? 125 : 175)) * tune(tid) * (nine ? 1.1 : 1);
          this.ph += (base * (1 + (nine ? 0.6 : conga ? 0.05 : 0.25) * Math.exp(-t / 0.03))) / rate; if (this.ph >= 1) this.ph -= 1;
          y = Math.sin(TAU * this.ph) * Math.exp(-t / (this.dur / 1.5 / 4.5)) * 0.8 + this.nz.white() * Math.exp(-t / 0.02) * (nine ? 0.15 : 0.04);
          break;
        }
        case "snare": {
          const tt = nine ? tune("sdTune") : 1, f1 = (nine ? 180 : 238) * tt, f2 = (nine ? 330 : 476) * tt, sw = nine ? 1 + 0.3 * Math.exp(-t / 0.02) : 1;
          this.ph += (f1 * sw) / rate; this.ph2 += (f2 * sw) / rate; if (this.ph >= 1) this.ph -= 1; if (this.ph2 >= 1) this.ph2 -= 1;
          const tone = q("sdTone");
          // On the 808 Tone balances the two drum-head tones; on the 909 it brightens the snares.
          const head = nine ? Math.sin(TAU * this.ph) + 0.6 * Math.sin(TAU * this.ph2) : Math.sin(TAU * this.ph) * (1 - tone) + Math.sin(TAU * this.ph2) * tone * 1.2;
          const noise = this.lp.lp(this.hp.process(this.nz.white())) * Math.exp(-t / (0.04 + q("sdSnappy") * 0.12));
          y = head * Math.exp(-t / (nine ? 0.04 : 0.05)) * 0.6 + noise * q("sdSnappy") * 1.6 * (nine ? 0.5 + tone : 0.8);
          break;
        }
        case "clap": {
          const burst = t < 0.03 ? Math.exp(-((t % 0.0105) / 0.0035)) : 0;
          const tail = t >= 0.02 ? Math.exp(-(t - 0.02) / (nine ? 0.07 : 0.06)) : 0;
          y = this.bp1.process(this.nz.white()) * (burst * 1.4 + tail) * 2.4;
          break;
        }
        case "maracas": y = this.hp.process(this.nz.white()) * Math.min(1, t / 0.004) * Math.exp(-t / 0.02) * 1.5; break;
        case "claves": this.ph += 2500 / rate; if (this.ph >= 1) this.ph -= 1; y = Math.sin(TAU * this.ph) * Math.exp(-t / 0.02) * 0.9; break;
        case "rim": {
          this.ph += 1700 / rate; if (this.ph >= 1) this.ph -= 1;
          const exc = (t < 0.0008 ? 1 : 0) + Math.sin(TAU * this.ph) * 0.3 * Math.exp(-t / 0.006);
          y = (this.bp1.process(exc) + this.bp2.process(exc) * 0.6) * Math.exp(-t / 0.012) * 3;
          break;
        }
        case "ch": case "oh": {
          // The 909's hats were samples; here they are synthesised from metal oscillators and noise.
          const src = nine ? 0.55 * this.metal(rate, 1.8) + 0.45 * this.nz.white() : this.metal(rate, 1);
          const dec = kind === "ch" ? q("chDecay", 0.05) : q("ohDecay");
          const env = Math.exp(-t / (dec / 4.5)) * (this.choked ? Math.exp(-this.t / (rate * 0.004)) : 1);
          y = this.hp.process(this.bp1.process(src)) * env * 2.4;
          if (this.choked && env < 1e-4) this.t = end;
          break;
        }
        case "cow": {
          this.ph += 540 / rate; this.ph2 += 800 / rate; if (this.ph >= 1) this.ph -= 1; if (this.ph2 >= 1) this.ph2 -= 1;
          y = this.bp1.process((this.ph < 0.5 ? 1 : -1) + (this.ph2 < 0.5 ? 1 : -1)) * (0.6 * Math.exp(-t / 0.015) + 0.4 * Math.exp(-t / 0.12)) * 2;
          break;
        }
        case "cym": case "crash": case "ride": {
          const src = nine ? 0.6 * this.metal(rate, kind === "ride" ? 2.2 : 1.6) + 0.4 * this.nz.white() : this.metal(rate, 1);
          const dec = kind === "cym" ? q("cyDecay") : kind === "crash" ? 1.6 : 2;
          y = (this.hp.process(this.bp1.process(src)) * 0.7 + this.bp2.process(src) * 0.5) * Math.exp(-t / (dec / 4.5)) * 2;
          break;
        }
      }
      out[i] += y * gain * level * 0.6;
    }
    if (this.t >= end) this.note = -1;
  }
}

const kitList = (k: Kit) => Object.entries(k).map(([note, d]) => ({ note: Number(note), name: d.name }));
export const tr808: MachineDef = {
  id: "boom-kit", name: "T-Rex 808", inspiredBy: "Roland TR-808 Rhythm Composer (1980)", kind: "drum", voices: 16, level: 2.0,
  about: "All sixteen instruments and the front panel: bass drum (level, tone, decay, and its internal tuning trimmer), snare (tone, snappy), low, mid and high toms and congas (sharing level and tuning, as the 808's switches did), rim shot and claves, hand clap and maracas, cowbell, cymbal (tone, decay), open hihat (decay) and closed hihat, plus accent. Six square-wave metal oscillators make the hats, cymbal and cowbell; the closed hat chokes the open one.",
  params: P808,
  createVoice: (rate, i) => new DrumVoice(rate, i + 141, false),
  drums: kitList(KIT808),
  presets: [
    { name: "Classic 808", role: "kit", values: {} },
    { name: "Long sub kick", role: "kit", values: { bdTune: 42, bdDecay: 2.4, bdTone: 0.15 } },
    { name: "Tight and snappy", role: "kit", values: { bdDecay: 0.35, sdSnappy: 0.9, sdTone: 0.7, ohDecay: 0.25 } },
    { name: "Latin percussion", role: "kit", values: { ltLevel: 0.9, mtLevel: 0.9, htLevel: 0.9, cbLevel: 0.8, rsLevel: 0.9, cpLevel: 0.9, ltTune: 2, mtTune: 2, htTune: 2 } },
    { name: "Hip-hop boom", role: "kit", values: { bdTune: 45, bdDecay: 1.8, bdTone: 0.3, sdTone: 0.3, sdSnappy: 0.4, cpLevel: 1 } },
    { name: "Electro", role: "kit", values: { bdDecay: 0.6, bdTone: 0.6, sdSnappy: 1, sdTone: 0.8, chLevel: 0.8, ohDecay: 0.2, cbLevel: 0.7 } },
  ],
};
export const tr909: MachineDef = {
  id: "punch-kit", name: "T-Rex 909", inspiredBy: "Roland TR-909 Rhythm Composer (1984)", kind: "drum", voices: 16, level: 1.49,
  about: "Every 909 instrument and knob: bass drum (tune, level, attack, decay), snare (tune, level, tone, snappy), three toms (tune, level, decay), rim shot, hand clap, closed and open hihat (level, decay), crash and ride (level, tune) and total accent. The analog voices follow the 909's circuits; its hats and cymbals were samples, so here they are synthesised from metal oscillators and noise: close in role, not identical.",
  params: P909,
  createVoice: (rate, i) => new DrumVoice(rate, i + 151, true),
  drums: kitList(KIT909),
  presets: [
    { name: "Club punch", role: "kit", values: {} },
    { name: "Hard techno", role: "kit", values: { bdTune: 0.3, bdDecay: 0.6, bdAttack: 0.9, chDecay: 0.04, accent: 0.8 } },
    { name: "Soft house", role: "kit", values: { bdDecay: 0.35, bdAttack: 0.3, sdSnappy: 0.4, cpLevel: 0.9 } },
    { name: "Booming toms", role: "kit", values: { ltDecay: 1.1, mtDecay: 0.9, htDecay: 0.8, ltTune: -3, mtTune: -3, htTune: -3 } },
    { name: "Garage swing", role: "kit", values: { bdDecay: 0.3, sdTune: 2, sdSnappy: 0.8, chDecay: 0.07, ohDecay: 0.3, rdLevel: 0.7 } },
    { name: "Industrial", role: "kit", values: { bdTune: 0.15, bdDecay: 0.9, bdAttack: 1, sdTune: -3, sdSnappy: 1, sdTone: 0.9, accent: 1 } },
  ],
};
export const drumName = (m: MachineDef, note: number) => m.drums?.find((d) => d.note === note)?.name ?? (KIT808[note] ?? KIT909[note])?.name;
