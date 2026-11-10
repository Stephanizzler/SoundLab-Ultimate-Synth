// Helpers shared by the machine models.
import type { ParamDef } from "../engine/machine.ts";
import { clamp } from "../dsp/util.ts";

// Footage ranges ("8'" plays the key as written; each halving is an octave up).
export const FEET = { "64'": -36, "32'": -24, "16'": -12, "8'": 0, "4'": 12, "2'": 24 } as const;
export type Foot = keyof typeof FEET;
export const feet = (list: readonly string[]) => list.map((f) => (f === "LO" ? -60 : FEET[f as Foot]));
// Filter cutoff with modulation in octaves, kept inside the audio band.
export const cutoffHz = (base: number, octaves: number, rate: number) => clamp(base * 2 ** octaves, 16, rate * 0.45);
// Keyboard tracking in octaves from middle C.
export const keyOct = (pitch: number, amount: number) => (amount * (pitch - 60)) / 12;

export const sw = (id: string, name: string, def: number, group: string): ParamDef => ({ id, name, min: 0, max: 1, def, options: ["Off", "On"], group });
export const pct = (id: string, name: string, def: number, group: string): ParamDef => ({ id, name, min: 0, max: 1, def, unit: "%", group });
export const bip = (id: string, name: string, def: number, group: string): ParamDef => ({ id, name, min: -1, max: 1, def, group });
export const opt = (id: string, name: string, options: readonly string[], def: number, group: string): ParamDef => ({ id, name, min: 0, max: options.length - 1, def, options, group });
export const time = (id: string, name: string, def: number, group: string, min = 0.001, max = 10): ParamDef => ({ id, name, min, max, def, unit: "s", curve: "exp", group });
export const hzp = (id: string, name: string, def: number, group: string, min = 20, max = 20000): ParamDef => ({ id, name, min, max, def, unit: "Hz", curve: "exp", group });
export const semi = (id: string, name: string, def: number, group: string, min = -24, max = 24, step?: number): ParamDef => ({ id, name, min, max, def, unit: "st", step, group });
export const cents = (id: string, name: string, def: number, group: string, range = 50): ParamDef => ({ id, name, min: -range, max: range, def, unit: "ct", group });
export const adsr = (p: string, name: string, a: number, d: number, s: number, r: number): ParamDef[] => [
  time(`${p}A`, "Attack", a, name), time(`${p}D`, "Decay", d, name, 0.005), pct(`${p}S`, "Sustain", s, name), time(`${p}R`, "Release", r, name, 0.005),
];

// A low-frequency oscillator with every classic shape, phase in 0..1.
export const LFO_WAVES = ["Sine", "Triangle", "Saw up", "Saw down", "Square", "Random (S&H)", "Smooth random"] as const;
export class VLfo {
  ph: number; held = 0; prev = 0; seed: number;
  constructor(seed: number, phase = 0) { this.seed = seed >>> 0 || 1; this.ph = phase; }
  rnd() { let x = this.seed; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.seed = x >>> 0; return (this.seed / 4294967296) * 2 - 1; }
  reset() { this.ph = 0; }
  // Moves on by one sample at hz.
  advance(hz: number, rate: number) {
    this.ph += hz / rate;
    if (this.ph >= 1) { this.ph -= Math.floor(this.ph); this.prev = this.held; this.held = this.rnd(); }
  }
  // Advances and returns -1..1 for the named wave.
  next(hz: number, rate: number, wave: string) { this.advance(hz, rate); return this.value(wave); }
  value(wave: string) {
    const p = this.ph;
    switch (wave) {
      case "Sine": return Math.sin(2 * Math.PI * p);
      case "Triangle": return 1 - 4 * Math.abs(p - 0.5);
      case "Saw up": case "Saw": case "Ramp": return 2 * p - 1;
      case "Saw down": return 1 - 2 * p;
      case "Square": return p < 0.5 ? 1 : -1;
      case "Random (S&H)": case "Random": case "S&H": return this.held;
      default: return this.prev + (this.held - this.prev) * (0.5 - 0.5 * Math.cos(Math.PI * p));
    }
  }
}

// Fades an LFO in after a delay (Juno, Jupiter, DX7, PPG "delay" knobs).
export const delayFade = (heldSamples: number, delaySec: number, rate: number) => (delaySec <= 0.001 ? 1 : clamp((heldSamples / rate - delaySec * 0.5) / (delaySec * 0.5), 0, 1));
