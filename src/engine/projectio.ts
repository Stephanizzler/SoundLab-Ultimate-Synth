// How SoundLab Ultimate Synth exchanges work with other SoundLab apps
// (SPEC.md rules 1-3): a render is saved as a NEW version with the full
// instrument state in source.settings, so it can be reopened and changed.
// MIDI goes both ways: patterns export as .mid, and .mid files (for example
// from SoundLab MIDI Transcript) import into a sequencer track.
import {
  addAsset, addSong, addVersion, createProject, findVersion, measureLoudness, setAppSettings,
  type AppId, type Clock, type Project,
} from "../core/index.ts";
import { writeWav } from "./wav.ts";
import { MIDI_MIME, writeMidiTracks, readMidi, type MidiTrack, type Note } from "./midi.ts";
import { CHORDS, DIVISIONS, MAX_STEPS, compactState, emptyStep, sanitizeState, type SynthState, type Track } from "./state.ts";
import { machineById } from "../machines/index.ts";

export const APP_ID: AppId = "soundlab.synth";
export const SETTINGS_SCHEMA = 1;

export type RenderInfo = { bars: number; sampleRate: number; bitDepth: 24; tail: number; stems: boolean };
export type SynthRecord = { state: unknown; render: RenderInfo }; // state is compactState(...)
export type Audio = { L: Float32Array; R: Float32Array };

export const synthCount = (p: Project) => p.songs.flatMap((s) => s.versions).filter((v) => v.source.app === APP_ID).length;
const safeName = (s: string) => s.replace(/[^\w .()-]+/g, "").trim().slice(0, 80) || "Synth";

// Saves a render into a project (a new one if `project` is null). Returns the
// updated project and files; the version it based on, if any, is untouched.
export function saveRender(
  project: Project | null,
  files: Map<string, Uint8Array>,
  c: Clock,
  x: {
    state: SynthState; mix: Audio; rate: number; render: RenderInfo; ownerName?: string; songId?: string; basedOn?: string; memberId?: string;
    stems?: { name: string; audio: Audio }[]; midi?: Uint8Array; description?: string;
  },
) {
  let p = project, songId = x.songId;
  if (!p) {
    p = createProject(c, x.state.name || "Synth session", { name: x.ownerName || "Owner" });
    p = { ...p, bpm: Math.round(x.state.bpm * 10) / 10 };
  }
  const memberId = x.memberId ?? p.members.find((m) => m.role === "owner")!.id;
  if (x.basedOn) { const f = findVersion(p, x.basedOn); if (!f) throw new Error("The version this was based on is not in the project."); songId = f.song.id; }
  if (!songId || !p.songs.some((s) => s.id === songId)) { const s = addSong(p, c, x.state.name || "Synth session"); p = s.project; songId = s.song.id; }
  const label = `Synth ${synthCount(p) + 1}`;
  const base = safeName(`${p.songs.find((s) => s.id === songId)!.title} ${label}`);
  const out = new Map(files);
  const addAudio = (name: string, kind: "audio" | "stem", a: Audio) => {
    const wav = writeWav([a.L, a.R], x.rate, 24);
    const r = addAsset(p!, c, { kind, name, mime: "audio/wav", bytes: wav.length, createdBy: memberId, audio: { sampleRate: x.rate, channels: 2, durationSeconds: a.L.length / x.rate, loudness: measureLoudness([a.L, a.R], x.rate) } });
    p = r.project; out.set(r.asset.id, wav);
    return r.asset.id;
  };
  const mixId = addAudio(`${base}.wav`, "audio", x.mix);
  const stemIds = (x.stems ?? []).map((s) => addAudio(safeName(`${base} ${s.name}`) + ".wav", "stem", s.audio));
  if (x.midi) {
    const r = addAsset(p, c, { kind: "midi", name: `${base}.mid`, mime: MIDI_MIME, bytes: x.midi.length, createdBy: memberId });
    p = r.project; out.set(r.asset.id, x.midi); stemIds.push(r.asset.id);
  }
  const record: SynthRecord = { state: compactState(x.state), render: x.render };
  const v = addVersion(p, c, songId, {
    stage: "demo", label, assetId: mixId, stemIds, createdBy: memberId,
    description: x.description ?? describe(x.state, x.render),
    source: { app: APP_ID, ...(x.basedOn ? { basedOn: x.basedOn } : {}), settings: { app: APP_ID, schema: SETTINGS_SCHEMA, data: record } },
  });
  p = setAppSettings(v.project, c, { app: APP_ID, schema: SETTINGS_SCHEMA, data: { last: record } });
  return { project: p, files: out, version: v.version, songId };
}

export function describe(s: SynthState, r: RenderInfo) {
  const used = s.slots.map((x) => machineById(x.machine)?.name).filter(Boolean);
  return `${r.bars} bars at ${s.bpm} BPM, pattern ${"ABCDEFGH"[s.pattern]}, rendered by SoundLab Ultimate Synth with ${used.join(", ") || "no instruments"}.${r.stems ? " Each instrument is attached as a stem, with its effect sends." : ""}`;
}

// The instrument state saved with a version, or null if it has none.
export function stateFromVersion(project: Project, versionId: string): SynthState | null {
  const f = findVersion(project, versionId);
  const st = f?.version.source.settings;
  if (!f || f.version.source.app !== APP_ID || !st || st.app !== APP_ID) return null;
  if (st.schema > SETTINGS_SCHEMA) throw new Error("This version was made by a newer SoundLab Ultimate Synth.");
  const data = st.data as Partial<SynthRecord> | null;
  return data && data.state ? sanitizeState(data.state) : null;
}

/* ---------------- MIDI ---------------- */
// Exports `bars` of the current pattern, one MIDI track per sequencer track.
// Ratchets and chords are written out; steps with a probability below 100%
// are written as if they always play (the audio render rolls the dice).
export function patternToMidi(s: SynthState, bars: number): Uint8Array {
  const spb = 60 / s.bpm, tracks: MidiTrack[] = [];
  s.patterns[s.pattern].tracks.forEach((tr, ti) => {
    if (!tr.targets.length || tr.mute) return;
    const drum = tr.targets.some((i) => machineById(s.slots[i]?.machine)?.kind === "drum");
    const per = DIVISIONS[tr.division].perBeat, total = Math.floor(bars * 4 * per), notes: Note[] = [];
    for (let c = 0; c < total; c++) {
      const st = tr.steps[c % tr.length];
      if (!st.on || st.prob <= 0) continue;
      const swing = (per === 4 || per === 8) && c % 2 ? s.swing / per : 0;
      const start = (c / per + swing) * spb, dur = spb / per, sub = dur / st.ratchet;
      for (let k = 0; k < st.ratchet; k++) {
        const len = st.slide ? sub * 1.05 : Math.min(st.len * dur, st.ratchet > 1 ? sub * 0.9 : st.len * dur);
        const pitches = new Set([...CHORDS[st.chord].iv.map((iv) => Math.min(127, st.note + iv)), ...st.more]);
        for (const pitch of pitches) notes.push({ pitch, start: start + k * sub, end: start + k * sub + len, velocity: Math.max(1, Math.round(st.vel * 127)) });
      }
    }
    if (notes.length) tracks.push({ name: tr.name, channel: drum ? 9 : ti % 9, program: 0, notes });
  });
  if (!tracks.length) throw new Error("There are no notes to export: turn on some steps first.");
  return writeMidiTracks({ bpm: s.bpm, name: s.name, tracks: tracks.slice(0, 15) });
}

// Puts a MIDI file's notes on a sequencer track's steps. Notes are snapped to
// the track's grid; notes starting on the same step become a chord (the
// lowest leads, up to eight more), and any beyond that are counted.
export function midiToTrack(bytes: Uint8Array, track: Track, opts: { bpm?: number; part?: number } = {}) {
  const song = readMidi(bytes);
  const part = song.tracks[opts.part ?? 0] ?? song.tracks[0];
  if (!part || !part.notes.length) throw new Error("This MIDI file has no notes.");
  const bpm = opts.bpm ?? song.bpm, per = DIVISIONS[track.division].perBeat, stepSec = 60 / bpm / per;
  const steps = Array.from({ length: MAX_STEPS }, () => emptyStep(track.note));
  let dropped = 0, beyond = 0, last = 0;
  for (const n of part.notes) {
    const k = Math.round(n.start / stepSec);
    if (k >= MAX_STEPS) { beyond++; continue; }
    const st = steps[k];
    if (st.on) {
      // A chord: the lowest note leads, the others become the step's extra notes (up to 8).
      const all = [st.note, ...st.more, n.pitch].sort((x, y) => x - y);
      const uniq = [...new Set(all)];
      if (uniq.length > 9) { dropped++; continue; }
      st.note = uniq[0]; st.more = uniq.slice(1);
      continue;
    }
    Object.assign(st, { on: true, note: n.pitch, vel: Math.max(0.05, n.velocity / 127), len: Math.max(0.1, Math.min(16, (n.end - n.start) / stepSec)) });
    last = Math.max(last, k);
  }
  const length = Math.min(MAX_STEPS, Math.max(16, Math.ceil((last + 1) / 16) * 16));
  return { track: { ...track, steps, length, name: (part.name || track.name).slice(0, 40) }, bpm: song.bpm, notes: part.notes.length, dropped, beyond, parts: song.tracks.map((t, i) => t.name || `Part ${i + 1}`) };
}
