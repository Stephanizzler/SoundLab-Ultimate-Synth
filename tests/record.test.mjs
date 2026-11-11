// Recording: the audio core captures the output and every slot's notes; a
// take becomes a WAV and a multitrack MIDI file that read back correctly.
import assert from "node:assert/strict";
const { SynthCore } = await import("../src/app/synthcore.ts");
const { demoState } = await import("../src/engine/state.ts");
const { takeWav, takeMidi, takeNotes } = await import("../src/engine/takes.ts");
const { readWav } = await import("../src/engine/wav.ts");
const { readMidi } = await import("../src/engine/midi.ts");

const rate = 48000;
function record(seconds, opts, during) {
  const chunks = [];
  const core = new SynthCore(rate, () => {}, false, (r) => chunks.push(r));
  const st = demoState();
  core.handle({ type: "state", state: st });
  const L = new Float32Array(128), R = new Float32Array(128);
  for (let i = 0; i < 20; i++) core.process(L, R, 128); // some time passes before recording
  core.handle({ type: "record", on: true, ...opts });
  during?.(core);
  const blocks = Math.round((seconds * rate) / 128);
  for (let i = 0; i < blocks; i++) { core.process(L, R, 128); if (i === Math.round(blocks / 2)) during?.(core, "mid"); }
  core.handle({ type: "record", on: false, audio: false, midi: false });
  const parts = { rate, start: chunks[0]?.start ?? 0, end: 0, pcm: [], notes: [] };
  for (const c of chunks) { if (c.pcm) parts.pcm.push(c.pcm); parts.notes.push(...c.notes); }
  parts.end = parts.start + parts.pcm.reduce((n, c) => n + c.length / 2, 0);
  return { parts, chunks, st, blocks };
}

// Audio and MIDI of the demo groove playing for 2 seconds.
{
  const { parts, chunks, st, blocks } = record(2, { audio: true, midi: true }, (core, when) => { if (!when) core.handle({ type: "play" }); });
  assert.ok(chunks.at(-1).done, "the last chunk ends the take");
  const frames = parts.pcm.reduce((n, c) => n + c.length / 2, 0);
  assert.equal(frames, blocks * 128, "every sample recorded, none twice");
  const wav = readWav(takeWav(parts.pcm, rate));
  assert.equal(wav.rate, rate); assert.equal(wav.channels.length, 2); assert.equal(wav.channels[0].length, frames);
  let peak = 0; for (const x of wav.channels[0]) peak = Math.max(peak, Math.abs(x));
  assert.ok(peak > 0.05, `the recording has the sound (${peak})`);
  assert.ok(parts.notes.length > 10, `notes recorded (${parts.notes.length})`);
  assert.ok(parts.notes.every((n) => n[0] >= parts.start), "notes are stamped from the start of the take");
  const slots = st.slots.map((s) => ({ name: s.machine || "Empty", drum: s.machine.includes("kit") }));
  const mid = readMidi(takeMidi(parts, st.bpm, "Test take", slots));
  const bySlot = takeNotes(parts);
  assert.equal(mid.tracks.length, bySlot.size, "one MIDI track per slot that played");
  assert.ok(mid.tracks.every((t) => t.notes.every((n) => n.start >= 0 && n.end > n.start && n.start <= 2.01)), "note times fall inside the take");
  assert.ok(Math.abs(mid.bpm - st.bpm) < 0.01, "the file has the session tempo");
  const drum = mid.tracks.find((t) => t.name.includes("kit"));
  if (drum) assert.equal(drum.channel, 9, "drum machines are on MIDI channel 10");
}

// Live notes only, MIDI only: a held note is closed at the end of the take.
{
  const { parts } = record(1, { audio: false, midi: true }, (core, when) => {
    if (!when) { core.handle({ type: "note", slot: 2, note: 60, vel: 0.8, on: true }); core.handle({ type: "note", slot: 2, note: 64, vel: 0.5, on: true }); }
    else core.handle({ type: "note", slot: 2, note: 60, vel: 0, on: false });
  });
  assert.equal(parts.pcm.length, 0, "no audio when only MIDI is recorded");
  parts.end = parts.start + rate;
  const notes = takeNotes(parts).get(2);
  assert.equal(notes.length, 2);
  const c = notes.find((n) => n.pitch === 60), e = notes.find((n) => n.pitch === 64);
  assert.ok(Math.abs(c.end - 0.5) < 0.01, `released note ends when released (${c.end})`);
  assert.ok(Math.abs(e.end - 1) < 0.01, `held note ends with the take (${e.end})`);
  assert.equal(e.velocity, Math.round(0.5 * 127));
}
console.log("recording tests passed (audio sample-exact, MIDI per slot, held notes closed)");
