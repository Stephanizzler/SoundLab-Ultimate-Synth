// Checks the natively compiled C++ (native/build/soundlab_render, built with
// CMake) against the TypeScript MiniMood voice, and times both.
// Run with: npm run native:check
import { execFileSync } from "node:child_process";
const { MoogVoice, minimoog } = await import("../src/machines/minimoog.ts");
const { slotParamDefs, slotState } = await import("../src/engine/state.ts");
const bin = new URL("../native/build/soundlab_render", import.meta.url).pathname;
const rate = 48000, seconds = 1.5, ctx = { rate, bend: 0, wheel: 0, bpm: 120, press: 0 };
const defs = slotParamDefs("ladder-mono").slice(0, minimoog.params.length);
let worstAll = 0;
for (const [i, pr] of minimoog.presets.entries()) {
  const params = defs.map((d) => slotState("ladder-mono", i).params[d.id]);
  const total = Math.floor(rate * seconds), hold = Math.floor(rate * seconds * 0.7), ts = new Float32Array(total);
  const v = new MoogVoice(rate, 0), p = Float64Array.from(params);
  v.start(48, 0.9, false, false, false);
  for (let at = 0; at < total; at += 32) { if (at >= hold && v.gateOn) v.stop(); v.render(ts.subarray(at, at + 32), Math.min(32, total - at), p, ctx); }
  const buf = execFileSync(bin, [String(rate), String(seconds), ...params.map(String)], { maxBuffer: 1 << 26 });
  const nat = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  let worst = 0, peak = 0;
  for (let k = 0; k < total; k++) { worst = Math.max(worst, Math.abs(ts[k] - nat[k])); peak = Math.max(peak, Math.abs(ts[k])); }
  worstAll = Math.max(worstAll, worst / (peak || 1));
  console.log(`${pr.name.padEnd(20)} max difference ${worst.toExponential(2)} (peak ${peak.toFixed(3)})`);
}
const params = defs.map((d) => slotState("ladder-mono", 0).params[d.id]);
console.log("native:", execFileSync(bin, ["--bench", String(rate), ...params.map(String)]).toString().trim());
const v = new MoogVoice(rate, 0), p = Float64Array.from(params), out = new Float32Array(32);
v.start(48, 0.9, false, false, false);
const t0 = performance.now(); for (let at = 0; at < rate * 10; at += 32) { out.fill(0); v.render(out, 32, p, ctx); }
const ms = performance.now() - t0;
console.log(`TypeScript: ${(10000 / ms).toFixed(1)}x real time (${ms.toFixed(1)} ms for 10 s, one voice)`);
if (worstAll > 1e-4) { console.error("Native output differs from TypeScript by more than 1e-4 of peak."); process.exit(1); }
console.log("native check passed");
