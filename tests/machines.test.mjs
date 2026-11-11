import assert from "node:assert/strict";
import { peak, rms, finite, pitchOf } from "./helpers.mjs";
const { MACHINES } = await import("../src/machines/index.ts");
const { Engine } = await import("../src/engine/engine.ts");
const { demoState, slotState, slotParamDefs, defaultsFor } = await import("../src/engine/state.ts");
const { Rng } = await import("../src/dsp/util.ts");

// One machine alone in slot 1, effects and limiter off, so we hear only it.
function solo(machine, params = {}, rate = 48000) {
  const s = demoState(); s.cables = []; s.slots = s.slots.map(() => slotState(""));
  s.slots[0] = slotState(machine); Object.assign(s.slots[0].params, { level: 0, reverb: 0, delay: 0 }, params);
  s.fx.limit = 0; s.fx.drive = 0; s.fx.master = 0;
  return new Engine(rate, s);
}
function play(e, notes, holdSec, releaseSec, vel = 0.8) {
  const r = e.rate, a = Math.round(holdSec * r), b = Math.round(releaseSec * r);
  const L = new Float32Array(a + b), R = new Float32Array(a + b);
  notes.forEach((n) => e.noteOn(0, n, vel));
  e.process(L.subarray(0, a), R.subarray(0, a), a);
  notes.forEach((n) => e.noteOff(0, n));
  e.process(L.subarray(a), R.subarray(a), b);
  return { L, R };
}
const testNote = (m) => (m.kind === "drum" ? m.drums.map((d) => d.note) : [57]);

assert.equal(MACHINES.length, 16);
assert.equal(new Set(MACHINES.map((m) => m.id)).size, 16, "machine ids are unique");
for (const m of MACHINES) {
  assert.ok(m.presets.length >= 3, `${m.name} has presets`);
  for (const pr of m.presets) for (const k of Object.keys(pr.values)) assert.ok(slotParamDefs(m.id).some((d) => d.id === k), `${m.name} preset ${pr.name} sets unknown ${k}`);
  for (const d of m.params) assert.ok(d.def >= d.min && d.def <= d.max && (!d.options || d.options.length === d.max - d.min + 1), `${m.name} ${d.id} range`);
  for (const d of m.params) assert.ok(d.group && !["Slot output", "Part"].includes(d.group), `${m.name} ${d.id} sits in its own panel section`);

  // Every preset plays, is finite and sensibly loud, at 44.1, 48 and 96 kHz.
  for (const [pi, pr] of m.presets.entries()) {
    const rate = [44100, 48000, 96000][pi % 3];
    for (const notes of m.kind === "drum" ? testNote(m).map((n) => [n]) : [testNote(m)]) {
      const { L } = play(solo(m.id, pr.values, rate), notes, 0.6, 0.2);
      const what = `${m.name} / ${pr.name}${m.kind === "drum" ? ` / note ${notes[0]}` : ""}`;
      assert.ok(finite(L), `${what} is finite`);
      assert.ok(peak(L) > 0.01, `${what} makes sound (${peak(L)})`);
      assert.ok(peak(L) < 2, `${what} is not excessively loud (${peak(L).toFixed(2)})`);
    }
  }

  // Voices finish after release, so polyphony is freed.
  const e = solo(m.id);
  play(e, testNote(m), 0.3, 12);
  assert.ok(e.slots[0].voices.every((v) => !v.active), `${m.name} voices end after release`);

  // In tune: the fundamental is A at some octave (oscillator ranges differ), within 1.5%.
  if (m.kind !== "drum" && m.id !== "west-coast") {
    const rate = 48000;
    const tuned = { "ladder-mono": { w1: 2, w2: 2, w3: 2, f2: 0, f3: 0, r3: 2, drift: 0, cutoff: 8000, emph: 0 }, "studio-poly": { vintage: 0, bFine: 0 }, "multimode-poly": { drift: 0, detune: 0 }, "flagship-poly": { drift: 0, t2: 0 }, "scream-mono": { t2: 0, w1: 1, w2: 0, s2: 1 }, "expressive-poly": { detune: 0, subVco: 0 }, "wave-scanner": { bDetune: 0 }, "fm-six": { o1Det: 0, o1L2: 99, o1L3: 99, o2Lvl: 0, o3Lvl: 0, o4Lvl: 0, o5Lvl: 0, o6Lvl: 0, alg: 31 }, "super-va": { hsSpread: 0, o2Detune: 0 } }[m.id] ?? {};
    const { L } = play(solo(m.id, tuned, rate), [57], 0.5, 0.05);
    const hz = pitchOf(L, rate, rate * 0.25, 4000, 50, 1800);
    const oct = Math.log2(hz / 220);
    assert.ok(Math.abs(oct - Math.round(oct)) < 0.022, `${m.name} plays A (got ${hz.toFixed(1)} Hz)`);
  }

  // Every knob at its minimum, at its maximum and at random: nothing blows up.
  const defs = slotParamDefs(m.id).filter((d) => !["level", "pan", "delay", "reverb"].includes(d.id));
  const rng = new Rng(7);
  const sets = [Object.fromEntries(defs.map((d) => [d.id, d.min])), Object.fromEntries(defs.map((d) => [d.id, d.max])),
    ...[1, 2, 3].map(() => Object.fromEntries(defs.map((d) => [d.id, d.min + (d.max - d.min) * rng.next()])))];
  for (const [k, vals] of sets.entries()) {
    const { L } = play(solo(m.id, vals), m.kind === "drum" ? testNote(m) : [33, 69, 100], 0.4, 0.1, 1);
    assert.ok(finite(L), `${m.name} extreme set ${k} is finite`);
    assert.ok(peak(L) < 8, `${m.name} extreme set ${k} is bounded (${peak(L).toFixed(2)})`);
  }
}

// Polyphony: a poly machine plays a chord; voice stealing never drops the newest note.
{
  const e = solo("studio-poly");
  for (let n = 40; n < 60; n++) e.noteOn(0, n, 0.8);
  const notes = e.slots[0].voices.map((v) => v.note);
  assert.equal(e.slots[0].voices.length, 5, "the Prophet-5 has five voices");
  assert.ok(notes.includes(59) && notes.includes(55) && !notes.includes(54), "oldest notes are stolen first");
}
// Mono machines go back to the held note (last-note priority) and only the 303 slides on demand.
{
  const e = solo("ladder-mono"); const v = e.slots[0].voices[0];
  e.noteOn(0, 48, 0.8); e.noteOn(0, 55, 0.8); assert.equal(v.target, 48, "Minimoog: low-note priority keeps the lower key");
  e.noteOn(0, 43, 0.8); assert.equal(v.target, 43, "a lower key takes over");
  e.noteOff(0, 43); assert.equal(v.target, 48, "returns to the lowest held key"); assert.ok(v.gateOn);
  e.noteOff(0, 48); e.noteOff(0, 55); assert.ok(!v.gateOn);
  const j = solo("lead-va", { assign: 2 }); const jv = j.slots[0].voices[0];
  j.noteOn(0, 48, 0.8); j.noteOn(0, 55, 0.8); assert.equal(jv.target, 55, "last-note priority elsewhere");
  j.noteOff(0, 55); assert.equal(jv.target, 48, "returns to the held note");
  const a = solo("acid-bass"); const av = a.slots[0].voices[0];
  a.noteOn(0, 45, 0.8); const L = new Float32Array(480), R = new Float32Array(480); a.process(L, R, 480);
  av.fenv = 0.1; a.noteOn(0, 57, 0.8, { slide: true });
  assert.ok(av.fenv === 0.1 && av.pitch === 45 && av.target === 57, "a slid note glides and does not retrigger");
  a.noteOff(0, 45); a.noteOff(0, 57); a.noteOn(0, 50, 0.8);
  assert.ok(av.fenv === 1 && av.pitch === 50, "a normal note retriggers and jumps");
}
// Drum kits: the closed hat chokes the open hat.
{
  const e = solo("boom-kit"); e.noteOn(0, 46, 1);
  const L = new Float32Array(4800), R = new Float32Array(4800); e.process(L, R, 4800);
  e.noteOn(0, 42, 1); e.process(L, R, 4800);
  const oh = e.slots[0].voices.find((v) => v.kind === "oh");
  assert.ok(!oh || !oh.active || oh.choked, "open hat is choked");
}
console.log("machine tests passed");
