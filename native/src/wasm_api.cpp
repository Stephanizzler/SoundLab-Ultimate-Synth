// The C interface the browser uses to run C++ voices (see src/engine/native.ts).
// The TypeScript slot still assigns notes to voices; each ported voice does
// its sound in C++. Voices live in a fixed pool because a bare WebAssembly
// build has no heap; plug-ins use the same classes directly.
#include "soundlab/machines/minimood.h"

using namespace soundlab;

namespace {
constexpr int MAX_VOICES = 64;
constexpr int MAX_BLOCK = 1024;
constexpr int MAX_PARAMS = 256;
alignas(MiniMoodVoice) unsigned char pool[MAX_VOICES][sizeof(MiniMoodVoice)];
MiniMoodVoice* voices[MAX_VOICES];
int used = 0;
float outBuf[MAX_BLOCK];
double paramBuf[MAX_PARAMS];
} // namespace

// The compiler turns clearing and copying loops into memset/memcpy calls; a
// bare WebAssembly build has no C library, so they are defined here.
extern "C" {
__attribute__((used)) void* memset(void* dst, int c, decltype(sizeof(0)) n) {
  auto* d = static_cast<volatile unsigned char*>(dst);
  for (decltype(n) i = 0; i < n; i++) d[i] = static_cast<unsigned char>(c);
  return dst;
}
__attribute__((used)) void* memcpy(void* dst, const void* src, decltype(sizeof(0)) n) {
  auto* d = static_cast<volatile unsigned char*>(dst);
  const auto* s = static_cast<const unsigned char*>(src);
  for (decltype(n) i = 0; i < n; i++) d[i] = s[i];
  return dst;
}
}

// Placement new without the C++ library.
inline void* operator new(decltype(sizeof(0)), void* p) noexcept { return p; }

extern "C" {
// Version of this interface, checked by the TypeScript loader.
__attribute__((export_name("sl_version"))) int sl_version() { return 1; }
__attribute__((export_name("sl_out"))) float* sl_out() { return outBuf; }
__attribute__((export_name("sl_params"))) double* sl_params() { return paramBuf; }
__attribute__((export_name("sl_max_block"))) int sl_max_block() { return MAX_BLOCK; }

// Creates a MiniMood voice; returns its handle, or -1 when the pool is full.
__attribute__((export_name("sl_minimood_create"))) int sl_minimood_create(double rate, int seed) {
  if (used >= MAX_VOICES) return -1;
  voices[used] = new (pool[used]) MiniMoodVoice(rate, seed);
  return used++;
}
__attribute__((export_name("sl_minimood_start"))) void sl_minimood_start(int h, int note, double vel, int accent, int legato, int glide) {
  voices[h]->start(note, vel, accent != 0, legato != 0, glide != 0);
}
__attribute__((export_name("sl_minimood_stop"))) void sl_minimood_stop(int h) { voices[h]->stop(); }
__attribute__((export_name("sl_minimood_active"))) int sl_minimood_active(int h) { return voices[h]->active() ? 1 : 0; }
__attribute__((export_name("sl_minimood_pitch"))) double sl_minimood_pitch(int h) { return voices[h]->pitch; }
// Renders n samples into sl_out() (cleared first), reading sl_params().
__attribute__((export_name("sl_minimood_render"))) void sl_minimood_render(int h, int n, double rate, double bend, double wheel, double press, double detune) {
  if (n > MAX_BLOCK) n = MAX_BLOCK;
  for (int i = 0; i < n; i++) outBuf[i] = 0;
  voices[h]->detune = detune;
  const VoiceCtx ctx{rate, bend, wheel, 120, press};
  voices[h]->render(outBuf, n, paramBuf, ctx);
}
}
