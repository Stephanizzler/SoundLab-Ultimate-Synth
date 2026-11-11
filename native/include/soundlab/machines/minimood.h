// MiniMood Model Q: the C++ port of src/machines/minimoog.ts.
// Same oscillators, mixer, ladder filter and contours, in the same order,
// so it renders the same samples as the TypeScript voice.
#pragma once
#include "../voice.h"
#include "../../../generated/params.h"

namespace soundlab {

struct MiniMoodVoice : VoiceBase {
  Osc o[3] = {Osc(0), Osc(0.33), Osc(0.66)};
  Noise nz{3};
  Cascade4 f{Cascade4::Ladder};
  Adsr fe, ae;
  double last = 0;

  MiniMoodVoice(double r, int seed) : VoiceBase(r, seed) {}

  void start(int n, double v, bool acc, bool legato, bool glide) {
    begin(n, v, acc, glide);
    if (!legato) { fe.gate(true); ae.gate(true); } // single triggering, as on the original
  }
  void stop() { gateOn = false; fe.gate(false); ae.gate(false); }
  bool active() const { return ae.active(); }

  static double wave(const Osc& o, int w, bool three) {
    switch (w) {
      case 0: return o.tri();
      case 1: return three ? -o.saw() : o.shark();
      case 2: return o.saw();
      case 3: return o.pulse(0.5);
      case 4: return o.pulse(0.3);
      default: return o.pulse(0.12);
    }
  }

  // Adds n samples into out. p holds the slot's current parameter values.
  void render(float* out, int n, const double* p, const VoiceCtx& ctx) {
    namespace P = params::laddermono;
    static const double RANGE_SEMIS[6] = {-60, -24, -12, 0, 12, 24}; // LO, 32', 16', 8', 4', 2'
    const int w[3] = {int(m::jsround(p[P::w1])), int(m::jsround(p[P::w2])), int(m::jsround(p[P::w3]))};
    const double r[3] = {RANGE_SEMIS[int(m::jsround(p[P::r1]))], RANGE_SEMIS[int(m::jsround(p[P::r2]))] + p[P::f2], RANGE_SEMIS[int(m::jsround(p[P::r3]))] + p[P::f3]};
    const double ratio[2] = {m::pow(2, r[0] / 12), m::pow(2, r[1] / 12)};
    const double lv[3] = {p[P::on1] * p[P::m1], p[P::on2] * p[P::m2], p[P::on3] * p[P::m3]};
    const double noise = p[P::noiseOn] * p[P::noise], ext = p[P::extOn] * p[P::ext];
    const bool pink = p[P::noiseColor] > 0.5;
    const double k = p[P::emph] * 4.15, contour = p[P::contour] * 5;
    const double kbd = (p[P::kbd1] > 0.5 ? 1.0 / 3 : 0) + (p[P::kbd2] > 0.5 ? 2.0 / 3 : 0);
    const bool decayOn = p[P::decaySw] > 0.5;
    const double glide = p[P::glideOn] > 0.5 ? p[P::glide] : 0;
    fe.set(p[P::fA], p[P::fD], p[P::fS], decayOn ? p[P::fD] : 0.008);
    ae.set(p[P::aA], p[P::aD], p[P::aS], decayOn ? p[P::aD] : 0.008);
    const double wheel = m::min(1, p[P::wheel] + ctx.wheel), mix = p[P::modMix];
    const bool oscMod = p[P::oscMod] > 0.5, filtMod = p[P::filterMod] > 0.5, osc3Kbd = p[P::osc3Kbd] > 0.5;
    const double drift = p[P::drift] * 8, cutoff = p[P::cutoff], tune = p[P::tune];
    // Mixer level into the filter: turning the volumes up overdrives the ladder.
    const double drive = 1 + (lv[0] + lv[1] + lv[2]) * 1.2;
    for (int i = 0; i < n; i++) {
      glideStep(glide);
      const double d = wander(drift);
      // Osc 3 first: with keyboard control off it holds its pitch and works as an LFO.
      const double p3 = osc3Kbd ? pitch + detune + ctx.bend : 48;
      o[2].step(440 * m::pow(2, (p3 + r[2] + tune - 69) / 12), rate);
      const double o3 = wave(o[2], w[2], true);
      const double nzv = pink ? nz.pink() * 2.2 : nz.white();
      const double modSrc = (1 - mix) * o3 + mix * nzv;
      const double pm = oscMod ? modSrc * wheel * 7 : 0;
      const double base = hz(ctx, tune + d + pm);
      double x = 0;
      for (int j = 0; j < 2; j++) { o[j].step(base * ratio[j], rate); x += wave(o[j], w[j], false) * lv[j]; }
      x += o3 * lv[2] + nzv * noise + tanhApprox(last * 3) * ext * 0.8;
      const double fev = fe.next(rate);
      if ((i & 3) == 0) {
        const double oct = contour * fev + kbd * (pitch - 60) / 12 + (filtMod ? modSrc * wheel * 3 : 0);
        f.set(m::clamp(cutoff * m::pow(2, oct), 16, rate * 0.45), rate);
      }
      const double y = f.process(x * 0.4, k, drive) * (1 + k * 0.35);
      last = y;
      out[i] = static_cast<float>(static_cast<double>(out[i]) + y * ae.next(rate));
    }
  }
};

} // namespace soundlab
