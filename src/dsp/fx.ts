// Effects: the machine-specific ones (the Juno's BBD chorus, the string
// machine's ensemble) and the shared rack (delay, reverb, drive, limiter).
import { clamp, dbToGain, flush, tanh, TAU } from "./util.ts";
import { OnePole } from "./filters.ts";

export class DelayLine {
  buf: Float32Array; mask: number; w = 0;
  constructor(maxSamples: number) {
    let n = 1; while (n < maxSamples + 4) n <<= 1;
    this.buf = new Float32Array(n); this.mask = n - 1;
  }
  write(x: number) { this.buf[this.w] = x; this.w = (this.w + 1) & this.mask; }
  // Reads `delay` samples back (fractional), with cubic interpolation.
  read(delay: number) {
    const d = clamp(delay, 1, this.mask - 3);
    const di = Math.floor(d), f = d - di;
    const i = (this.w - di + this.mask + 1) & this.mask;
    const y0 = this.buf[(i + 1) & this.mask], y1 = this.buf[i], y2 = this.buf[(i - 1) & this.mask], y3 = this.buf[(i - 2) & this.mask];
    const c1 = 0.5 * (y2 - y0), c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3, c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
    return ((c3 * f + c2) * f + c1) * f + y1;
  }
  clear() { this.buf.fill(0); }
}

// The Juno-60's stereo BBD chorus. Modes I and II are slow triangle sweeps of
// different speeds; I+II is a fast, shallow vibrato. The bucket-brigade delay
// is band-limited, so the wet signal is darker than the dry.
const JUNO_MODES = [null, { hz: 0.513, min: 1.66, max: 5.35 }, { hz: 0.863, min: 1.66, max: 5.35 }, { hz: 9.75, min: 3.3, max: 3.7 }];
export class JunoChorus {
  l: DelayLine; r: DelayLine; phase = 0; lpL = new OnePole(); lpR = new OnePole();
  readonly rate: number;
  constructor(rate: number) { this.rate = rate; this.l = new DelayLine(rate * 0.01); this.r = new DelayLine(rate * 0.01); this.lpL.set(7500, rate); this.lpR.set(7500, rate); }
  process(L: Float32Array, R: Float32Array, n: number, mode: number) {
    const m = JUNO_MODES[mode | 0];
    if (!m) return;
    const ms = this.rate / 1000;
    for (let i = 0; i < n; i++) {
      this.phase += m.hz / this.rate; if (this.phase >= 1) this.phase -= 1;
      const tri = 1 - 4 * Math.abs(this.phase - 0.5);
      const mid = (m.min + m.max) / 2, span = (m.max - m.min) / 2;
      const inp = 0.5 * (L[i] + R[i]);
      this.l.write(inp); this.r.write(inp);
      const wl = this.lpL.lp(this.l.read((mid + span * tri) * ms));
      const wr = this.lpR.lp(this.r.read((mid - span * tri) * ms));
      L[i] = L[i] * 0.7 + wl * 0.7; R[i] = R[i] * 0.7 + wr * 0.7;
    }
  }
}

// The string-machine ensemble: three delay lines, each swept by a slow and a
// fast LFO 120 degrees apart, give the thick "many players" sound.
export class Ensemble {
  d: DelayLine; ph1 = 0; ph2 = 0;
  readonly rate: number;
  constructor(rate: number) { this.rate = rate; this.d = new DelayLine(rate * 0.03); }
  process(L: Float32Array, R: Float32Array, n: number, depth: number) {
    if (depth <= 0) return;
    const ms = this.rate / 1000;
    for (let i = 0; i < n; i++) {
      this.ph1 += 0.6 / this.rate; this.ph2 += 6 / this.rate;
      if (this.ph1 >= 1) this.ph1 -= 1; if (this.ph2 >= 1) this.ph2 -= 1;
      const inp = 0.5 * (L[i] + R[i]);
      this.d.write(inp);
      let a = 0, b = 0;
      for (let k = 0; k < 3; k++) {
        const o = k / 3;
        const mod = 0.75 * Math.sin(TAU * (this.ph1 + o)) + 0.25 * Math.sin(TAU * (this.ph2 + o));
        const tap = this.d.read((8 + depth * 4.5 * mod) * ms);
        if (k === 0) a += tap; else if (k === 1) b += tap; else { a += tap * 0.5; b += tap * 0.5; }
      }
      L[i] = L[i] * (1 - depth * 0.6) + a * 0.55 * depth; R[i] = R[i] * (1 - depth * 0.6) + b * 0.55 * depth;
    }
  }
}

// Stereo tempo-synced delay with a darkening feedback path and optional ping-pong.
export class StereoDelay {
  l: DelayLine; r: DelayLine; lpL = new OnePole(); lpR = new OnePole(); time = 0;
  readonly rate: number;
  constructor(rate: number) { this.rate = rate; this.l = new DelayLine(rate * 2.1); this.r = new DelayLine(rate * 2.1); }
  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number, seconds: number, feedback: number, tone: number, pingpong: boolean) {
    const target = clamp(seconds, 0.01, 2) * this.rate;
    if (this.time === 0) this.time = target;
    const toneHz = 600 + tone * tone * 15000;
    this.lpL.set(toneHz, this.rate); this.lpR.set(toneHz, this.rate);
    const fb = clamp(feedback, 0, 0.95);
    for (let i = 0; i < n; i++) {
      this.time += (target - this.time) * 0.0005; // glide on time changes, like tape
      const dl = this.lpL.lp(this.l.read(this.time)), dr = this.lpR.lp(this.r.read(this.time));
      if (pingpong) { this.l.write(flush(0.5 * (inL[i] + inR[i]) + dr * fb)); this.r.write(flush(dl * fb)); }
      else { this.l.write(flush(inL[i] + dl * fb)); this.r.write(flush(inR[i] + dr * fb)); }
      outL[i] += dl; outR[i] += dr;
    }
  }
}

// An 8-line feedback delay network reverb (Householder mixing), with damping.
const FDN_MS = [29.7, 37.1, 41.1, 43.7, 53.3, 59.9, 67.1, 73.3];
export class Reverb {
  lines: DelayLine[]; lps: OnePole[]; lens: number[]; pre: DelayLine; ph = 0;
  readonly rate: number;
  constructor(rate: number) { this.rate = rate;
    this.lens = FDN_MS.map((ms) => (ms * rate) / 1000);
    this.lines = this.lens.map((l) => new DelayLine(l * 2.2));
    this.lps = this.lens.map(() => new OnePole());
    this.pre = new DelayLine(rate * 0.1);
  }
  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number, size: number, damp: number) {
    const scale = 0.5 + size * 1.5;
    const rt60 = 0.4 + size * size * 9; // seconds
    const dampHz = 1500 + (1 - damp) * 14000;
    for (const lp of this.lps) lp.set(dampHz, this.rate);
    const gains = this.lens.map((l) => 10 ** ((-3 * l * scale) / (rt60 * this.rate)));
    const y = new Float64Array(8);
    for (let i = 0; i < n; i++) {
      this.ph += 0.37 / this.rate; if (this.ph >= 1) this.ph -= 1;
      this.pre.write(0.5 * (inL[i] + inR[i]));
      const x = this.pre.read(this.rate * 0.012);
      let sum = 0;
      for (let k = 0; k < 8; k++) {
        const wob = k < 2 ? Math.sin(TAU * (this.ph + k * 0.5)) * 6 : 0; // a little movement against metallic ringing
        y[k] = this.lps[k].lp(this.lines[k].read(this.lens[k] * scale + wob)) * gains[k];
        sum += y[k];
      }
      sum *= 2 / 8;
      for (let k = 0; k < 8; k++) this.lines[k].write(flush(y[k] - sum + (k & 1 ? x : -x) * 0.35));
      outL[i] += (y[0] + y[2] + y[4] + y[6]) * 0.5;
      outR[i] += (y[1] + y[3] + y[5] + y[7]) * 0.5;
    }
  }
}

// Master bus: tape-like drive, then a peak limiter with a short look-ahead so
// the output stays under the ceiling. It limits sample peaks; inter-sample
// (true) peaks can still pass slightly over, which the export check reports.
export class Master {
  la: DelayLine[]; env = 1; look: number;
  readonly rate: number;
  constructor(rate: number) { this.rate = rate; this.look = Math.round(rate * 0.0015); this.la = [new DelayLine(this.look + 8), new DelayLine(this.look + 8)]; }
  process(L: Float32Array, R: Float32Array, n: number, driveAmt: number, levelDb: number, limit: boolean, ceilingDb = -1) {
    const g = dbToGain(levelDb), ceil = dbToGain(ceilingDb), dg = 1 + driveAmt * 6;
    const rel = 1 - Math.exp(-1 / (0.12 * this.rate)), att = 1 - Math.exp(-1 / (this.look * 0.5 + 1));
    for (let i = 0; i < n; i++) {
      let l = L[i] * g, r = R[i] * g;
      if (driveAmt > 0) { l = (tanh(l * dg) / dg) * (1 + driveAmt) ; r = (tanh(r * dg) / dg) * (1 + driveAmt); }
      if (!limit) { L[i] = l; R[i] = r; continue; }
      const peak = Math.max(Math.abs(l), Math.abs(r));
      const want = peak > ceil ? ceil / peak : 1;
      this.env += (want - this.env) * (want < this.env ? att : rel);
      this.la[0].write(l); this.la[1].write(r);
      const dl = this.la[0].read(this.look), dr = this.la[1].read(this.look);
      L[i] = clamp(dl * this.env, -ceil, ceil); R[i] = clamp(dr * this.env, -ceil, ceil);
    }
  }
}
