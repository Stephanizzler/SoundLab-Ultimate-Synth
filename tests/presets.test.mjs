// Every preset is usable: it has a role, sounds, sits at its role's loudness
// (so switching presets doesn't jump in level), has no DC offset or runaway
// peaks, holds its notes when it is a sustained sound, and is distinct from
// the machine's other presets.
import assert from "node:assert/strict";
import { auditPresets, ROLE_TARGETS, PEAK_CAP } from "../tools/preset-audit.mjs";
const { MACHINES } = await import("../src/machines/index.ts");
const { PRESET_ROLES } = await import("../src/engine/machine.ts");
const { PRESET_TRIMS } = await import("../src/machines/preset-trims.ts");

for (const m of MACHINES) {
  assert.ok(m.presets.length >= (m.kind === "drum" ? 6 : 12), `${m.name} has ${m.presets.length} presets`);
  assert.equal(new Set(m.presets.map((p) => p.name)).size, m.presets.length, `${m.name} preset names are unique`);
  for (const p of m.presets) {
    assert.ok(PRESET_ROLES.includes(p.role), `${m.name} · ${p.name} has a role`);
    assert.ok(PRESET_TRIMS[m.id]?.[p.name] !== undefined, `${m.name} · ${p.name} is calibrated: run node tools/calibrate-presets.mjs ${m.id}`);
  }
  // Synths offer a range of sounds, not one kind.
  if (m.kind !== "drum" && m.id !== "acid-bass") assert.ok(new Set(m.presets.map((p) => p.role)).size >= 4, `${m.name} covers several roles`);
}

const rows = await auditPresets();
const fails = [];
const HELD = new Set(["pad", "strings", "organ", "brass", "lead"]);
for (const r of rows) {
  const name = `${r.machine} · ${r.preset}`;
  if (r.lufs == null) { fails.push(`${name}: silent`); continue; }
  const peakLimited = r.peak > PEAK_CAP * 0.9 && r.lufs < ROLE_TARGETS[r.role];
  if (Math.abs(r.lufs - ROLE_TARGETS[r.role]) > (peakLimited ? 6 : 1.5)) fails.push(`${name}: ${r.lufs} LUFS, ${r.role} target ${ROLE_TARGETS[r.role]} (recalibrate)`);
  if (r.peak > 2.5) fails.push(`${name}: peak ${r.peak.toFixed(2)}`);
  if (r.dc > 0.005) fails.push(`${name}: DC ${r.dc.toFixed(4)}`);
  if (HELD.has(r.role) && r.sustain < 0.3) fails.push(`${name}: a held ${r.role} that dies away (sustain ${r.sustain.toFixed(2)})`);
}
// Distinct: no two presets of a machine measure the same in brightness and sustain.
for (const id of new Set(rows.map((r) => r.id))) {
  const own = rows.filter((r) => r.id === id);
  for (let i = 0; i < own.length; i++) for (let j = i + 1; j < own.length; j++) {
    const a = own[i], b = own[j];
    if (a.role === "kit") continue;
    if (Math.abs(Math.log2(a.centroid / b.centroid)) < 0.03 && Math.abs(a.sustain - b.sustain) < 0.02 && a.role === b.role) fails.push(`${a.machine}: ${a.preset} and ${b.preset} sound alike`);
  }
}
assert.deepEqual(fails, [], fails.join("\n"));
console.log(`presets ok: ${rows.length} presets, every one within 1.5 dB of its role's loudness (or peak-limited)`);
