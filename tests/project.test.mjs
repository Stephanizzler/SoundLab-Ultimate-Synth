import assert from "node:assert/strict";
import { clock } from "./helpers.mjs";
const P = await import("../src/core/index.ts");
const { saveRender, stateFromVersion, patternToMidi, midiToTrack, APP_ID } = await import("../src/engine/projectio.ts");
const { renderOffline } = await import("../src/engine/engine.ts");
const { demoState, sanitizeState, compactState, emptyTrack, slotState } = await import("../src/engine/state.ts");
const { readMidi } = await import("../src/engine/midi.ts");
const { writeWav, readWav } = await import("../src/engine/wav.ts");

const rate = 48000, state = demoState();
const mix = renderOffline(state, rate, 1, { tail: 0.5 });
const render = { bars: 1, sampleRate: rate, bitDepth: 24, tail: 0.5, stems: true };
const stems = [0, 1].map((i) => ({ name: `Slot ${i + 1}`, audio: renderOffline(state, rate, 1, { solo: i, tail: 0.5 }) }));
const midi = patternToMidi(state, 1);

// A render with no project starts one; it is valid and measured.
const a = saveRender(null, new Map(), clock, { state, mix, rate, render, stems, midi, ownerName: "Steph" });
assert.deepEqual(P.problems(a.project), []);
assert.equal(a.version.label, "Synth 1");
assert.equal(a.version.source.app, APP_ID);
assert.equal(a.version.source.settings.schema, 1);
const asset = P.findAsset(a.project, a.version.assetId);
assert.equal(asset.audio.sampleRate, rate);
assert.ok(asset.audio.loudness.integratedLufs < -5 && asset.audio.loudness.integratedLufs > -30, "loudness measured with measureLoudness");
assert.equal(a.version.stemIds.length, 3, "two stems and the MIDI file");
assert.deepEqual(P.unusedAssets(a.project), []);
assert.equal(a.project.bpm, 124);

// The saved settings bring the whole instrument back.
assert.deepEqual(stateFromVersion(a.project, a.version.id), sanitizeState(compactState(state)));
assert.deepEqual(sanitizeState(compactState(state)), state, "compacting loses nothing");
assert.ok(JSON.stringify(compactState(state)).length < JSON.stringify(state).length / 4, "compact state is much smaller");

// Basing a render on someone else's version leaves that version untouched.
const before = JSON.stringify(a.project.songs[0].versions[0]);
const b = saveRender(a.project, a.files, clock, { state, mix, rate, render, basedOn: a.version.id });
assert.deepEqual(P.problems(b.project), []);
assert.equal(JSON.stringify(b.project.songs[0].versions[0]), before);
assert.equal(b.version.label, "Synth 2");
assert.equal(b.version.source.basedOn, a.version.id);
assert.throws(() => saveRender(a.project, a.files, clock, { state, mix, rate, render, basedOn: "missing" }), /not in the project/);
assert.equal(stateFromVersion(b.project, "missing"), null);

// The .soundlab bundle round-trips, every file intact.
const back = await P.readBundle(P.writeBundle(b.project, b.files));
assert.deepEqual(back.project, b.project);
const wav = readWav(back.files.get(a.version.assetId));
assert.equal(wav.rate, rate); assert.equal(wav.bits, 24); assert.equal(wav.channels.length, 2);

// MIDI out and back in: the acid line survives the trip into an empty track.
const song = readMidi(midi);
assert.equal(Math.round(song.bpm), 124);
const acidPart = song.tracks.findIndex((t) => t.name === "Acid");
const empty = emptyTrack(7, [1], 60);
const imp = midiToTrack(midi, empty, { part: acidPart, bpm: 124 });
const orig = state.patterns[0].tracks[3].steps.slice(0, 16);
assert.deepEqual(imp.track.steps.slice(0, 16).map((s) => s.on && s.note), orig.map((s) => s.on && s.note));
assert.equal(imp.track.length, 16);
assert.equal(imp.dropped, 0);
const drums = song.tracks.find((t) => t.name === "Kick");
assert.equal(drums.channel, 9, "drum tracks export on MIDI channel 10");
assert.throws(() => midiToTrack(new Uint8Array([1, 2, 3]), empty), /not a MIDI file/);
// Chords in a MIDI file become a step's extra notes.
const chordy = demoState(); chordy.patterns[0].tracks[0].steps[0].more = [43, 48];
const chordTrack = midiToTrack(patternToMidi(chordy, 1), emptyTrack(7, [0], 36), { part: 0, bpm: 124 }).track;
assert.equal(chordTrack.steps[0].note, 36); assert.deepEqual(chordTrack.steps[0].more, [43, 48]);
const silent = demoState(); silent.patterns[0].tracks.forEach((t) => t.steps.forEach((s) => (s.on = false)));
assert.throws(() => patternToMidi(silent, 1), /no notes/);

// Anything loaded is cleaned: junk becomes a safe default, newer schemas are refused.
for (const junk of [null, 5, "x", [], { slots: [{ machine: "nope" }], bpm: 1e9, swing: -3, cables: [{ src: "evil", dst: "s0.cutoff", amt: 9 }] }]) {
  const s = sanitizeState(junk);
  assert.equal(s.slots.length, 8); assert.equal(s.patterns.length, 8);
  assert.ok(s.bpm >= 30 && s.bpm <= 300 && s.swing >= 0 && s.cables.length === 0);
}
const odd = structuredClone(state);
odd.slots[1].params.cutoff = -5; odd.slots[1].params.wave = 7.3; odd.patterns[0].tracks[0].steps[0].ratchet = 99; odd.cables[0].amt = 4;
const clean = sanitizeState(odd);
assert.equal(clean.slots[1].params.cutoff, 60); assert.equal(clean.slots[1].params.wave, 1);
assert.equal(clean.patterns[0].tracks[0].steps[0].ratchet, 4); assert.equal(clean.cables[0].amt, 1);
assert.throws(() => sanitizeState({ ...state, schema: 2 }), /newer version/);
const one = sanitizeState({ ...state, slots: [slotState("fm-six")] });
assert.equal(one.slots[0].machine, "fm-six"); assert.equal(one.slots[1].machine, "");
assert.ok(one.cables.every((c) => !c.dst.startsWith("s1.")), "cables to removed slots are dropped");
console.log("project tests passed");
