// Renders the MiniMood natively, for checking against the TypeScript engine
// (tools/native-check.mjs) and for timing.
//   soundlab_render <rate> <seconds> <params...>   writes float32 samples to stdout
//   soundlab_render --bench <rate> <params...>     prints the real-time factor
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>
#include "soundlab/machines/minimood.h"

using namespace soundlab;

int main(int argc, char** argv) {
  const bool bench = argc > 1 && std::strcmp(argv[1], "--bench") == 0;
  const int a0 = bench ? 2 : 1;
  if (argc < a0 + 2) { std::fprintf(stderr, "usage: soundlab_render [--bench] <rate> [seconds] <params...>\n"); return 2; }
  const double rate = std::atof(argv[a0]);
  const double seconds = bench ? 10 : std::atof(argv[a0 + 1]);
  std::vector<double> p;
  for (int i = a0 + (bench ? 1 : 2); i < argc; i++) p.push_back(std::atof(argv[i]));
  if ((int)p.size() < params::laddermono::COUNT) { std::fprintf(stderr, "need %d params\n", params::laddermono::COUNT); return 2; }
  const VoiceCtx ctx{rate, 0, 0, 120, 0};
  const int total = int(rate * seconds), hold = int(rate * seconds * 0.7);
  std::vector<float> out(total, 0.0f);
  auto t0 = std::chrono::steady_clock::now();
  MiniMoodVoice v(rate, 0);
  v.start(48, 0.9, false, false, false);
  for (int at = 0; at < total; at += 32) {
    if (at >= hold && v.gateOn) v.stop();
    v.render(out.data() + at, total - at < 32 ? total - at : 32, p.data(), ctx);
  }
  const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
  if (bench) { std::printf("%.1fx real time (%.1f ms for %.0f s, one voice)\n", seconds * 1000 / ms, ms, seconds); return 0; }
  std::fwrite(out.data(), sizeof(float), out.size(), stdout);
  return 0;
}
