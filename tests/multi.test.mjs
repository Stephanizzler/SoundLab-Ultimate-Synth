import assert from "node:assert/strict";
import { peak, finite } from "./helpers.mjs";
const { Engine, BLOCK } = await import("../src/engine/engine.ts");
const { demoState, slotState, emptyTrack, PERFORMANCES, performanceSlots, sanitizeState } = await import("../src/engine/state.ts");
const { MACHINES, machineById } = await import("../src/machines/index.ts");
const { DX_ALGORITHMS } = await import("../src/machines/dx7.ts");

const rate = 48000;
function rack(slots, extra = {}) {
  const s = demoState(); s.cables = []; s.slots = s.slots.map(() => slotState(""));
  slots.forEach(([id, params], i) => { s.slots[i] = slotState(id); Object.assign(s.slots[i].params, { reverb: 0, delay: 0 }, params); });
  s.patterns[0].tracks = s.patterns[0].tracks.map((_, i) => emptyTrack(i));
  Object.assign(s, extra);
  return new Engine(rate, s);
}
const run = (e, sec) => { const L = new Float32Array(BLOCK), R = new Float32Array(BLOCK); for (let i = 0; i < sec * rate; i += BLOCK) e.process(L, R, BLOCK); };
const gated = (slot) => slot.voices.filter((v) => v.gateOn).map((v) => v.note);

// The real polyphony of each original.
const counts = { "studio-poly": 5, "chorus-poly": 6, "flagship-poly": 8, "multimode-poly": 8, "expressive-poly": 8, "fm-six": 16, "lead-va": 16, "super-va": 16, "wave-scanner": 8, "ladder-mono": 1, "scream-mono": 1, "acid-bass": 1 };
for (const [id, n] of Object.entries(counts)) assert.equal(machineById(id).voices, n, `${id} has ${n} voices`);
assert.equal(machineById("boom-kit").drums.length, 16, "808: all sixteen instruments");
assert.equal(machineById("punch-kit").drums.length, 11, "909: all eleven instruments");
for (const m of MACHINES) assert.ok(m.kind === "drum" ? m.presets.length >= 4 : m.presets.length >= 8, `${m.name} has its presets`);

// DX7: 32 algorithms; every operator is heard or modulates something; modulation flows down.
assert.equal(DX_ALGORITHMS.length, 32);
for (const [i, a] of DX_ALGORITHMS.entries()) {
  for (let op = 1; op <= 6; op++) assert.ok(a.car.includes(op) || a.mods.some(([m]) => m === op), `algorithm ${i + 1}: operator ${op} is used`);
  for (const [m, t] of a.mods) assert.ok(m > t && !a.car.includes(m), `algorithm ${i + 1}: ${m}→${t} is a modulator above its target`);
}
assert.deepEqual(DX_ALGORITHMS[31].car, [1, 2, 3, 4, 5, 6], "algorithm 32 is six carriers");

// Unison: one key plays the whole stack, detuned and spread; mono plays one voice.
{
  const e = rack([["studio-poly", { assign: 1, uniVoices: 5, uniDetune: 20, spread: 1 }]]);
  e.noteOn(0, 60, 0.8);
  const vs = e.slots[0].voices;
  assert.deepEqual(gated(e.slots[0]), [60, 60, 60, 60, 60], "unison stacks all five voices on one note");
  assert.ok(Math.abs(vs[0].detune + 0.2) < 1e-9 && Math.abs(vs[4].detune - 0.2) < 1e-9 && vs[0].pan === -1 && vs[4].pan === 1, "spread in pitch and stereo");
  const L = new Float32Array(4800), R = new Float32Array(4800); e.process(L, R, 4800);
  assert.ok(finite(L) && peak(L) < 1.5);
  let diff = 0; for (let i = 0; i < 4800; i++) diff += Math.abs(L[i] - R[i]);
  assert.ok(diff > 1, "a spread stack is stereo");
  e.noteOn(0, 64, 0.8); assert.deepEqual(gated(e.slots[0]), [64, 64, 64, 64, 64], "unison is monophonic");
  const m = rack([["flagship-poly", { assign: 2 }]]);
  m.noteOn(0, 60, 0.8); m.noteOn(0, 67, 0.8);
  assert.deepEqual(gated(m.slots[0]), [67], "mono mode uses one voice");
}

// Arpeggiator: steps through held notes on the beat, over octaves, in each mode.
{
  const order = (mode, range, notes) => {
    const e = rack([["chorus-poly", { arp: mode, arpRange: range, arpRate: 3 }]], { bpm: 120 });
    const seen = [], slot = e.slots[0], play = slot.play.bind(slot);
    slot.play = (n, v, f) => { seen.push(n); play(n, v, f); };
    notes.forEach((n) => e.noteOn(0, n, 0.8));
    run(e, 0.125 * 7.9); // 8 sixteenths at 120 BPM
    return seen;
  };
  assert.deepEqual(order(1, 0, [64, 60, 67]), [60, 64, 67, 60, 64, 67, 60, 64], "up");
  assert.deepEqual(order(2, 0, [64, 60, 67]), [67, 64, 60, 67, 64, 60, 67, 64], "down");
  assert.deepEqual(order(3, 0, [60, 64, 67]), [60, 64, 67, 64, 60, 64, 67, 64], "up & down");
  assert.deepEqual(order(1, 1, [60, 64]), [60, 64, 72, 76, 60, 64, 72, 76], "two octaves");
  assert.deepEqual(order(5, 0, [67, 60, 64]), [67, 60, 64, 67, 60, 64, 67, 60], "as played");
  // While the transport runs, the arpeggio locks to the beat grid.
  const e = rack([["chorus-poly", { arp: 1, arpRate: 1 }]], { bpm: 120 });
  const times = [], slot = e.slots[0], play = slot.play.bind(slot);
  slot.play = (n, v, f) => { times.push(e.beat); play(n, v, f); };
  e.play(); run(e, 0.3); e.noteOn(0, 60, 0.8); run(e, 1.2);
  assert.ok(times.length >= 4 && times.every((b) => Math.abs(b * 2 - Math.round(b * 2)) < 0.02), `arp notes fall on eighth notes (${times.map((b) => b.toFixed(2))})`);
  e.noteOff(0, 60); run(e, 0.3);
  assert.equal(gated(slot).length, 0, "releasing the keys stops the arpeggio");
}

// Multitimbral: channels, key ranges (split), layers and transpose.
{
  const e = rack([
    ["ladder-mono", { channel: 1, keyHi: 59, transpose: -12 }], // lower half, bass an octave down
    ["flagship-poly", { channel: 1, keyLo: 60 }], // upper half
    ["string-machine", { channel: 1, keyLo: 60 }], // layered with the upper half
    ["fm-six", { channel: 2 }], // its own channel
  ]);
  e.midiNote(0, 48, 0.8, true); e.midiNote(0, 72, 0.8, true); e.midiNote(1, 65, 0.8, true);
  assert.deepEqual(gated(e.slots[0]), [36], "split: the bass plays the low key, transposed down an octave");
  assert.deepEqual(gated(e.slots[1]), [72], "split: the upper part plays the high key");
  assert.deepEqual(gated(e.slots[2]).filter((n) => n >= 0), [72], "layer: a second slot on the same zone");
  assert.deepEqual(gated(e.slots[3]), [65], "channel 2 reaches only its slot");
  e.midiNote(0, 48, 0, false); e.midiNote(0, 72, 0, false);
  assert.deepEqual([...gated(e.slots[0]), ...gated(e.slots[1]), ...gated(e.slots[2])], [], "note-offs follow the transpose");
  const omni = rack([["studio-poly", {}]]);
  omni.midiNote(9, 60, 0.8, true); assert.deepEqual(gated(omni.slots[0]), [60], "Omni hears every channel");
  // Transpose also applies to the sequencer.
  const s = rack([["studio-poly", { transpose: 7 }]], { bpm: 120 });
  s.state.patterns[0].tracks[0] = { ...emptyTrack(0, [0], 60) }; s.state.patterns[0].tracks[0].steps[0].on = true; s.setState(s.state);
  s.play(); run(s, 0.05);
  assert.deepEqual(gated(s.slots[0]), [67], "sequenced notes are transposed too");
}

// Polyphonic portamento (Prophet-5, OB-Xa): each voice glides from its last note.
{
  const e = rack([["studio-poly", { glide: 0.3 }]]);
  e.noteOn(0, 48, 0.8); e.noteOff(0, 48); run(e, 0.01); e.noteOn(0, 60, 0.8);
  const v = e.slots[0].voices.find((x) => x.gateOn);
  assert.ok(v.pitch < 60 && v.target === 60, "the new note starts from the voice's previous pitch");
}
// Performances: every part names a real machine and preset, and the result is a valid session.
for (const perf of PERFORMANCES) {
  for (const part of perf.parts) assert.ok(machineById(part.machine)?.presets.some((p) => p.name === part.preset), `${perf.name}: ${part.machine} / ${part.preset}`);
  const st = demoState(); st.slots = performanceSlots(perf.name);
  assert.deepEqual(sanitizeState(st).slots, st.slots, `${perf.name} survives validation`);
}
console.log("multitimbral, voice mode and arpeggiator tests passed");
