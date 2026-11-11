// The DSP building blocks, ported line by line from src/dsp/*.ts.
// Keep the two in step: the parity test (tests/native.test.mjs) renders the
// same notes through both and requires them to match.
// No allocation, no exceptions, no platform APIs: this runs on a real-time
// audio thread in plug-ins and in WebAssembly in the browser.
#pragma once
#include <stdint.h>
#include "math.h"

namespace soundlab {

// util.ts
inline double mtof(double note) { return 440 * m::pow(2, (note - 69) / 12); }
inline double tanhApprox(double x) { // the rational tanh used throughout
  if (x > 3) return 1;
  if (x < -3) return -1;
  const double x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}
inline double flush(double x) { return x > 1e-20 || x < -1e-20 ? x : 0; }
inline double blep(double t, double dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

// xorshift32, bit-for-bit the same as the TypeScript Rng.
struct Rng {
  uint32_t s;
  explicit Rng(uint32_t seed = 0x9e3779b9u) : s(seed ? seed : 1) {}
  double next() { uint32_t x = s; x ^= x << 13; x ^= x >> 17; x ^= x << 5; s = x; return s / 4294967296.0; }
  double bi() { return next() * 2 - 1; }
};

// osc.ts: one phase giving every classic wave.
struct Osc {
  double phase = 0, dt = 0, wrapFrac = 0, sub = 1;
  bool wrapped = false;
  explicit Osc(double ph = 0) : phase(ph) {}
  void step(double hz, double rate) {
    dt = m::min(0.45, m::fabs(hz) / rate);
    phase += dt;
    wrapped = false;
    if (phase >= 1) { phase -= 1; wrapped = true; wrapFrac = dt > 0 ? phase / dt : 0; sub = -sub; }
  }
  void syncTo(const Osc& master) { if (master.wrapped) phase = master.wrapFrac * dt; }
  double saw() const { return 2 * phase - 1 - blep(phase, dt); }
  double pulse(double width) const {
    const double w = width < 0.02 ? 0.02 : width > 0.98 ? 0.98 : width;
    double v = phase < w ? 1 : -1;
    v += blep(phase, dt);
    double t = phase - w; if (t < 0) t += 1;
    v -= blep(t, dt);
    return v;
  }
  double tri() const { return 1 - 4 * m::fabs(phase - 0.5); }
  double sine() const { return m::sin(m::TAU * phase); }
  double shark() const { return 0.5 * (tri() + saw()); }
};

struct Noise {
  Rng rng; double b0 = 0, b1 = 0, b2 = 0;
  explicit Noise(uint32_t seed = 1) : rng(seed) {}
  double white() { return rng.bi(); }
  double pink() {
    const double w = rng.bi();
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    return (b0 + b1 + b2 + w * 0.1848) * 0.25;
  }
};

struct Drift {
  double v = 0, target = 0, count = 0; Rng rng;
  explicit Drift(uint32_t seed) : rng(seed) {}
  double next(double rate) {
    if (--count <= 0) { target = rng.bi(); count = m::floor(rate * (0.2 + rng.next() * 0.6)); }
    v += (target - v) * (3 / rate);
    return v;
  }
};

// filters.ts
inline double prewarp(double hz, double rate) { return m::tan((m::PI * m::clamp(hz, 8, rate * 0.46)) / rate); }

// Four TPT one-poles in a loop: transistor ladder, OTA cascade, or diode ladder.
struct Cascade4 {
  enum Style { Ladder, Ota, Diode };
  Style style;
  double s[4] = {0, 0, 0, 0}, G[4] = {0, 0, 0, 0}, out[4] = {0, 0, 0, 0}, hpz = 0, hpG = 0;
  explicit Cascade4(Style st = Ladder) : style(st) {}
  void set(double hz, double rate) {
    static const double even[4] = {1, 1, 1, 1}, diode[4] = {1.9, 1.15, 0.9, 0.75};
    const double* mul = style == Diode ? diode : even;
    for (int i = 0; i < 4; i++) { const double g = prewarp(hz * mul[i], rate); G[i] = g / (1 + g); }
    if (style == Diode) { const double g = prewarp(70, rate); hpG = g / (1 + g); }
  }
  double process(double x, double k, double drive) {
    const double g0 = G[0], g1 = G[1], g2 = G[2], g3 = G[3];
    const double S = g1 * g2 * g3 * (1 - g0) * s[0] + g2 * g3 * (1 - g1) * s[1] + g3 * (1 - g2) * s[2] + (1 - g3) * s[3];
    const double gain = g0 * g1 * g2 * g3;
    double y4 = (gain * x + S) / (1 + k * gain);
    if (style == Diode) { const double v = (y4 - hpz) * hpG; const double lo = v + hpz; hpz = flush(lo + v); y4 = y4 - lo * 0.6; }
    double u;
    if (style == Ota) u = x - k * y4;
    else if (style == Diode) u = tanhApprox(drive * (x - k * y4) + 0.15) / drive - tanhApprox(0.15) / drive;
    else u = tanhApprox(drive * (x - k * y4)) / drive;
    for (int i = 0; i < 4; i++) {
      const double inp = style == Ota ? tanhApprox(u * 0.8 * drive) / (0.8 * drive) : u;
      const double v = (inp - s[i]) * G[i];
      const double y = v + s[i];
      s[i] = flush(y + v);
      out[i] = y;
      u = y;
    }
    return u;
  }
};

// env.ts: analog-style ADSR.
struct Adsr {
  double v = 0, a = 0.01, d = 0.2, s = 0.7, r = 0.3;
  int stage = 0; // idle, attack, decay, sustain, release
  void set(double a_, double d_, double s_, double r_) { a = a_; d = d_; s = s_; r = r_; }
  void gate(bool on, bool retrigger = true) {
    if (on) { if (retrigger || stage == 0 || stage == 4) stage = 1; }
    else if (stage != 0) stage = 4;
  }
  double next(double rate) {
    switch (stage) {
      case 1: {
        const double c = 1 - m::exp(-1.1 / m::max(1e-4, a * rate));
        v += (1.3 - v) * c;
        if (v >= 1) { v = 1; stage = 2; }
        break;
      }
      case 2:
        v += (s - v) * (1 - m::exp(-6.9 / m::max(1e-4, d * rate)));
        if (m::fabs(v - s) < 1e-4) { v = s; stage = 3; }
        break;
      case 3: v = s; break;
      case 4:
        v *= m::exp(-6.9 / m::max(1e-4, r * rate));
        if (v < 1e-4) { v = 0; stage = 0; }
        break;
    }
    return v;
  }
  bool active() const { return stage != 0; }
};

} // namespace soundlab
