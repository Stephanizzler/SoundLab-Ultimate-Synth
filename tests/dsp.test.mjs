import assert from "node:assert/strict";
import { peak, rms, finite, sine } from "./helpers.mjs";
const { Osc, SuperSaw } = await import("../src/dsp/osc.ts");
const { Cascade4, Svf, Korg35, LowPassGate, fold } = await import("../src/dsp/filters.ts");
const { Adsr, Lfo } = await import("../src/dsp/env.ts");
const { Master, Reverb, StereoDelay, JunoChorus } = await import("../src/dsp/fx.ts");
const { table, readTable, WAVETABLES } = await import("../src/dsp/wavetable.ts");
const { Rng } = await import("../src/dsp/util.ts");
const rate = 48000;

// Oscillators: right frequency, band-limited jumps, sync restarts the slave.
{
  const o = new Osc(); let cross = 0, prev = 0;
  for (let i = 0; i < rate; i++) { o.step(440, rate); const v = o.saw(); if (prev < 0 && v >= 0) cross++; prev = v; }
  assert.ok(Math.abs(cross - 440) <= 1, `saw at 440 Hz crossed ${cross} times`);
  const p = new Osc(); let mean = 0;
  for (let i = 0; i < rate; i++) { p.step(100, rate); mean += p.pulse(0.25); }
  assert.ok(Math.abs(mean / rate - -0.5) < 0.02, "25% pulse averages -0.5");
  const m = new Osc(), s = new Osc(); let resets = 0;
  for (let i = 0; i < rate; i++) { m.step(100, rate); s.step(370, rate); const before = s.phase; s.syncTo(m); if (m.wrapped && s.phase < before) resets++; }
  assert.ok(resets >= 95 && resets <= 100, `sync resets ${resets}`);
  const ss = new SuperSaw(new Rng(1)); const out = Float32Array.from({ length: rate / 4 }, () => ss.render(220, rate, 9, 0.5));
  assert.ok(finite(out) && peak(out) < 3 && rms(out) > 0.2, "supersaw is full and bounded");
}

// Gain of a filter at one frequency, measured with a sine after it settles.
function gain(make, hz, n = 24000, amp = 0.05) {
  const f = make(), x = sine(hz, rate, n, amp); let y = 0, s = 0;
  for (let i = 0; i < n; i++) { const v = f(x[i]); if (i > n / 2) { y += v * v; s += x[i] * x[i]; } }
  return Math.sqrt(y / s);
}
const db = (g) => 20 * Math.log10(g);

// The ladder is 24 dB/octave: three octaves above cutoff is at least 60 dB down.
{
  const ladder = (k) => () => { const f = new Cascade4("ladder"); f.set(500, rate); return (x) => f.process(x, k, 1); };
  assert.ok(Math.abs(db(gain(ladder(0), 60))) < 1, "ladder passes the bass");
  assert.ok(db(gain(ladder(0), 4000)) < -60, `ladder 3 octaves up: ${db(gain(ladder(0), 4000)).toFixed(1)} dB`);
  assert.ok(Math.abs(db(gain(ladder(0), 500)) + 12) < 1.5, "ladder is -12 dB at cutoff with no resonance (four poles)");
  assert.ok(gain(ladder(3.5), 500) > gain(ladder(0), 500) * 3, "resonance peaks at cutoff");
  // Near k = 4 it rings on its own at the cutoff frequency.
  const f = new Cascade4("ladder"); f.set(1000, rate); const y = new Float32Array(rate); let cross = 0;
  for (let i = 0; i < rate; i++) { y[i] = f.process(i === 0 ? 0.5 : 0, 4.2, 1); if (i > rate / 2 && y[i - 1] < 0 && y[i] >= 0) cross++; }
  assert.ok(finite(y) && peak(y) < 2, "self-oscillation stays bounded");
  assert.ok(Math.abs(cross * 2 - 1000) < 60, `self-oscillates near cutoff: ${cross * 2} Hz`);
  // 12 dB tap of the OTA cascade (Jupiter's 2-pole mode) falls slower than the 4-pole output.
  const g = new Cascade4("ota"); g.set(500, rate); const x = sine(4000, rate, 24000); let a = 0, b = 0;
  for (let i = 0; i < 24000; i++) { const y4 = g.process(x[i], 0, 1); if (i > 12000) { a += g.out[1] ** 2; b += y4 * y4; } }
  assert.ok(a > b * 100, "12 dB tap is brighter than 24 dB output");
  // The diode style stays stable with full resonance and loud input.
  const d = new Cascade4("diode"); d.set(300, rate); const z = sine(55, rate, rate, 1.5).map((v) => d.process(v, 4, 2));
  assert.ok(finite(z) && peak(z) < 3, "diode ladder is stable");
}

// State-variable filter: four responses at once, and the SEM-style morph.
{
  const svf = (out, res = 0) => () => { const f = new Svf(); f.set(1000, rate, res); return (x) => { f.process(x); return f[out]; }; };
  assert.ok(Math.abs(db(gain(svf("lp"), 100))) < 0.5 && db(gain(svf("lp"), 8000)) < -30, "SVF low-pass");
  assert.ok(Math.abs(db(gain(svf("hp"), 8000))) < 0.5 && db(gain(svf("hp"), 100)) < -30, "SVF high-pass");
  assert.ok(db(gain(svf("notch"), 1000)) < -25 && Math.abs(db(gain(svf("notch"), 100))) < 1, "SVF notch");
  assert.ok(gain(svf("bp", 0.9), 1000) > 4 * gain(svf("bp", 0.9), 250), "SVF band-pass peaks at cutoff");
  const m = (morph) => () => { const f = new Svf(); f.set(1000, rate, 0); return (x) => { f.process(x); return f.morph(morph); }; };
  assert.ok(gain(m(0), 100) > 0.9 && gain(m(1), 8000) > 0.9 && gain(m(0.5), 1000) < 0.1, "morph sweeps LP, notch, HP");
}

// Korg 35: low-pass and high-pass with positive feedback that screams but stays bounded.
{
  const k35 = (type, K = 0.5) => () => { const f = new Korg35(type); f.set(1000, rate, K); return (x) => f.process(x, 1); };
  assert.ok(gain(k35("lp"), 100) > 0.7 && db(gain(k35("lp"), 8000)) < -25, "K35 low-pass");
  assert.ok(gain(k35("hp"), 8000) > 0.7 && db(gain(k35("hp"), 100)) < -25, "K35 high-pass");
  assert.ok(gain(k35("lp", 1.9), 1000) > 2 * gain(k35("lp", 0.2), 1000), "K35 peak rises with K");
  const f = new Korg35("lp"); f.set(800, rate, 1.98); const y = sine(110, rate, rate, 1).map((v) => f.process(v, 3));
  assert.ok(finite(y) && peak(y) < 4, "K35 at full peak is bounded");
}

// Low-pass gate: opens fast, closes slowly; the folder adds harmonics but stays in range.
{
  const g = new LowPassGate(); let open = 0;
  for (let i = 0; i < 960; i++) open = g.process(1, 1, rate, 0.3, 2);
  assert.ok(open > 0.95, "vactrol opens within 20 ms");
  let after = 0; for (let i = 0; i < rate * 0.1; i++) after = g.process(1, 0, rate, 0.3, 2);
  assert.ok(after > 0.3 && after < 0.95, "and closes slowly");
  for (const a of [0, 0.5, 1]) for (const s of [-1, 0, 1]) { const v = Array.from({ length: 100 }, (_, i) => fold(Math.sin(i / 10), a, s)); assert.ok(v.every((x) => Math.abs(x) <= 1.0001)); }
}

// Envelope times and LFO shapes.
{
  const e = new Adsr(); e.set(0.01, 0.1, 0.5, 0.2); e.gate(true); let i = 0;
  while (e.stage === 1 && i < rate) { e.next(rate); i++; }
  assert.ok(Math.abs(i / rate - 0.01) < 0.004, `attack took ${(i / rate * 1000).toFixed(1)} ms`);
  for (let k = 0; k < rate; k++) e.next(rate);
  assert.ok(Math.abs(e.v - 0.5) < 1e-3, "settles at sustain");
  e.gate(false); i = 0; while (e.active && i < rate * 2) { e.next(rate); i++; }
  // Release time is to -60 dB from full level; from sustain 0.5 to the 1e-4 floor takes proportionally longer.
  assert.ok(Math.abs(i / rate - (0.2 * Math.log(0.5 / 1e-4)) / 6.9) < 0.01, `release took ${(i / rate).toFixed(3)} s`);
  const l = new Lfo(); assert.ok(Math.abs(l.setPhase(0.25, 0) - 1) < 1e-9 && Math.abs(l.setPhase(1.75, 0) + 1) < 1e-9, "synced LFO follows phase");
}

// Wavetables: every table is normalised and the octave copies stay below Nyquist.
for (let b = 0; b < WAVETABLES.length; b++) {
  const t = table(b);
  for (const f of [0, 0.5, 1]) { const v = Array.from({ length: 1024 }, (_, i) => readTable(t, f, i / 1024, 0.0001)); assert.ok(finite(v) && peak(v) <= 1.05 && peak(v) > 0.3, `${WAVETABLES[b]} frame ${f}`); }
  // At 5 kHz (dt ~0.104) only 4 harmonics fit; the chosen copy must have no more.
  const dt = 5000 / rate, x = Float32Array.from({ length: rate / 10 }, (_, i) => readTable(t, 0.5, (i * dt) % 1, dt));
  assert.ok(finite(x), "high notes read fine");
}

// Effects: limiter never passes the ceiling, delay and reverb decay away.
{
  const m = new Master(rate), L = sine(100, rate, rate, 3), R = sine(150, rate, rate, 3);
  m.process(L, R, rate, 0, 0, true, -1);
  assert.ok(peak(L) <= 10 ** (-1 / 20) + 1e-6 && peak(R) <= 10 ** (-1 / 20) + 1e-6, "limiter holds -1 dBFS");
  const rv = new Reverb(rate), d = new StereoDelay(rate), n = rate * 6;
  const inL = new Float32Array(n), inR = new Float32Array(n); inL[0] = inR[0] = 1;
  const oL = new Float32Array(n), oR = new Float32Array(n);
  for (let at = 0; at < n; at += 128) { rv.process(inL.subarray(at, at + 128), inR.subarray(at, at + 128), oL.subarray(at, at + 128), oR.subarray(at, at + 128), 128, 0.5, 0.5); d.process(inL.subarray(at, at + 128), inR.subarray(at, at + 128), oL.subarray(at, at + 128), oR.subarray(at, at + 128), 128, 0.3, 0.6, 0.5, true); }
  assert.ok(finite(oL) && rms(oL, 0, rate) > 1e-3 && rms(oL, n - rate / 2) < rms(oL, 0, rate) / 100, "reverb and delay ring, then decay");
  const c = new JunoChorus(rate), a = sine(440, rate, rate), b = Float32Array.from(a); c.process(a, b, rate, 1);
  let diff = 0; for (let i = 0; i < rate; i++) diff += Math.abs(a[i] - b[i]);
  assert.ok(diff > 100 && finite(a), "chorus makes left and right differ");
}
console.log("dsp tests passed");
