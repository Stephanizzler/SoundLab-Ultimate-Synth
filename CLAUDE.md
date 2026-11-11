# SoundLab Ultimate Synth

- Read SoundLab-Core `START_HERE.md` and `SPEC.md` rules; this app follows them (app id `soundlab.synth`).
- `src/core/` is a copy of SoundLab-Core (see `SOURCE.txt`). Don't edit it here.
- Node runs the tests with type stripping: no TypeScript-only runtime syntax (no constructor parameter properties, enums or namespaces).
- The engine (`src/engine`, `src/dsp`, `src/machines`) must stay free of browser APIs: it runs in the AudioWorklet, the render Worker and Node tests.
- Audio loops must not allocate. Read parameters into locals once per block.
- Any new machine: add it to `src/machines/index.ts`; `npm test` then checks its presets, tuning, extremes and voice release.
- Run `npm test` and `npm run build` before committing.
- Machines ported to C++ (`native/`) must stay identical to their TypeScript: change both together, run `npm run native:wasm` (regenerates params.h and the embedded WebAssembly) and `npm test` (the parity test must stay bit-identical). `npm run native:check` builds natively with CMake.
- C++ in `native/` is header-only C++17: no heap allocation, exceptions, RTTI or platform APIs; keep `-ffp-contract=off` so rounding matches JavaScript.
