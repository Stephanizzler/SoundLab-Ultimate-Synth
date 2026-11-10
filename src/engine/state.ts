// The whole instrument as plain data: the rack, the patterns and the patch
// cables. This is what is saved in a project's source.settings, in .json
// patch files and in the browser, so it is validated with sanitizeState
// every time it is read.
import { MACHINES, machineById } from "../machines/index.ts";
import { MIXER_PARAMS, sanitize, type ParamDef } from "./machine.ts";
import { LFO_SHAPES } from "../dsp/env.ts";

export const STATE_SCHEMA = 1;
export const SLOTS = 8, TRACKS = 8, PATTERNS = 8, MAX_STEPS = 64;

export const DIVISIONS = [
  { name: "1/4", perBeat: 1 }, { name: "1/8", perBeat: 2 }, { name: "1/8T", perBeat: 3 },
  { name: "1/16", perBeat: 4 }, { name: "1/16T", perBeat: 6 }, { name: "1/32", perBeat: 8 },
] as const;
export const CHORDS = [
  { name: "Single note", iv: [0] }, { name: "Major", iv: [0, 4, 7] }, { name: "Minor", iv: [0, 3, 7] },
  { name: "Major 7", iv: [0, 4, 7, 11] }, { name: "Minor 7", iv: [0, 3, 7, 10] }, { name: "Dominant 7", iv: [0, 4, 7, 10] },
  { name: "Sus 4", iv: [0, 5, 7] }, { name: "Power (5th)", iv: [0, 7] }, { name: "Octave", iv: [0, 12] },
] as const;

export type Step = {
  on: boolean;
  note: number; // MIDI note
  vel: number; // 0..1
  len: number; // gate length in steps
  prob: number; // 0..1 chance the step plays
  ratchet: number; // 1..4 repeats inside the step
  slide: boolean; // glide into the next note without retriggering
  accent: boolean;
  chord: number; // index into CHORDS
  a: number | null; // CV lane A value 0..1, or null to hold the last value
  b: number | null; // CV lane B
};
export type Track = { name: string; targets: number[]; note: number; length: number; division: number; mute: boolean; steps: Step[] }; // note: for new steps
export type Pattern = { tracks: Track[] };
export type SlotState = { machine: string; preset: string; params: Record<string, number>; mute: boolean; solo: boolean };
export type Cable = { src: string; dst: string; amt: number };
export type SynthState = {
  schema: typeof STATE_SCHEMA;
  name: string;
  bpm: number;
  swing: number; // 0 straight .. 0.5 (hard swing on odd 16ths)
  pattern: number;
  patterns: Pattern[];
  slots: SlotState[];
  fx: Record<string, number>;
  mod: Record<string, number>;
  cables: Cable[];
};

/* ---------------- The two non-instrument units: FX and Mod ---------------- */
export const DELAY_TIMES = [
  { name: "1/16", beats: 0.25 }, { name: "1/8", beats: 0.5 }, { name: "1/8 dotted", beats: 0.75 }, { name: "1/4", beats: 1 },
  { name: "1/4 dotted", beats: 1.5 }, { name: "1/2", beats: 2 },
] as const;
export const FX_PARAMS: ParamDef[] = [
  { id: "dTime", name: "Delay time", min: 0, max: DELAY_TIMES.length - 1, def: 2, options: DELAY_TIMES.map((d) => d.name), group: "Delay" },
  { id: "dFb", name: "Feedback", min: 0, max: 0.95, def: 0.4, unit: "%", group: "Delay" },
  { id: "dTone", name: "Tone", min: 0, max: 1, def: 0.5, unit: "%", group: "Delay" },
  { id: "dPing", name: "Ping-pong", min: 0, max: 1, def: 1, options: ["Off", "On"], group: "Delay" },
  { id: "dLevel", name: "Delay return", min: 0, max: 1, def: 0.6, unit: "%", group: "Delay" },
  { id: "rSize", name: "Size", min: 0, max: 1, def: 0.5, unit: "%", group: "Reverb" },
  { id: "rDamp", name: "Damping", min: 0, max: 1, def: 0.5, unit: "%", group: "Reverb" },
  { id: "rLevel", name: "Reverb return", min: 0, max: 1, def: 0.5, unit: "%", group: "Reverb" },
  { id: "drive", name: "Bus drive", min: 0, max: 1, def: 0.1, unit: "%", group: "Master" },
  { id: "master", name: "Master", min: -24, max: 6, def: 0, unit: "dB", group: "Master" },
  { id: "limit", name: "Limiter", min: 0, max: 1, def: 1, options: ["Off", "On"], group: "Master" },
];
export const LFO_RATES = [
  { name: "Free", beats: 0 }, { name: "4 bars", beats: 16 }, { name: "2 bars", beats: 8 }, { name: "1 bar", beats: 4 },
  { name: "1/2", beats: 2 }, { name: "1/4", beats: 1 }, { name: "1/8", beats: 0.5 }, { name: "1/16", beats: 0.25 },
] as const;
export const MOD_PARAMS: ParamDef[] = [
  ...[0, 1, 2, 3].flatMap((k): ParamDef[] => [
    { id: `lfo${k}Shape`, name: `LFO ${k + 1} shape`, min: 0, max: LFO_SHAPES.length - 1, def: [1, 0, 5, 6][k], options: LFO_SHAPES, group: `LFO ${k + 1}` },
    { id: `lfo${k}Sync`, name: `LFO ${k + 1} sync`, min: 0, max: LFO_RATES.length - 1, def: [2, 3, 7, 0][k], options: LFO_RATES.map((r) => r.name), group: `LFO ${k + 1}` },
    { id: `lfo${k}Hz`, name: `LFO ${k + 1} free rate`, min: 0.02, max: 20, def: 0.5, unit: "Hz", curve: "exp", group: `LFO ${k + 1}` },
  ]),
  ...[0, 1, 2, 3].map((k): ParamDef => ({ id: `mac${k}`, name: `Macro ${k + 1}`, min: 0, max: 1, def: 0, unit: "%", group: "Macros" })),
];

const defsCache = new Map<string, ParamDef[]>();
export function slotParamDefs(machine: string): ParamDef[] {
  const hit = defsCache.get(machine);
  if (hit) return hit;
  const m = machineById(machine);
  if (!m) return [];
  const defs = [...m.params, ...MIXER_PARAMS];
  const ids = new Set<string>();
  for (const d of defs) { if (ids.has(d.id)) throw new Error(`${m.name}: parameter id "${d.id}" is used twice`); ids.add(d.id); }
  defsCache.set(machine, defs);
  return defs;
}

/* ---------------- Patch sources and destinations ---------------- */
export const TRACK_OUTPUTS = [
  { id: "gate", name: "Gate" }, { id: "env", name: "Envelope" }, { id: "pitch", name: "Pitch" }, { id: "vel", name: "Velocity" },
  { id: "a", name: "CV A" }, { id: "b", name: "CV B" }, { id: "ramp", name: "Ramp" },
] as const;
export type Source = { id: string; name: string; group: string; bipolar: boolean };
export function sources(state: SynthState): Source[] {
  const out: Source[] = [];
  const tracks = state.patterns[state.pattern]?.tracks ?? [];
  for (let t = 0; t < TRACKS; t++)
    for (const o of TRACK_OUTPUTS) out.push({ id: `t${t}.${o.id}`, name: `${tracks[t]?.name || `Track ${t + 1}`} · ${o.name}`, group: "Sequencer", bipolar: o.id === "pitch" });
  for (let k = 0; k < 4; k++) out.push({ id: `lfo${k}`, name: `LFO ${k + 1}`, group: "Modulators", bipolar: true });
  for (let k = 0; k < 4; k++) out.push({ id: `mac${k}`, name: `Macro ${k + 1}`, group: "Modulators", bipolar: false });
  out.push({ id: "in.wheel", name: "Mod wheel", group: "Controller", bipolar: false });
  out.push({ id: "in.vel", name: "Keyboard velocity", group: "Controller", bipolar: false });
  out.push({ id: "in.press", name: "Aftertouch", group: "Controller", bipolar: false });
  return out;
}
export type Destination = { id: string; name: string; group: string; def: ParamDef };
export function destinations(state: SynthState): Destination[] {
  const out: Destination[] = [];
  state.slots.forEach((s, i) => {
    const m = machineById(s.machine);
    if (!m) return;
    for (const d of slotParamDefs(s.machine)) out.push({ id: `s${i}.${d.id}`, name: d.name, group: `${i + 1} · ${m.name}`, def: d });
  });
  for (const d of FX_PARAMS) out.push({ id: `fx.${d.id}`, name: d.name, group: "Effects & master", def: d });
  for (const d of MOD_PARAMS) out.push({ id: `mod.${d.id}`, name: d.name, group: "Modulators", def: d });
  return out;
}

/* ---------------- Defaults ---------------- */
export const emptyStep = (note = 60): Step => ({ on: false, note, vel: 0.8, len: 1, prob: 1, ratchet: 1, slide: false, accent: false, chord: 0, a: null, b: null });
export const emptyTrack = (i: number, targets: number[] = [], note = 60): Track => ({
  name: `Track ${i + 1}`, targets, note, length: 16, division: 3, mute: false, steps: Array.from({ length: MAX_STEPS }, () => emptyStep(note)),
});
export const defaultsFor = (defs: ParamDef[]) => Object.fromEntries(defs.map((d) => [d.id, d.def]));
export function slotState(machine: string, preset = 0): SlotState {
  const m = machineById(machine);
  if (!m) return { machine: "", preset: "", params: {}, mute: false, solo: false };
  const p = m.presets[preset] ?? m.presets[0];
  return { machine, preset: p?.name ?? "", params: { ...defaultsFor(slotParamDefs(machine)), ...(p?.values ?? {}) }, mute: false, solo: false };
}

// Performances: multitimbral rack setups, like the Jupiter-8's Split and
// Dual modes, the Nord Lead's four slots or the Virus's Multi mode. Each
// sets up slots (machine, preset, MIDI channel, key range, transpose) and
// leaves the patterns alone.
type Part = { machine: string; preset: string; channel?: number; keyLo?: number; keyHi?: number; transpose?: number; level?: number; pan?: number };
export const PERFORMANCES: { name: string; about: string; parts: Part[] }[] = [
  { name: "Split: MiniMood bass / Juniper brass", about: "Keys below middle C play a MiniMood bass an octave down; above it, unison Juniper brass.", parts: [
    { machine: "ladder-mono", preset: "Classic bass", keyHi: 59, level: -6 }, { machine: "flagship-poly", preset: "Unison brass", keyLo: 60, level: -8 }] },
  { name: "Dual: Juneau strings + Saline Ensemble", about: "Both slots on the whole keyboard: Juneau PWM strings layered with the Saline Ensemble.", parts: [
    { machine: "chorus-poly", preset: "PWM strings", level: -9, pan: -0.3 }, { machine: "string-machine", preset: "Full ensemble", level: -10, pan: 0.3 }] },
  { name: "Layer: SeaSaw pad + DeLuxe strings", about: "The SeaSaw-80's blade pad layered with DeLuxe-7 FM strings for a wide, moving pad.", parts: [
    { machine: "expressive-poly", preset: "Blade pad", level: -8 }, { machine: "fm-six", preset: "Strings", level: -12 }] },
  { name: "Split: Profit bass / DeLuxe piano", about: "Profit-5 brass-bass on the left hand, DeLuxe-7 electric piano on the right.", parts: [
    { machine: "studio-poly", preset: "Brass", keyHi: 54, transpose: -12, level: -8 }, { machine: "fm-six", preset: "Electric piano", keyLo: 55, level: -6 }] },
  { name: "Excess Viral multi: 4 parts on 4 channels", about: "Lead, bass, pad and drums on MIDI channels 1-4, ready for a DAW or the sequencer.", parts: [
    { machine: "super-va", preset: "Trance HyperSaw", channel: 1, level: -10 }, { machine: "super-va", preset: "Hard bass", channel: 2, level: -8 },
    { machine: "super-va", preset: "Vocal pad", channel: 3, level: -12 }, { machine: "punch-kit", preset: "Club punch", channel: 4, level: -4 }] },
  { name: "Nerd Lead slots A-D", about: "Four Nerd Lead 2 programs on channels 1-4, as in its multitimbral mode.", parts: [
    { machine: "lead-va", preset: "Sync sweep lead", channel: 1, level: -10 }, { machine: "lead-va", preset: "FM bass", channel: 2, level: -8 },
    { machine: "lead-va", preset: "PWM pad", channel: 3, level: -12 }, { machine: "lead-va", preset: "Arpeggio", channel: 4, level: -10 }] },
  { name: "Three-way split: TeaBag / Juneau / PBJ", about: "TeaBag-303 acid under C2, Juneau chords from C2 to B3, PBJ Wave bells from C4 up.", parts: [
    { machine: "acid-bass", preset: "Squelch", keyHi: 47, level: -6 }, { machine: "chorus-poly", preset: "Classic chorus poly", keyLo: 48, keyHi: 59, level: -9 },
    { machine: "wave-scanner", preset: "Bell partials", keyLo: 60, level: -10 }] },
];
export function performanceSlots(name: string): SlotState[] | null {
  const perf = PERFORMANCES.find((p) => p.name === name);
  if (!perf) return null;
  return Array.from({ length: SLOTS }, (_, i) => {
    const part = perf.parts[i];
    if (!part) return slotState("");
    const m = machineById(part.machine)!;
    const s = slotState(part.machine, Math.max(0, m.presets.findIndex((p) => p.name === part.preset)));
    Object.assign(s.params, Object.fromEntries(Object.entries({ channel: part.channel, keyLo: part.keyLo, keyHi: part.keyHi, transpose: part.transpose, level: part.level, pan: part.pan }).filter(([, v]) => v !== undefined)));
    return s;
  });
}

// The demo session the app opens with: a groove that shows off patching.
export function demoState(): SynthState {
  const slots: SlotState[] = [
    slotState("punch-kit"), slotState("acid-bass"), slotState("chorus-poly"), slotState("lead-va"),
    slotState("string-machine"), slotState(""), slotState(""), slotState(""),
  ];
  slots[0].params.level = -5; slots[1].params.level = -7; slots[1].params.delay = 0.2;
  slots[2].params.level = -12; slots[2].params.reverb = 0.25; slots[2].params.cutoff = 2200;
  slots[3].params.level = -12; slots[3].params.delay = 0.35; slots[3].params.reverb = 0.3;
  slots[4].params.level = -13; slots[4].params.reverb = 0.45;
  const tracks = Array.from({ length: TRACKS }, (_, i) => emptyTrack(i));
  const set = (t: number, steps: number[], f: (s: Step, k: number) => void = () => {}) => steps.forEach((k, j) => { const s = tracks[t].steps[k]; s.on = true; f(s, j); });
  Object.assign(tracks[0], { name: "Kick", targets: [0], note: 36 }); tracks[0].steps.forEach((s) => (s.note = 36)); set(0, [0, 4, 8, 12]);
  Object.assign(tracks[1], { name: "Clap", targets: [0], note: 39 }); tracks[1].steps.forEach((s) => (s.note = 39)); set(1, [4, 12]);
  Object.assign(tracks[2], { name: "Hats", targets: [0], note: 42 }); tracks[2].steps.forEach((s) => (s.note = 42));
  set(2, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], (s, k) => { s.vel = k % 4 === 2 ? 0.95 : 0.45; s.prob = k % 2 ? 0.8 : 1; if (k === 14) { s.note = 46; s.prob = 1; } if (k === 7) s.ratchet = 2; });
  Object.assign(tracks[3], { name: "Acid", targets: [1], note: 45 });
  const acid = [45, 45, 57, 45, 48, 45, 55, 45, 45, 52, 45, 57, 43, 45, 60, 47];
  set(3, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], (s, k) => {
    s.note = acid[k]; s.on = ![5, 13].includes(k); s.accent = [2, 6, 11, 14].includes(k); s.slide = [3, 9, 13].includes(k); s.len = 0.6;
    s.a = 0.5 + 0.5 * Math.sin((k / 16) * Math.PI * 2); // CV A: a filter wave patched to the cutoff
  });
  Object.assign(tracks[4], { name: "Chords", targets: [2], length: 32 });
  [[0, 57, 4], [8, 53, 3], [16, 48, 3], [24, 55, 1]].forEach(([k, note, chord]) => { const s = tracks[4].steps[k]; Object.assign(s, { on: true, note, chord, len: 6, vel: 0.7 }); });
  Object.assign(tracks[5], { name: "Lead", targets: [3], length: 32, division: 2 });
  [[0, 69], [3, 72], [4, 76], [6, 74], [8, 72], [11, 69], [12, 67], [14, 69], [16, 69], [19, 72], [20, 74], [22, 76], [24, 79], [27, 76], [28, 74]].forEach(([k, note]) => Object.assign(tracks[5].steps[k], { on: true, note, len: 1.5, vel: 0.75 }));
  tracks[5].mute = true;
  Object.assign(tracks[6], { name: "Strings", targets: [4], length: 64, division: 1 });
  [[0, 69], [8, 65], [16, 64], [24, 67]].forEach(([k, note]) => Object.assign(tracks[6].steps[k], { on: true, note, len: 8, vel: 0.6, chord: 8 }));
  tracks[6].mute = true;
  Object.assign(tracks[7], { name: "Track 8", targets: [] });
  const patterns: Pattern[] = Array.from({ length: PATTERNS }, (_, i) => ({ tracks: i === 0 ? tracks : Array.from({ length: TRACKS }, (_, t) => ({ ...structuredClone(tracks[t]), steps: Array.from({ length: MAX_STEPS }, () => emptyStep(tracks[t].note)) })) }));
  return {
    schema: STATE_SCHEMA, name: "Demo groove", bpm: 124, swing: 0.12, pattern: 0, patterns, slots,
    fx: defaultsFor(FX_PARAMS), mod: { ...defaultsFor(MOD_PARAMS), mac0: 0.3 },
    cables: [
      { src: "t3.a", dst: "s1.cutoff", amt: 0.25 }, // the acid track's CV lane sweeps the bass filter
      { src: "lfo0", dst: "s1.envMod", amt: 0.2 }, // a 2-bar LFO moves the envelope depth
      { src: "mac0", dst: "s1.res", amt: 0.3 }, // Macro 1 adds resonance
      { src: "t0.env", dst: "s2.level", amt: -0.35 }, // the kick ducks the chords (sidechain pump)
      { src: "lfo1", dst: "s2.cutoff", amt: 0.12 },
    ],
  };
}

/* ---------------- Validation of anything loaded ---------------- */
const num = (x: unknown, lo: number, hi: number, def: number) => (typeof x === "number" && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : def);
const int = (x: unknown, lo: number, hi: number, def: number) => Math.round(num(x, lo, hi, def));
const str = (x: unknown, max: number, def = "") => (typeof x === "string" ? x.slice(0, max) : def);
const obj = (x: unknown): Record<string, unknown> => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {});

function cleanParams(defs: ParamDef[], raw: unknown) {
  const r = obj(raw);
  return Object.fromEntries(defs.map((d) => [d.id, sanitize(d, r[d.id])]));
}
function cleanStep(raw: unknown): Step {
  const s = obj(raw), cv = (x: unknown) => (x === null || x === undefined ? null : num(x, 0, 1, 0.5));
  return {
    on: s.on === true, note: int(s.note, 0, 127, 60), vel: num(s.vel, 0, 1, 0.8), len: num(s.len, 0.05, 64, 1), prob: num(s.prob, 0, 1, 1),
    ratchet: int(s.ratchet, 1, 4, 1), slide: s.slide === true, accent: s.accent === true, chord: int(s.chord, 0, CHORDS.length - 1, 0), a: cv(s.a), b: cv(s.b),
  };
}
function cleanTrack(raw: unknown, i: number): Track {
  const t = obj(raw), steps = Array.isArray(t.steps) ? t.steps : [], note = int(t.note, 0, 127, 60);
  return {
    note,
    name: str(t.name, 40, `Track ${i + 1}`) || `Track ${i + 1}`,
    targets: Array.isArray(t.targets) ? [...new Set(t.targets.filter((x) => Number.isInteger(x) && x >= 0 && x < SLOTS) as number[])] : [],
    length: int(t.length, 1, MAX_STEPS, 16), division: int(t.division, 0, DIVISIONS.length - 1, 3), mute: t.mute === true,
    steps: Array.from({ length: MAX_STEPS }, (_, k) => (steps[k] ? cleanStep(steps[k]) : emptyStep(note))),
  };
}
// Turns anything (a file, another app's data, old storage) into a safe state.
// Unknown machines become empty slots; numbers are clamped to their ranges.
export function sanitizeState(raw: unknown): SynthState {
  const s = obj(raw);
  if (s.schema !== undefined && s.schema !== STATE_SCHEMA) throw new Error(`This patch was saved by a newer version (schema ${String(s.schema)}).`);
  const slotsRaw = Array.isArray(s.slots) ? s.slots : [];
  const slots = Array.from({ length: SLOTS }, (_, i): SlotState => {
    const r = obj(slotsRaw[i]), machine = str(r.machine, 40);
    if (!machineById(machine)) return slotState("");
    return { machine, preset: str(r.preset, 60), params: cleanParams(slotParamDefs(machine), r.params), mute: r.mute === true, solo: r.solo === true };
  });
  const patsRaw = Array.isArray(s.patterns) ? s.patterns : [];
  const patterns = Array.from({ length: PATTERNS }, (_, p) => {
    const tr = obj(patsRaw[p]).tracks, list = Array.isArray(tr) ? tr : [];
    return { tracks: Array.from({ length: TRACKS }, (_, t) => cleanTrack(list[t], t)) };
  });
  const state: SynthState = {
    schema: STATE_SCHEMA, name: str(s.name, 80, "Untitled"), bpm: num(s.bpm, 30, 300, 120), swing: num(s.swing, 0, 0.5, 0),
    pattern: int(s.pattern, 0, PATTERNS - 1, 0), patterns, slots, fx: cleanParams(FX_PARAMS, s.fx), mod: cleanParams(MOD_PARAMS, s.mod), cables: [],
  };
  const srcIds = new Set(sources(state).map((x) => x.id)), dstIds = new Set(destinations(state).map((x) => x.id));
  state.cables = (Array.isArray(s.cables) ? s.cables : []).slice(0, 64).map(obj)
    .filter((c) => srcIds.has(c.src as string) && dstIds.has(c.dst as string))
    .map((c) => ({ src: c.src as string, dst: c.dst as string, amt: num(c.amt, -1, 1, 0) }));
  return state;
}
// For saving: steps that are off and carry no CV become null (sanitizeState
// restores them), which keeps a full eight-pattern session small.
export function compactState(s: SynthState): unknown {
  const isBlank = (st: Step, note: number) => !st.on && st.a === null && st.b === null && st.note === note && st.vel === 0.8 && st.len === 1 && st.prob === 1 && st.ratchet === 1 && !st.slide && !st.accent && st.chord === 0;
  return { ...s, patterns: s.patterns.map((p) => ({ tracks: p.tracks.map((t) => {
    const steps = t.steps.map((st) => (isBlank(st, t.note) ? null : st));
    while (steps.length && steps[steps.length - 1] === null) steps.pop();
    return { ...t, steps };
  }) })) };
}
export const machineList = () => MACHINES.map((m) => ({ id: m.id, name: m.name, inspiredBy: m.inspiredBy }));
