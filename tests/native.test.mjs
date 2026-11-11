// The C++ audio core (native/, run as WebAssembly) must sound exactly like
// the TypeScript engine it replaces. Every MiniMood preset plays the same
// phrase through both, with glide, legato, bend and the mod wheel, and every
// sample must match.
import assert from "node:assert/strict";
import { finite, peak } from "./helpers.mjs";
const { Engine, BLOCK } = await import("../src/engine/engine.ts");
const { demoState, slotState } = await import("../src/engine/state.ts");
const { setNativeEnabled, nativeAvailable, NativeMiniMood } = await import("../src/engine/native.ts");
const { MoogVoice, minimoog } = await import("../src/machines/minimoog.ts");

assert.ok(nativeAvailable(), "the WebAssembly build loads");
const rate = 48000;
function render(native, preset, extra = {}) {
  setNativeEnabled(native);
  const s = demoState(); s.cables = []; s.slots = s.slots.map(() => slotState(""));
  s.slots[0] = slotState("ladder-mono", preset); Object.assign(s.slots[0].params, { reverb: 0, delay: 0, level: 0 }, extra);
  s.fx.limit = 0; s.fx.drive = 0;
  const e = new Engine(rate, s);
  const v = e.slots[0].voices[0];
  assert.ok(native ? v instanceof NativeMiniMood : v instanceof MoogVoice, `${native ? "native" : "TypeScript"} voice in use`);
  const L = new Float32Array(rate * 1.6), R = new Float32Array(rate * 1.6);
  const run = (from, to) => { for (let i = from; i < to; i += BLOCK) e.process(L.subarray(i, i + BLOCK), R.subarray(i, i + BLOCK), Math.min(BLOCK, to - i)); };
  // A phrase: a note, a legato note above (low-note priority keeps the first), a lower legato note,
  // pitch bend and mod wheel moves, releases, and a fresh note.
  e.noteOn(0, 48, 0.9); run(0, 9600);
  e.noteOn(0, 55, 0.7); run(9600, 14400);
  e.noteOn(0, 43, 0.8); e.ctx.bend = 1.5; e.wheel = 0.6; run(14400, 24000);
  e.noteOff(0, 43); e.ctx.bend = 0; run(24000, 33600);
  e.noteOff(0, 48); e.noteOff(0, 55); e.wheel = 0; run(33600, 48000);
  e.noteOn(0, 60, 1); run(48000, 62400);
  e.noteOff(0, 60); run(62400, L.length);
  return L;
}
let worst = 0;
for (const [i, pr] of minimoog.presets.entries()) {
  const a = render(false, i), b = render(true, i);
  let diff = 0; for (let k = 0; k < a.length; k++) diff = Math.max(diff, Math.abs(a[k] - b[k]));
  worst = Math.max(worst, diff);
  assert.ok(finite(b) && peak(b) > 0.01, `${pr.name}: the native voice makes sound`);
  assert.equal(diff, 0, `${pr.name}: native and TypeScript differ by ${diff}`);
}
// The same with glide on, the feedback path and every switch flipped.
const every = { glideOn: 1, glide: 0.2, extOn: 1, noiseOn: 1, noiseColor: 1, oscMod: 1, filterMod: 1, osc3Kbd: 0, kbd2: 1, decaySw: 0, drift: 1, tune: 0.7 };
const a = render(false, 0, every), b = render(true, 0, every);
for (let k = 0; k < a.length; k++) assert.equal(a[k], b[k], `every switch: sample ${k} differs`);

// Speed: the same 16 seconds of audio through each engine.
const time = (native) => { const t0 = performance.now(); for (let k = 0; k < 10; k++) render(native, 1); return performance.now() - t0; };
time(true); time(false);
const tTs = time(false), tWasm = time(true);
setNativeEnabled(true);
console.log(`native engine tests passed (${minimoog.presets.length} presets + every switch, bit-identical; MiniMood render ${tTs.toFixed(0)} ms in TypeScript, ${tWasm.toFixed(0)} ms in C++/WebAssembly)`);
