// What every voice shares (pitch, glide, analog drift), ported from the
// Voice base class in src/engine/machine.ts.
#pragma once
#include "dsp.h"

namespace soundlab {

struct VoiceCtx { double rate, bend, wheel, bpm, press; };

struct VoiceBase {
  int note = -1;
  double vel = 0, pitch = 60, target = 60, detune = 0;
  bool accent = false, gateOn = false;
  double rate;
  Drift drift;
  VoiceBase(double r, int seed) : rate(r), drift(static_cast<uint32_t>(seed * 7919 + 13)) {}
  // Sets pitch and gate; the machine then (re)triggers its envelopes.
  void begin(int n, double v, bool acc, bool glide) {
    if (!glide || note < 0) pitch = n;
    target = n; note = n; vel = v; accent = acc; gateOn = true;
  }
  void glideStep(double seconds) {
    if (pitch != target) {
      const double c = seconds <= 0.001 ? 1 : 1 - m::exp(-4 / (seconds * rate));
      pitch += (target - pitch) * c;
      if (m::fabs(target - pitch) < 1e-3) pitch = target;
    }
  }
  double hz(const VoiceCtx& ctx, double semis = 0) const { return mtof(pitch + detune + ctx.bend + semis); }
  double wander(double cents) { return cents != 0 ? (drift.next(rate) * cents) / 100 : 0; }
};

} // namespace soundlab
