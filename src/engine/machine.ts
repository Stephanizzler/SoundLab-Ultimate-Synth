// What a machine (one synth or drum-machine model) is, and the parameter
// system every knob, preset and patch cable goes through.
import { clamp, mtof } from "../dsp/util.ts";
import { Drift } from "../dsp/osc.ts";

export type Unit = "" | "Hz" | "s" | "ms" | "dB" | "%" | "st" | "ct" | "x";
export type ParamDef = {
  id: string;
  name: string;
  min: number;
  max: number;
  def: number;
  unit?: Unit;
  curve?: "lin" | "exp"; // exp: equal ratios per turn (frequencies, times)
  step?: number; // 1 for whole numbers
  options?: readonly string[]; // a switch; min 0, max options.length - 1
  group?: string; // the panel section it sits in
};

// Patch cables move parameters in a normalised 0..1 space, so one amount
// means the same "turn of the knob" on every destination.
export function toNorm(d: ParamDef, v: number) {
  if (d.curve === "exp") return clamp(Math.log(v / d.min) / Math.log(d.max / d.min), 0, 1);
  return clamp((v - d.min) / (d.max - d.min), 0, 1);
}
export function fromNorm(d: ParamDef, n: number) {
  n = clamp(n, 0, 1);
  let v = d.curve === "exp" ? d.min * (d.max / d.min) ** n : d.min + (d.max - d.min) * n;
  if (d.options || d.step) { const s = d.step ?? 1; v = Math.round(v / s) * s; }
  return clamp(v, d.min, d.max);
}
// A stored value made safe: a number within range, whole where the knob is stepped.
export function sanitize(d: ParamDef, v: unknown) {
  if (typeof v !== "number" || !Number.isFinite(v)) return d.def;
  let x = clamp(v, d.min, d.max);
  if (d.options || d.step) { const s = d.step ?? 1; x = clamp(Math.round(x / s) * s, d.min, d.max); }
  return x;
}
export function formatParam(d: ParamDef, v: number) {
  if (d.options) return d.options[Math.round(v)] ?? "";
  const u = d.unit ?? "";
  if (u === "Hz") return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)} kHz` : `${v.toFixed(v < 10 ? 2 : 0)} Hz`;
  if (u === "s") return v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`;
  if (u === "ms") return `${v.toFixed(v < 10 ? 1 : 0)} ms`;
  if (u === "%") return `${Math.round(v * 100)}%`;
  if (u === "dB") return `${v > 0 ? "+" : ""}${v.toFixed(1)} dB`;
  if (u === "st") return `${v > 0 ? "+" : ""}${d.step ? v : v.toFixed(1)} st`;
  if (u === "ct") return `${v > 0 ? "+" : ""}${Math.round(v)} ct`;
  if (u === "x") return `×${v.toFixed(v < 10 ? 2 : 1)}`;
  return d.step ? String(Math.round(v)) : v.toFixed(2);
}

// Maps parameter ids to their positions. Under test (globalThis.STRICT_PARAMS)
// asking for an id that doesn't exist throws, so a typo in a machine fails
// its test instead of quietly reading undefined. In the app it is a plain
// object, because the audio loops read it every sample.
export function indexOf(defs: readonly ParamDef[]): Record<string, number> {
  const out: Record<string, number> = {};
  defs.forEach((d, i) => { if (d.id in out) throw new Error(`Duplicate parameter ${d.id}`); out[d.id] = i; });
  if (!(globalThis as { STRICT_PARAMS?: boolean }).STRICT_PARAMS) return out;
  return new Proxy(out, { get: (t, k) => { if (typeof k === "string" && !(k in t)) throw new Error(`Unknown parameter ${k}`); return t[k as string]; } });
}

export type VoiceCtx = { rate: number; bend: number; wheel: number; bpm: number };

// One voice. The base class keeps pitch, glide and analog drift so each
// machine only has to describe its own sound.
export abstract class Voice {
  note = -1; vel = 0; accent = false; gateOn = false; started = 0;
  pitch = 60; target = 60;
  drift: Drift;
  readonly rate: number;
  constructor(rate: number, seed: number) { this.rate = rate; this.drift = new Drift(seed * 7919 + 13); }
  // legato: a mono machine moving to a new note while the last one is held.
  start(note: number, vel: number, accent: boolean, legato: boolean, glide: boolean) {
    if (!glide || this.note < 0) this.pitch = note;
    this.target = note; this.note = note; this.vel = vel; this.accent = accent; this.gateOn = true;
    this.trigger(legato);
  }
  stop() { this.gateOn = false; this.release(); }
  // Moves the pitch towards the target; glide time in seconds (constant time, like a Minimoog).
  glideStep(seconds: number) {
    if (this.pitch !== this.target) {
      const c = seconds <= 0.001 ? 1 : 1 - Math.exp(-4 / (seconds * this.rate));
      this.pitch += (this.target - this.pitch) * c;
      if (Math.abs(this.target - this.pitch) < 1e-3) this.pitch = this.target;
    }
  }
  // Frequency of the current pitch plus an offset in semitones (bend included).
  hz(ctx: VoiceCtx, semis = 0) { return mtof(this.pitch + ctx.bend + semis); }
  // Call once per sample: this voice's slow analog wander, in semitones.
  wander(cents: number) { return cents ? (this.drift.next(this.rate) * cents) / 100 : 0; }
  abstract trigger(legato: boolean): void;
  abstract release(): void;
  abstract render(out: Float32Array, n: number, p: Float64Array, ctx: VoiceCtx): void;
  abstract get active(): boolean;
  // Drum machines: notes in the same choke group cut each other (closed hat stops open hat).
  choke(_note: number) {}
}

export type Preset = { name: string; values: Record<string, number> };

// Stereo processing after a machine's voices, such as the Juno's chorus.
export interface SlotFx { process(L: Float32Array, R: Float32Array, n: number, p: Float64Array): void }

export type MachineDef = {
  id: string;
  name: string; // SoundLab's own name for the model
  inspiredBy: string; // the hardware it is modelled on, for reference only
  about: string;
  kind: "poly" | "mono" | "drum";
  voices: number;
  params: readonly ParamDef[];
  createVoice(rate: number, index: number): Voice;
  createFx?(rate: number): SlotFx;
  glideParam?: string; // mono machines: the param holding glide time
  presets: Preset[];
  drums?: { note: number; name: string }[];
  level: number; // output trim so machines sit at similar loudness
};

// Mixer controls every slot has, after the machine's own.
export const MIXER_PARAMS: ParamDef[] = [
  { id: "level", name: "Level", min: -48, max: 6, def: -6, unit: "dB", group: "Mixer" },
  { id: "pan", name: "Pan", min: -1, max: 1, def: 0, group: "Mixer" },
  { id: "delay", name: "Delay send", min: 0, max: 1, def: 0, unit: "%", group: "Mixer" },
  { id: "reverb", name: "Reverb send", min: 0, max: 1, def: 0.1, unit: "%", group: "Mixer" },
];

// Shared envelope parameter sets.
export const adsrParams = (prefix: string, name: string, a = 0.005, d = 0.4, s = 0.6, r = 0.3, group = name): ParamDef[] => [
  { id: `${prefix}A`, name: `${name} attack`, min: 0.001, max: 10, def: a, unit: "s", curve: "exp", group },
  { id: `${prefix}D`, name: `${name} decay`, min: 0.005, max: 10, def: d, unit: "s", curve: "exp", group },
  { id: `${prefix}S`, name: `${name} sustain`, min: 0, max: 1, def: s, unit: "%", group },
  { id: `${prefix}R`, name: `${name} release`, min: 0.005, max: 10, def: r, unit: "s", curve: "exp", group },
];
export const cutoffParam = (def = 2000, group = "Filter"): ParamDef => ({ id: "cutoff", name: "Cutoff", min: 20, max: 20000, def, unit: "Hz", curve: "exp", group });
