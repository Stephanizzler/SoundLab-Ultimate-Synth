import assert from "node:assert/strict";
import { finite, peak } from "./helpers.mjs";
const { Engine, BLOCK, renderOffline } = await import("../src/engine/engine.ts");
const { demoState, slotState, emptyTrack, sources, destinations } = await import("../src/engine/state.ts");

const rate = 48000;
// A session with one slot (a drum kit) and empty tracks, plus a log of every note.
function setup(bpm = 120) {
  const s = demoState(); s.bpm = bpm; s.swing = 0; s.cables = [];
  s.slots = s.slots.map(() => slotState("")); s.slots[0] = slotState("punch-kit"); s.slots[1] = slotState("acid-bass");
  s.patterns[0].tracks = s.patterns[0].tracks.map((_, i) => emptyTrack(i, [0], 36));
  return s;
}
function run(s, seconds, before) {
  const e = new Engine(rate, s), log = [];
  let frame = 0;
  for (const slot of e.slots) if (slot) {
    const on = slot.noteOn.bind(slot), off = slot.noteOff.bind(slot), i = e.slots.indexOf(slot);
    slot.noteOn = (n, v, f) => { log.push({ on: true, slot: i, note: n, vel: v, flags: f ?? {}, frame, beat: e.beat }); on(n, v, f); };
    slot.noteOff = (n) => { log.push({ on: false, slot: i, note: n, frame }); off(n); };
  }
  before?.(e);
  e.play();
  const L = new Float32Array(BLOCK), R = new Float32Array(BLOCK), n = Math.round(seconds * rate);
  for (; frame < n; frame += BLOCK) e.process(L, R, BLOCK);
  return { e, log, ons: log.filter((x) => x.on) };
}

// Steps land on the grid to within one block (0.67 ms at 48 kHz).
{
  const s = setup(120); [0, 4, 8, 12].forEach((k) => (s.patterns[0].tracks[0].steps[k].on = true));
  const { ons } = run(s, 1.99);
  assert.deepEqual(ons.map((x) => Math.round(x.frame / 24000)), [0, 1, 2, 3], "quarter notes at 120 BPM");
  for (const [k, x] of ons.entries()) assert.ok(Math.abs(x.frame - k * 24000) <= BLOCK, `step ${k} within a block`);
}
// Swing delays every second 16th; triplet and 1/32 divisions; polymeter; mute.
{
  const s = setup(120); s.swing = 0.25; s.patterns[0].tracks[0].steps.forEach((st) => (st.on = true));
  const { ons } = run(s, 0.5);
  const d = ons.slice(0, 4).map((x) => x.frame);
  assert.ok(Math.abs(d[1] - (6000 + 0.25 * 6000)) <= BLOCK && Math.abs(d[2] - 12000) <= BLOCK, "odd 16ths swing late, even ones stay");
  const t = setup(120); t.patterns[0].tracks[0].division = 2; t.patterns[0].tracks[0].steps.forEach((st) => (st.on = true));
  assert.equal(run(t, 0.99).ons.length, 6, "1/8 triplets: six per second at 120 BPM");
  const u = setup(120); const tr = u.patterns[0].tracks[0]; tr.length = 3; tr.steps[0].on = true;
  assert.equal(run(u, 1.99).ons.length, 6, "a 3-step track repeats every three 16ths");
  const v = setup(120); v.patterns[0].tracks[0].steps[0].on = true; v.patterns[0].tracks[0].mute = true;
  assert.equal(run(v, 1).ons.length, 0, "muted tracks are silent");
}
// Gate length, ratchets, chords, probability (repeatable), velocity and accent.
{
  const s = setup(120); const tr = s.patterns[0].tracks[0]; tr.targets = [1]; tr.note = 45;
  Object.assign(tr.steps[0], { on: true, note: 45, len: 2 });
  Object.assign(tr.steps[4], { on: true, note: 47, ratchet: 3 });
  Object.assign(tr.steps[8], { on: true, note: 48, chord: 4, accent: true, vel: 0.5 });
  const { log } = run(s, 1.2);
  const first = log.filter((x) => x.note === 45);
  assert.ok(Math.abs(first[1].frame - first[0].frame - 12000) <= BLOCK, "gate of 2 steps lasts two 16ths");
  assert.equal(log.filter((x) => x.on && x.note === 47).length, 3, "ratchet ×3");
  assert.deepEqual(log.filter((x) => x.on && x.frame >= 48000 - BLOCK && x.frame <= 48000 + BLOCK).map((x) => x.note), [48, 51, 55, 58], "minor 7 chord");
  assert.ok(log.find((x) => x.note === 48).flags.accent && log.find((x) => x.note === 48).vel === 0.5);
  const p = setup(120); p.patterns[0].tracks[0].steps.forEach((st) => Object.assign(st, { on: true, prob: 0.5 }));
  const a = run(p, 8).ons.length, b = run(p, 8).ons.length;
  assert.equal(a, b, "probability is repeatable between renders");
  assert.ok(a > 20 && a < 44, `about half the 64 steps play (${a})`);
}
// Slide: the step after a slid step arrives legato with the slide flag.
{
  const s = setup(120); const tr = s.patterns[0].tracks[0]; tr.targets = [1];
  Object.assign(tr.steps[0], { on: true, note: 45, slide: true }); Object.assign(tr.steps[1], { on: true, note: 57 }); Object.assign(tr.steps[2], { on: true, note: 50 });
  const { ons } = run(s, 0.4);
  assert.deepEqual(ons.slice(0, 3).map((x) => !!x.flags.slide), [false, true, false]);
}
// The patch bay: CV lanes, track envelopes and synced LFOs move any parameter.
{
  const s = setup(120); const tr = s.patterns[0].tracks[0];
  tr.steps[0].a = 1; tr.steps[8].a = 0;
  s.cables = [{ src: "t0.a", dst: "s1.cutoff", amt: 0.5 }, { src: "lfo0", dst: "fx.dFb", amt: 0.3 }, { src: "t0.env", dst: "s0.level", amt: -0.5 }, { src: "mac1", dst: "s1.res", amt: 1 }];
  s.mod.lfo0Shape = 0; s.mod.lfo0Sync = 3; // sine, 1 bar
  s.mod.mac1 = 0.25;
  tr.steps[4].on = true;
  const e = new Engine(rate, s); e.play();
  const L = new Float32Array(BLOCK), R = new Float32Array(BLOCK);
  const at = (sec) => { while (e.beat < sec * 2) e.process(L, R, BLOCK); };
  const cut = () => e.slots[1].eff[e.slots[1].index("cutoff")], base = e.slots[1].base[e.slots[1].index("cutoff")];
  at(0.2); assert.ok(cut() > base * 4, `CV A at 1 opens the cutoff (${cut().toFixed(0)} vs ${base})`);
  const fb = () => e.fxUnit.eff[e.fxUnit.index("dFb")];
  at(0.5 + 0.001); // beat 1 of a 1-bar sine: phase 0.25, the peak
  assert.ok(fb() > e.fxUnit.base[e.fxUnit.index("dFb")] + 0.3 * 0.95 * 0.9, `synced LFO at its peak (${fb()})`);
  at(1.2); assert.ok(Math.abs(cut() - base) < 1, "CV A at 0 leaves the knob position");
  { const ri = e.slots[1].index("res"); assert.ok(Math.abs(e.slots[1].eff[ri] - (e.slots[1].base[ri] + 0.25)) < 1e-9, "macro adds a quarter turn of resonance"); }
  const e2 = new Engine(rate, s); e2.play();
  while (e2.beat < 1.05) e2.process(L, R, BLOCK);
  const lv = e2.slots[0].eff[e2.slots[0].index("level")];
  assert.ok(lv < e2.slots[0].base[e2.slots[0].index("level")] - 10, "the track envelope ducks the level right after a hit");
  // Every listed source and destination can be patched without error.
  const all = setup(); all.slots[2] = slotState("fm-six");
  const srcs = sources(all), dsts = destinations(all);
  assert.ok(srcs.length === 8 * 7 + 11 + 3 && dsts.length > 80, `${srcs.length} sources (with an output follower per filled slot), ${dsts.length} destinations`);
  all.cables = srcs.map((x, i) => ({ src: x.id, dst: dsts[(i * 7) % dsts.length].id, amt: (i % 3) - 1 }));
  const r = renderOffline(all, rate, 1);
  assert.ok(finite(r.L) && peak(r.L) <= 1, "patched everywhere, still finite and limited");
}
// Patterns switch at the next bar; renders are deterministic.
{
  const s = setup(120); s.patterns[0].tracks[0].steps[0].on = true;
  s.patterns[1].tracks[0] = emptyTrack(0, [0], 38); s.patterns[1].tracks[0].steps[0].on = true;
  const { log } = run(s, 4.1, (e) => { const orig = e.process.bind(e); let q = false; e.process = (L, R, n) => { if (!q && e.beat > 1) { e.queuePattern(1); q = true; } orig(L, R, n); }; });
  assert.deepEqual(log.filter((x) => x.on).map((x) => x.note), [36, 38, 38], "switch lands on the bar line");
  const d = demoState(), a = renderOffline(d, 44100, 1), b = renderOffline(d, 44100, 1);
  assert.ok(a.L.every((x, i) => x === b.L[i]), "the same session renders identically");
}
console.log("sequencer tests passed");
