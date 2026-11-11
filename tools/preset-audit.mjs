// Radix-2 FFT, in place.
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k], xr = re[i + k + len / 2], xi = im[i + k + len / 2];
        const vr = xr * cr - xi * ci, vi = xr * ci + xi * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
export function spectralCentroid(x, rate, N = 2048) {
  let num = 0, den = 0;
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let f = 0; f + N <= x.length; f += N) {
    for (let i = 0; i < N; i++) { re[i] = x[f + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N)); im[i] = 0; }
    fft(re, im);
    for (let k = 1; k < N / 2; k++) { const m = Math.hypot(re[k], im[k]); num += m * (k * rate) / N; den += m; }
  }
  return den ? num / den : 0;
}
// Loudness each role is calibrated to (LUFS at slot level 0 dB, no effects).
export const ROLE_TARGETS = { bass: -14, lead: -14, pad: -15, strings: -15, brass: -14, keys: -15, organ: -15, pluck: -16, bell: -17, fx: -16, kit: -12 };
// The highest peak calibration lets a preset reach (at slot level 0 dB).
export const PEAK_CAP = 1.5;
// Plays every preset the way it would be used and measures it: loudness,
// peak, DC, sustain, brightness (spectral centroid), and how far it is from
// the machine's other presets. Prints a table; tests/presets.test.mjs uses
// the same measurements with limits.
export async function auditPresets({ rate = 44100, trims = true, only } = {}) {
  globalThis.STRICT_PARAMS = true;
  const { MACHINES } = await import("../src/machines/index.ts");
  const { Engine, BLOCK } = await import("../src/engine/engine.ts");
  const { demoState, slotState } = await import("../src/engine/state.ts");
  const { measureLoudness } = await import("../src/core/index.ts");
  const roleOf = (m, p) => p.role ?? (m.kind === "drum" ? "kit" : "lead");
  const { PHRASES } = await import("../src/engine/audition.ts");
  const rows = [];
  for (const m of MACHINES) {
    if (only && !only.includes(m.id)) continue;
    for (const [pi, pr] of m.presets.entries()) {
      const role = roleOf(m, pr), ph = PHRASES[role] ?? PHRASES.lead;
      const s = demoState(); s.cables = []; s.slots = s.slots.map(() => slotState(""));
      s.slots[0] = slotState(m.id, pi); Object.assign(s.slots[0].params, { level: 0, reverb: 0, delay: 0 }, trims ? {} : { patchLevel: 0 });
      s.fx.limit = 0; s.fx.drive = 0; s.fx.master = 0;
      const e = new Engine(rate, s);
      const total = Math.ceil((ph.notes.length * ph.gap + 1.5) * rate), L = new Float32Array(total), R = new Float32Array(total);
      const events = [];
      ph.notes.forEach((ns, k) => { events.push([Math.round(k * ph.gap * rate), ns, true]); events.push([Math.round((k * ph.gap + ph.len) * rate), ns, false]); });
      events.sort((a, b) => a[0] - b[0]);
      let at = 0, ev = 0;
      while (at < total) {
        while (ev < events.length && events[ev][0] <= at) { const [, ns, on] = events[ev++]; for (const n of ns) on ? e.noteOn(0, n, 0.85) : e.noteOff(0, n); }
        const n = Math.min(BLOCK, total - at); e.process(L.subarray(at, at + n), R.subarray(at, at + n), n); at += n;
      }
      const lu = measureLoudness([L, R], rate);
      let peak = 0, sum = 0; for (const x of L) { peak = Math.max(peak, Math.abs(x)); sum += x; }
      const dc = Math.abs(sum / L.length);
      // Sustain: RMS over the last second of the first held note (0.4 s for short notes), against the loudest 50 ms.
      const rms = (a, b) => { let s2 = 0; for (let i = a; i < b; i++) s2 += L[i] * L[i]; return Math.sqrt(s2 / Math.max(1, b - a)); };
      let maxWin = 0; const w = Math.round(0.05 * rate);
      for (let i = 0; i + w < Math.round(ph.len * rate); i += w) maxWin = Math.max(maxWin, rms(i, i + w));
      const holdEnd = Math.round(ph.len * rate), sustain = maxWin ? rms(Math.max(0, holdEnd - Math.round((ph.len > 1.5 ? 1 : 0.4) * rate)), holdEnd) / maxWin : 0;
      // Brightness: spectral centroid, averaged over 2048-point Hann frames.
      const centroid = spectralCentroid(L, rate);
      rows.push({ machine: m.name, id: m.id, preset: pr.name, role, lufs: lu.integratedLufs, peak, dc, sustain, centroid });
    }
  }
  // Loudness relative to each machine's median.
  for (const id of new Set(rows.map((r) => r.id))) {
    const own = rows.filter((r) => r.id === id), med = own.map((r) => r.lufs ?? -99).sort((a, b) => a - b)[Math.floor(own.length / 2)];
    for (const r of own) r.rel = (r.lufs ?? -99) - med;
  }
  return rows;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = await auditPresets();
  for (const r of rows) console.log(`${r.machine.padEnd(18)} ${r.preset.padEnd(24)} ${r.role.padEnd(6)} ${String(r.lufs).padStart(6)} LUFS (${r.rel >= 0 ? "+" : ""}${r.rel.toFixed(1)}) peak ${r.peak.toFixed(2)} sus ${r.sustain.toFixed(2)} cent ${Math.round(r.centroid)} dc ${r.dc.toFixed(4)}`);
}
