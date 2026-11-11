# SoundLab Ultimate Synth

A rack of sixteen synthesizer and drum-machine models, played by an eight-track step sequencer whose every output can be patched to any knob. Load up to eight machines, write patterns, patch the sequencer's CV lanes, LFOs and macros into anything, then render the result (with stems and MIDI) into a `.soundlab` project.

- **App id:** `soundlab.synth` (add to SoundLab-Core `docs/APPS.md`)
- **Family:** SoundLab Pro; opens and saves `.soundlab` projects
- **Version:** 0.5

## Run it

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # DSP, machine, sequencer and project tests (Node 22.6+)
npm run build    # static site in dist/
npm run artifact # one self-contained HTML page in dist/artifact.html
```

`.github/workflows/pages.yml` tests, builds and publishes `dist/` to the `gh-pages` branch on every push to `main`. Turn on **Settings → Pages → Deploy from a branch → gh-pages** once; the app is then at `https://stephanizzler.github.io/SoundLab-Ultimate-Synth/`. Like the other Pro apps it installs to a phone's home screen and works offline.

## The machines

Each machine is an original model of a classic instrument, built to be as close to the original as this approach allows. It has the original's **full front panel**: every oscillator and waveform, every LFO and modulation route, its filter circuit and where that circuit saturates, its envelopes and its voice count. Controls use the original's names and, where it had them, its scales (the DX7's 0–99 values, the Minimoog's footages). The models are written from published circuit descriptions, manuals and DSP papers, with no samples and no code from the originals. They are models of how each circuit behaves, not component-level emulations: they get the architecture and the character, but they won't null against the hardware.

| Name | Modelled on | Voices | What's on the panel |
|---|---|---|---|
| MiniMood Model Q | Moog Minimoog Model D (1970) | 1, low-note priority | 3 VCOs (LO, 32'–2'; tri, tri-saw, saw, square, wide and narrow pulse; osc 3 reverse saw), osc 3 keyboard off (as LFO), modulation mix osc 3 ↔ noise, osc and filter modulation, wheel, mixer with on/off switches, external-input feedback, white/pink noise, 24 dB ladder with emphasis, contour amount, keyboard control 1 and 2, filter and loudness contours, decay switch, glide |
| Profit-5 | Sequential Prophet-5 (1978) | 5 | Osc A (saw, pulse, PW, sync), osc B (saw, tri, pulse, PW, fine, Lo freq, keyboard off), Poly-Mod (filter env and osc B to freq A, PW A, filter), LFO (saw, tri, square, combinable), Wheel-Mod (LFO ↔ noise to freq A/B, PW A/B, filter), mixer with noise, 4-pole filter with keyboard off/half/full, two ADSRs, glide, unison; Rev 4 velocity and vintage |
| Juneau-60 | Roland Juno-60 (1982) | 6 | Arpeggio (up, down, up & down, 1–3 octaves), LFO (rate, delay, auto/manual trigger), DCO (LFO depth, 16'/8'/4', PWM from LFO or manual, pulse, saw, sub on and level, noise), 4-position HPF, VCF (freq, res, env ±, LFO, keyboard), VCA (env/gate, level), ADSR, chorus I / II / I+II |
| Juniper-8 | Roland Jupiter-8 (1981) | 8 | LFO (sine, saw, square, random; delay), VCO modulator (LFO and ENV-1 to VCO-1/2/both), VCO-1 (cross mod, 16'–2', tri/saw/pulse/square), VCO-2 (sync, LO–2', fine, sine/saw/pulse/noise), PWM from LFO, manual or ENV-1, source mix, HPF, VCF 12/24 dB (env select, LFO, key follow), VCA LFO, ENV-1 (key follow, invert), ENV-2 (key follow), solo/unison/poly, portamento, arpeggio |
| Overheim OX-A | Oberheim OB-Xa (1980) + SEM (1974) | 8 | Two oscillators (saw and pulse each, sync, cross mod, filter env → osc 2), LFO (sine, square, S&H) to either oscillator, width and filter, 2-pole SEM filter with LP–notch–HP mode and band-pass, OB-Xa 4-pole option, per-voice pan and drift, unison, polyphonic portamento |
| SeaSaw-80 | Yamaha CS-80 (1977) | 8 | Two complete channels, each with feet, square (PWM speed and depth), saw, noise, sine, HPF and LPF with resonance, IL/AL filter envelope (attack, decay, release), VCA ADSR and level; channel balance, detune, brilliance, resonance, sub oscillator (six functions to VCO, VCF, VCA), initial and after touch (brilliance, level, pitch), ring modulator (speed, depth, attack, decay) |
| Ms. Twenty | Korg MS-20 (1978) | 1, low-note priority | VCO-1 (tri, saw, variable pulse, noise; 32'–4'), VCO-2 (saw, square, narrow pulse, ring mod; pitch), mixer, Korg 35 HPF and LPF each with peak and MG and EG2 modulation, MG (ramp–tri–saw morph), frequency mod from MG and EG1, EG1 (delay, attack, release), EG2 (hold, attack, decay, sustain, release), portamento |
| TeaBag-303 | Roland TB-303 (1981) | 1 | The whole panel: waveform, tuning, cutoff, resonance, env mod, decay, accent (plus slide time and an optional distortion). Accent and slide come from the sequencer, as from the 303's own |
| Excess Viral | Access Virus B/C/TI | 16 | Osc 1 Classic (sine–tri–saw–pulse morph), HyperSaw (density, spread) or Wavetable; osc 2 Classic or Wavetable with sync, FM, filter-env pitch and FM; osc 3; sub (square/tri), coloured noise, ring mod; two filters (LP, HP, BP, band-stop) in Serial 4, Serial 6, Parallel or Split, eight saturation curves; filter and amp envelopes with sustain slope; LFO 1–3; velocity; unison; arpeggiator; chorus |
| Nerd Lead 2 | Clavia Nord Lead 2 (1997) | 16 | Osc 1 (pulse, saw, tri, sine; FM), osc 2 (pulse, saw, tri, noise; semitones, fine, sync, keyboard track), mix, mod env (to osc 2 pitch, FM or width), LFO 1 (five waves, five destinations), LFO 2 (amp, pitch, filter, FM), filter (LP 12/24, BP, HP, notch + LP; velocity, keyboard track, distortion), two ADSRs, octave shift, mono/legato/unison, portamento, arpeggiator |
| PBJ Wave 2.3 | PPG Wave 2.2 / 2.3 | 8 | Wavetable osc and sub-osc (semitone, detune, level, wave offset), wave start, ENV 2, LFO, keyboard and wheel to wave, LFO (four waves, delay) to pitch, filter and amp, 24 dB low-pass with ENV 1, keyboard and velocity, ENV 3 (VCA), 8-bit sound path; 14 generated wavetables |
| DeLuxe-7 | Yamaha DX7 (1983) | 16 | All 32 algorithms; per operator: on, ratio/fixed, coarse, fine, detune, output level, 4 rates and 4 levels, velocity sensitivity, amp-mod sensitivity; feedback; osc key sync; LFO (six waves, speed, delay, PMD, AMD, sync) and pitch-mod sensitivity; pitch envelope (4 rates, 4 levels) |
| Bucolic Easel | Buchla Music Easel (1973) | mono (poly optional) | Complex oscillator: principal wave shape (spike–square–tri–sine), timbre (folding), symmetry; modulation oscillator (saw, square, tri; keyboard or fixed) in FM or AM; envelope (transient, sustained, self-cycling); pulser (can fire the envelope); two low-pass-gate channels (LP, combo, VCA) with vactrol response |
| Saline Ensemble | ARP / Eminent Solina (1974) | 24 | Violin, viola, trumpet, horn, cello and contrabass tabs (contrabass on the lower half only), crescendo, sustain, fine tune, ensemble |
| T-Rex 808 | Roland TR-808 (1980) | 16 | All 16 instruments: bass drum (level, tone, decay, internal tuning), snare (tone, snappy), low/mid/high toms and congas (shared level and tuning), rim shot/claves, hand clap/maracas, cowbell, cymbal (tone, decay), open hihat (decay), closed hihat, accent |
| T-Rex 909 | Roland TR-909 (1984) | 16 | All 11 instruments: bass drum (tune, level, attack, decay), snare (tune, level, tone, snappy), three toms (tune, level, decay), rim shot, hand clap, closed and open hihat (level, decay), crash and ride (level, tune), total accent |

**Names and faceplates.** Each machine has a SoundLab name that plays on its original (MiniMood, Profit-5, Juneau-60, Juniper-8, Overheim, SeaSaw-80, Ms. Twenty, TeaBag-303, Excess Viral, Nerd Lead, PBJ Wave, DeLuxe-7, Bucolic Easel, Saline Ensemble, T-Rex 808 and 909). Its open panel is a faceplate that follows the original closely: panel colour and finish (grain, hammer paint, brushed metal), wood or metal cheeks, how sections are marked, and the original's kinds of controls: bakelite or silver-capped knobs with printed 0–10 scales, rotary range and waveform selectors labelled around the dial (MiniMood, Ms. Twenty, TeaBag), faders where the original had sliders (Juneau, Juniper, SeaSaw, Bucolic Easel, Saline), membrane value keys on the DeLuxe-7, rocker, LED, tablet, membrane, bat and push switches, LCD or LED displays, screws, the drum machines' coloured step keys and patch-jack strips. Type follows SoundLab Mastering: Michroma, Barlow Condensed, JetBrains Mono and Cinzel, bundled with the app. The faceplates are SoundLab's own designs (`src/app/faces.ts`): no logos, artwork or exact layouts are copied, because a product's look can be protected (trade dress) as well as its name. Each panel says what it is modelled on and that SoundLab is not affiliated with the original's maker. A pun is not automatically safe: have a trademark lawyer clear the names and the faceplate styling before selling the app, along with "SoundLab" and "Ultimate Synth".

**Presets:** 8 original patches for each synth and 4 for each drum kit (120 in all), such as the Minimoog's "Osc 3 vibrato lead", the Prophet's "Bell poly-mod", the Juno's "Inverted sweep pad", the DX7's "Electric piano", "Tubular bells" and "Slap bass", and the CS-80's "Ring-mod bells". The patch names and values are SoundLab's own, not copies of factory banks.

**Voice modes.** Where the original had them: Poly / Unison (2–8 voices, detune, stereo spread) / Mono, glide, last-note or low-note priority, single triggering (Minimoog) and slide (303). **Arpeggiators** on the Juno-60, Jupiter-8, Nord Lead 2 and Virus follow the transport when it plays, and run on their own clock when it doesn't.

**Multitimbral.** Every slot is a *part* with its own MIDI channel (Omni or 1–16), key range and transpose. Point the keyboard at the **whole rack** to split and layer (a Jupiter-8's Dual and Split, a Nord Lead's slots, a Virus in Multi mode), or set a MIDI keyboard or DAW to **multitimbral** so each channel plays its slots. Seven **performances** set this up in one go, for example "Split: MiniMood bass / Juniper brass", "Layer: SeaSaw pad + DeLuxe strings", "Excess Viral multi: 4 parts on 4 channels" and "Three-way split: TeaBag / Juneau / PBJ".

**Not modelled yet:** the DX7's keyboard level and rate scaling; the CS-80's polyphonic aftertouch and ribbon (channel aftertouch and pitch bend stand in); the Virus's effects beyond chorus, its third filter-envelope routing and its 16-part arpeggiator per part (here one per slot); the MS-20's external patch panel (use the patch bay); the Jupiter-8's arpeggio clock input; the PPG's original ROM wavetables (these are generated stand-ins). Filters and oscillators run at the session rate without oversampling.

**CPU.** Everything runs on the audio thread. Measured on one core of a cloud test machine, each machine with all of its voices sounding runs 2–25× faster than real time; the heaviest are the Excess Viral with 16 HyperSaw voices (144 oscillators, about 2×) and the DeLuxe-7 with 16 voices (2.5×). As on the originals, HyperSaw and unison use voices quickly, so lower the density or voice count if a big session stutters.

## The step sequencer and the patch bay

- **8 tracks × 8 patterns (A–H)**, up to 64 steps each. Each track has its own length (polymeter) and step size (1/4 to 1/32, triplets). Swing applies to every second 16th. Pattern changes wait for the next bar.
- **Per step:** note, velocity, gate length, chance (repeatable in renders), ratchet ×1–4, chord (9 types), slide, accent, and two **CV lanes** (A and B, or "hold").
- **A track can play any number of slots**, for layering.
- **Patch bay:** 67 sources (for every track: gate, envelope, pitch, velocity, CV A, CV B and a ramp; four LFOs, synced or free; four macros; mod wheel, key velocity and aftertouch) to every knob in the rack, including the effects, the LFOs' own rates and the mixer. Up to 64 cables with bipolar amounts. Tap a source, then tap a knob. Patched knobs get a blue ring and a dot showing where the cable has moved them.
- The demo session shows the idea: the acid track's CV A sweeps the bass filter, LFO 1 moves its envelope depth, Macro 1 adds resonance and the kick's envelope ducks the chords like a sidechain.

## The C++ engine (for apps and plug-ins)

The plan in SoundLab-Core [`docs/NATIVE.md`](https://github.com/Stephanizzler/SoundLab-Core/blob/main/docs/NATIVE.md) turns the finished app into iOS and Android apps and AU, AUv3, VST3 and AAX plug-ins, built on one C++ audio core. The port has started:

- `native/` holds the C++ core: the DSP building blocks (`include/soundlab/dsp.h`), the voice base (`voice.h`) and the first machine, **MiniMood Model Q** (`machines/minimood.h`). It is header-only standard C++17 with no allocation, exceptions or platform APIs, ready for a JUCE or iPlug2 project (`native/CMakeLists.txt`).
- `native/generated/params.h` is generated from the TypeScript machine definitions (`npm run native:params`), so both engines always agree on parameter positions.
- `npm run native:wasm` compiles it to WebAssembly with plain clang (no Emscripten) and embeds it in `src/engine/native-wasm.ts`. The browser app runs ported machines in C++ through that build; the **Sound engine** switch in section 5 changes between C++ and TypeScript.
- **Parity:** `tests/native.test.mjs` plays every MiniMood preset (with glide, legato, low-note priority, bend, mod wheel and every switch) through both engines and requires bit-identical output. `npm run native:check` compiles the core natively with CMake, compares it with the TypeScript (identical, apart from last-digit rounding between maths libraries of about 10⁻¹⁴) and times it: one MiniMood voice runs at about 260× real time natively against about 60× in TypeScript.

Porting the next machine: add its voice under `native/include/soundlab/machines/`, export it in `native/src/wasm_api.cpp`, create it from the machine's `createVoice` through `src/engine/native.ts`, and add it to the parity test.

## Decisions (START_HERE §4)

| Decision | Choice | Why |
|---|---|---|
| Where processing runs | **In the browser, on the device**: an AudioWorklet for live sound, a Web Worker for renders | Private, offline, no server cost. The same engine code runs in both and in the tests, so a render sounds like what you heard. Renders run about 6× faster than real time on a laptop. |
| Model licences | **No AI models, no samples.** All DSP is written here from published papers and circuit descriptions | Nothing to license. |
| Platform | Web first (Vite + TypeScript, no framework), then native apps and plug-ins from a C++ core | Same as the other Pro apps. The engine is being ported to C++ module by module (see above). |
| Shared code | `src/core/` is copied from SoundLab-Core @ `7bd83cb` (see `src/core/SOURCE.txt`) | Allowed by the Core README. Copy again to update; don't edit it here. MIDI and WAV code are shared with SoundLab MIDI Transcript. |

## How it saves into a project

Following SPEC.md, **Save to .soundlab project** never changes an existing version. It adds:

1. the rendered mix as a 24-bit stereo WAV at the chosen rate (44.1, 48 or 96 kHz), loudness measured with `measureLoudness`,
2. optionally one **stem** per slot (each with its own delay and reverb sends),
3. the pattern as a `.mid` file,
4. a new version labelled `Synth n`, stage `demo`, with the stems and MIDI in `stemIds` and `source = { app: "soundlab.synth", basedOn?: <version>, settings: { app, schema: 1, data: { state, render } } }`. `state` is the **whole instrument** (rack, patterns, cables), so **Open its patch** brings it back exactly.

The last render is also kept in `project.apps["soundlab.synth"]`. A project from another app can be opened to write a part for one of its songs ("Based on" a version), and any MIDI asset in it (for example from SoundLab MIDI Transcript) can be put on a sequencer track. Everything loaded (projects with `problems()`, patches and stored sessions with `sanitizeState`) is validated; unknown machines become empty slots and numbers are clamped to their ranges.

As with MIDI Transcript, putting MIDI in `stemIds` is a workaround; a `version.midiIds` field in SPEC.md would make it explicit.

## What works

- 16 machines with their full front panels and 120 presets, 7 multitimbral performances, 8 slots (each a part with MIDI channel, key range and transpose) with level, pan, mute, solo, delay and reverb sends; tempo-synced ping-pong delay, FDN reverb, bus drive and a look-ahead limiter (−1 dBFS sample peak).
- Sequencer and patch bay as above, sample-accurate to one 32-sample block (0.7 ms at 48 kHz).
- On-screen keyboard (multi-touch) playing one slot or the whole rack, computer keyboard (A–K, Z/X for octave, Space to play), Web MIDI input (follow the keyboard, or multitimbral by each slot's channel; mod wheel, pitch bend, aftertouch, start/stop).
- Render with loudness, true peak and range readouts; WAV, MIDI and patch (.json) downloads; .soundlab save and reopen; MIDI import onto a track (choose the part).
- The session is kept in this browser between visits.
- Tests (`npm test`): oscillator pitch and sync, filter slopes and resonance (ladder 24 dB/oct, self-oscillation at cutoff, SVF modes, Korg 35 bounded at full peak, diode stability), envelope times, wavetables, limiter ceiling, effects decay; every machine and preset at 44.1/48/96 kHz (sound, level, voices freed, tuning), every knob at minimum, maximum and random; real voice counts, all 32 DX7 algorithms well formed, voice stealing, low- and last-note priority, 303 slide, hat choke; unison stacks, mono mode, arpeggiator modes, octaves and beat-locking, splits, layers, channels and transpose (keyboard and sequencer), polyphonic portamento, every performance; step timing, swing, triplets, polymeter, gate, ratchets, chords, probability repeatability, slide flags, CV/LFO/envelope/macro patching, every source patched at once, pattern switching, deterministic renders; project save/reopen, based-on versions untouched, bundle round trip, MIDI round trip, and validation of junk input.

## Not yet

- **The C++ port is at its start.** Only MiniMood Model Q runs in the C++ engine; the other fifteen machines, the sequencer, patch bay and effects are still TypeScript. No plug-in or mobile build exists yet (see SoundLab-Core `docs/NATIVE.md`).
- **Undo**, and a song mode that chains patterns.
- Per-step parameter locks without a cable (today: draw a CV lane and patch it).
- Per-voice modulation from the patch bay (cables move a slot's knobs for all its voices at once; each machine's own envelopes and velocity remain per voice).
- Oversampling. Filters and oscillators run at the session rate; at 44.1 kHz very high resonant notes and hard sync can alias a little. 96 kHz renders are cleaner.
- MIDI clock sync and MIDI out.
- Sample-accurate (rather than 0.7 ms block) timing for notes played from a MIDI keyboard.
- Owner identity: standalone saves use the project owner. CoLab sign-in will supply the real member.
- **Trademark and trade-dress check** of "SoundLab", "Ultimate Synth", the sixteen machine names and the faceplates before launch. The machine names are SoundLab's own plays on the originals; the original products' names (Moog, Minimoog, Sequential, Prophet, Roland, Juno, Jupiter, TB-303, TR-808/909, Oberheim, Yamaha, DX7, CS-80, Korg, MS-20, Access, Virus, Clavia, Nord, PPG, Buchla, ARP, Solina) are their owners' trademarks and appear only to say what each model is based on. Have that wording checked too.
