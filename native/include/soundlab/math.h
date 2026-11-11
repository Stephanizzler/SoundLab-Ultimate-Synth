// Maths functions for the audio core.
//
// Native builds (plug-ins, apps) use the C++ standard library. The
// WebAssembly build has no C library, so it imports the same functions from
// JavaScript's Math object: the browser engine and the TypeScript engine
// then use identical maths, which keeps their output bit-for-bit comparable.
#pragma once

#if defined(__wasm__)
#define SL_IMPORT(name) __attribute__((import_module("env"), import_name(name)))
extern "C" {
SL_IMPORT("sin") double sl_sin(double);
SL_IMPORT("cos") double sl_cos(double);
SL_IMPORT("tan") double sl_tan(double);
SL_IMPORT("exp") double sl_exp(double);
SL_IMPORT("pow") double sl_pow(double, double);
SL_IMPORT("log") double sl_log(double);
}
namespace soundlab::m {
inline double sin(double x) { return sl_sin(x); }
inline double cos(double x) { return sl_cos(x); }
inline double tan(double x) { return sl_tan(x); }
inline double exp(double x) { return sl_exp(x); }
inline double pow(double x, double y) { return sl_pow(x, y); }
inline double log(double x) { return sl_log(x); }
inline double floor(double x) { return __builtin_floor(x); }
inline double fabs(double x) { return __builtin_fabs(x); }
inline double sqrt(double x) { return __builtin_sqrt(x); }
} // namespace soundlab::m
#else
#include <cmath>
namespace soundlab::m {
inline double sin(double x) { return std::sin(x); }
inline double cos(double x) { return std::cos(x); }
inline double tan(double x) { return std::tan(x); }
inline double exp(double x) { return std::exp(x); }
inline double pow(double x, double y) { return std::pow(x, y); }
inline double log(double x) { return std::log(x); }
inline double floor(double x) { return std::floor(x); }
inline double fabs(double x) { return std::fabs(x); }
inline double sqrt(double x) { return std::sqrt(x); }
} // namespace soundlab::m
#endif

namespace soundlab::m {
constexpr double PI = 3.141592653589793;
constexpr double TAU = PI * 2;
// JavaScript's Math.round: halves round up (towards +infinity).
inline double jsround(double x) { return floor(x + 0.5); }
inline double clamp(double x, double lo, double hi) { return x < lo ? lo : x > hi ? hi : x; }
inline double min(double a, double b) { return a < b ? a : b; }
inline double max(double a, double b) { return a > b ? a : b; }
} // namespace soundlab::m
