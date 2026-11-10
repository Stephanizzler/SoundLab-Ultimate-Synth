# SoundLab Ultimate Synth

A rack of sixteen synthesizer and drum-machine models, played by an eight-track step sequencer whose every output can be patched to any knob. Load up to eight machines, write patterns, patch the sequencer's CV lanes, LFOs and macros into anything, then render the result (with stems and MIDI) into a `.soundlab` project.

- **App id:** `soundlab.synth` (add to SoundLab-Core `docs/APPS.md`)
- **Family:** SoundLab Pro; opens and saves `.soundlab` projects
- **Version:** 0.1

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

Each machine is an original model of a classic instrument's *architecture*: its oscillator set, its filter circuit and where that circuit saturates, its envelopes and its quirks. The models are written from published circuit descriptions and DSP papers, with no samples and no code from the originals. They aim to capture what made each instrument distinctive. They are not component-level emulations.

| Slot name | Modelled on | What gives it its character here |
|---|---|---|
| Ladder Mono | Moog Minimoog Model D (1970) | Three oscillators (incl. tri-saw), mixer overload, 24 dB transistor ladder with input saturation and bass loss at high emphasis, decay switch |
| Studio Poly | Sequential Prophet-5 (1978) | Two oscillators, sync, **poly-mod** (filter env / osc B → freq A, width A or filter), 4-pole IC filter, per-voice "vintage" drift |
| Chorus Poly | Roland Juno-60 (1982) | One DCO with saw, PWM pulse, sub and noise; stepped HPF; the stereo BBD chorus I / II / I+II |
| Flagship Poly | Roland Jupiter-8 (1981) | Cross-mod and sync, HPF, 12/24 dB switchable filter, two ADSRs |
| Multimode Poly | Oberheim OB-X / SEM | 12 dB state-variable filter sweeping LP → notch → HP (plus BP), loose voice drift |
| Expressive Poly | Yamaha CS-80 (1977) | Two layers, HPF + resonant LPF, IL/AL filter envelope, velocity "touch" on brightness and level |
| Scream Mono | Korg MS-20 (1978) | Korg 35 high-pass and low-pass with nonlinear positive feedback, ring mod |
| Acid Bass | Roland TB-303 (1981) | Diode-ladder-style filter, accent (short decay + charging "sweep" circuit) and slide driven by the sequencer |
| Super VA | Access Virus (1997) | Up to nine detuned saws, wavetable osc, saturation, SVF + ladder in serial or parallel |
| Lead VA | Clavia Nord Lead 2 (1997) | Sync with a mod envelope on osc 2 pitch, FM, multimode filter |
| Wave Scanner | PPG Wave 2.2 (1982) | Envelope/LFO-scanned wavetables, coarse "8-bit" output, 4-pole analog-style filter |
| FM Six | Yamaha DX7 (1983) | Six operators, eight of the 32 DX7 algorithms, feedback |
| West Coast | Buchla 259 / 292, Music Easel | Complex oscillator (FM), wave folder, vactrol low-pass gate |
| String Machine | ARP / Eminent Solina (1974) | 16'/8'/4' registers, horn, three-line ensemble chorus |
| Boom Kit | Roland TR-808 (1980) | Bridged-T kick and toms, two-tone snare, three-burst clap, six-square "metal" hats, cymbal and cowbell |
| Punch Kit | Roland TR-909 (1984) | Pitch-swept, driven kick; brighter snare; hats and cymbals synthesised (the original used samples) |

Every machine has 3–5 presets of its own (61 in all). Filters use the topology-preserving (zero-delay-feedback) transform; the Korg 35 follows Will Pirkle's TPT structure; the state-variable filter is Andrew Simper's (Cytomic) trapezoidal SVF; oscillators are PolyBLEP band-limited; wavetables are generated here and band-limited per octave.

**Why these sixteen.** The list covers the instruments that are named again and again as the most influential (Minimoog, Prophet-5, Juno, Jupiter-8, DX7, TB-303, TR-808 and TR-909), the ones you named (Virus, Nord, Moog, Korg), and one example of each other major way of making sound: wavetable (PPG), West Coast (Buchla), divide-down strings (Solina) and expressive poly (CS-80).

## The step sequencer and the patch bay

- **8 tracks × 8 patterns (A–H)**, up to 64 steps each. Each track has its own length (polymeter) and step size (1/4 to 1/32, triplets). Swing applies to every second 16th. Pattern changes wait for the next bar.
- **Per step:** note, velocity, gate length, chance (repeatable in renders), ratchet ×1–4, chord (9 types), slide, accent, and two **CV lanes** (A and B, or "hold").
- **A track can play any number of slots**, for layering.
- **Patch bay:** 67 sources (for every track: gate, envelope, pitch, velocity, CV A, CV B and a ramp; four LFOs, synced or free; four macros; mod wheel, key velocity and aftertouch) to every knob in the rack, including the effects, the LFOs' own rates and the mixer. Up to 64 cables with bipolar amounts. Tap a source, then tap a knob. Patched knobs get a blue ring and a dot showing where the cable has moved them.
- The demo session shows the idea: the acid track's CV A sweeps the bass filter, LFO 1 moves its envelope depth, Macro 1 adds resonance and the kick's envelope ducks the chords like a sidechain.

## Decisions (START_HERE §4)

| Decision | Choice | Why |
|---|---|---|
| Where processing runs | **In the browser, on the device**: an AudioWorklet for live sound, a Web Worker for renders | Private, offline, no server cost. The same engine code runs in both and in the tests, so a render sounds like what you heard. Renders run about 6× faster than real time on a laptop. |
| Model licences | **No AI models, no samples.** All DSP is written here from published papers and circuit descriptions | Nothing to license. |
| Platform | Web first (Vite + TypeScript, no framework) | Same as the other Pro apps. A plug-in (AUv3/VST) version would need native audio; the engine has no browser dependencies, so it could be ported. |
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

- 16 machines, 61 presets, 8 slots with level, pan, mute, solo, delay and reverb sends; tempo-synced ping-pong delay, FDN reverb, bus drive and a look-ahead limiter (−1 dBFS sample peak).
- Sequencer and patch bay as above, sample-accurate to one 32-sample block (0.7 ms at 48 kHz).
- On-screen keyboard (multi-touch), computer keyboard (A–K, Z/X for octave, Space to play), Web MIDI input (all channels → selected slot, or channel n → slot n; mod wheel, pitch bend, aftertouch, start/stop).
- Render with loudness, true peak and range readouts; WAV, MIDI and patch (.json) downloads; .soundlab save and reopen; MIDI import onto a track (choose the part).
- The session is kept in this browser between visits.
- Tests (`npm test`): oscillator pitch and sync, filter slopes and resonance (ladder 24 dB/oct, self-oscillation at cutoff, SVF modes, Korg 35 bounded at full peak, diode stability), envelope times, wavetables, limiter ceiling, effects decay; every machine and preset at 44.1/48/96 kHz (sound, level, voices freed, tuning), every knob at minimum, maximum and random; voice stealing, mono note priority, 303 slide, hat choke; step timing, swing, triplets, polymeter, gate, ratchets, chords, probability repeatability, slide flags, CV/LFO/envelope/macro patching, every source patched at once, pattern switching, deterministic renders; project save/reopen, based-on versions untouched, bundle round trip, MIDI round trip, and validation of junk input.

## Not yet

- **Undo**, and a song mode that chains patterns.
- Per-step parameter locks without a cable (today: draw a CV lane and patch it).
- Per-voice modulation from the patch bay (cables move a slot's knobs for all its voices at once; each machine's own envelopes and velocity remain per voice).
- Oversampling. Filters and oscillators run at the session rate; at 44.1 kHz very high resonant notes and hard sync can alias a little. 96 kHz renders are cleaner.
- Only 8 of the DX7's 32 algorithms, and shared envelopes for carriers and for modulators instead of one per operator.
- MIDI clock sync and MIDI out.
- Sample-accurate (rather than 0.7 ms block) timing for notes played from a MIDI keyboard.
- Owner identity: standalone saves use the project owner. CoLab sign-in will supply the real member.
- **Trademark check** of "SoundLab" and "Ultimate Synth" before launch. The machine names are SoundLab's own; the original products' names (Moog, Minimoog, Sequential, Prophet, Roland, Juno, Jupiter, TB-303, TR-808/909, Oberheim, Yamaha, DX7, CS-80, Korg, MS-20, Access, Virus, Clavia, Nord, PPG, Buchla, ARP, Solina) are their owners' trademarks and appear only to say what each model is based on. Have that wording checked too.
