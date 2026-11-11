// A recording ("take") of what the rack played: the output's audio as a
// 16-bit stereo WAV and every slot's notes as a multitrack MIDI file.
import { writeMidiTracks, type MidiTrack, type Note } from "./midi.ts";

export type RecNote = [frame: number, slot: number, note: number, vel: number, on: number];
export type TakeParts = { rate: number; start: number; end: number; pcm: Int16Array[]; notes: RecNote[] };

// 16-bit stereo WAV from interleaved chunks.
export function takeWav(pcm: Int16Array[], rate: number): Uint8Array {
  const samples = pcm.reduce((n, c) => n + c.length, 0), bytes = samples * 2;
  const out = new Uint8Array(44 + bytes), v = new DataView(out.buffer);
  const put = (at: number, s: string) => [...s].forEach((ch, i) => (out[at + i] = ch.charCodeAt(0)));
  put(0, "RIFF"); v.setUint32(4, 36 + bytes, true); put(8, "WAVE");
  put(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
  put(36, "data"); v.setUint32(40, bytes, true);
  let p = 44;
  for (const c of pcm) { new Int16Array(out.buffer, p, c.length).set(c); p += c.length * 2; } // WAV is little-endian, like every platform we run on
  return out;
}

// Notes per slot. Notes still held when recording stopped end there.
export function takeNotes(parts: TakeParts): Map<number, Note[]> {
  const bySlot = new Map<number, Note[]>(), open = new Map<string, { start: number; vel: number }[]>();
  const sec = (f: number) => Math.max(0, (f - parts.start) / parts.rate), endSec = sec(parts.end);
  for (const [frame, slot, note, vel, on] of parts.notes) {
    const key = `${slot}:${note}`;
    if (on) { (open.get(key) ?? open.set(key, []).get(key)!).push({ start: sec(frame), vel }); continue; }
    const o = open.get(key)?.shift();
    if (!o) continue;
    const list = bySlot.get(slot) ?? bySlot.set(slot, []).get(slot)!;
    list.push({ pitch: note, start: o.start, end: Math.max(o.start + 0.005, sec(frame)), velocity: Math.max(1, Math.min(127, o.vel)) });
  }
  for (const [key, os] of open) {
    const [slot, note] = key.split(":").map(Number);
    for (const o of os) (bySlot.get(slot) ?? bySlot.set(slot, []).get(slot)!).push({ pitch: note, start: o.start, end: Math.max(o.start + 0.005, endSec), velocity: Math.max(1, o.vel) });
  }
  for (const l of bySlot.values()) l.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  return bySlot;
}

// One MIDI track per slot that played, named after its machine; drum
// machines on channel 10 (General MIDI drums).
export function takeMidi(parts: TakeParts, bpm: number, name: string, slots: { name: string; drum: boolean }[]): Uint8Array | null {
  const bySlot = takeNotes(parts), tracks: MidiTrack[] = [];
  let ch = 0;
  for (const [slot, notes] of [...bySlot].sort((a, b) => a[0] - b[0])) {
    const info = slots[slot] ?? { name: `Slot ${slot + 1}`, drum: false };
    tracks.push({ name: `${slot + 1} ${info.name}`, channel: info.drum ? 9 : ch++ % 9, program: 0, notes });
  }
  return tracks.length ? writeMidiTracks({ bpm, name, tracks: tracks.slice(0, 15) }) : null;
}
