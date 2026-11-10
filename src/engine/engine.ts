// The running instrument: eight rack slots, the step sequencer, the patch
// bay and the shared effects. The same code runs live in an AudioWorklet and
// offline for exports and tests, so a render sounds like what you heard.
import { machineById } from "../machines/index.ts";
import { fromNorm, toNorm, type MachineDef, type ParamDef, type SlotFx, type Voice, type VoiceCtx } from "./machine.ts";
import {
  CHORDS, DELAY_TIMES, DIVISIONS, FX_PARAMS, LFO_RATES, MOD_PARAMS, SLOTS, TRACKS, TRACK_OUTPUTS, slotParamDefs,
  type SynthState, type Track,
} from "./state.ts";
import { Lfo } from "../dsp/env.ts";
import { Master, Reverb, StereoDelay } from "../dsp/fx.ts";
import { dbToGain, Rng } from "../dsp/util.ts";

export const BLOCK = 32; // sequencer and modulation resolution, in samples (0.7 ms at 48 kHz)

// A set of parameters that cables can move: a slot, the effects or the modulators.
class Unit {
  base: Float64Array; eff: Float64Array; mod: Float64Array; touched: number[] = [];
  readonly defs: ParamDef[];
  constructor(defs: ParamDef[], values: Record<string, number>) { this.defs = defs;
    this.base = Float64Array.from(defs.map((d) => values[d.id] ?? d.def));
    this.eff = Float64Array.from(this.base);
    this.mod = new Float64Array(defs.length);
  }
  index(id: string) { return this.defs.findIndex((d) => d.id === id); }
  set(id: string, v: number) { const i = this.index(id); if (i >= 0) { this.base[i] = v; this.eff[i] = v; } }
  // Applies this block's cable sums on top of the knob positions.
  apply() {
    for (const i of this.touched) { this.eff[i] = fromNorm(this.defs[i], toNorm(this.defs[i], this.base[i]) + this.mod[i]); this.mod[i] = 0; }
  }
}

export type NoteFlags = { slide?: boolean; accent?: boolean };

class Slot extends Unit {
  voices: Voice[]; fx: SlotFx | null; held: number[] = []; counter = 0;
  L = new Float32Array(BLOCK); R = new Float32Array(BLOCK); mono = new Float32Array(BLOCK);
  peak = 0; mute = false; solo = false; iLevel: number; iPan: number; iDelay: number; iReverb: number; iGlide: number;
  readonly def: MachineDef;
  readonly rate: number;
  constructor(def: MachineDef, values: Record<string, number>, rate: number) {
    super(slotParamDefs(def.id), values);
    this.def = def; this.rate = rate;
    this.voices = Array.from({ length: def.voices }, (_, i) => def.createVoice(rate, i));
    this.fx = def.createFx?.(rate) ?? null;
    this.iLevel = this.index("level"); this.iPan = this.index("pan"); this.iDelay = this.index("delay"); this.iReverb = this.index("reverb");
    this.iGlide = def.glideParam ? this.index(def.glideParam) : -1;
  }
  noteOn(note: number, vel: number, f: NoteFlags = {}) {
    const accent = !!f.accent;
    if (this.def.kind === "mono") {
      const v = this.voices[0];
      const legato = this.held.length > 0 && v.gateOn && (this.def.id !== "acid-bass" || !!f.slide);
      const glide = this.def.id === "acid-bass" ? legato : this.iGlide >= 0 && this.eff[this.iGlide] > 0.001;
      this.held = this.held.filter((n) => n !== note); this.held.push(note);
      v.start(note, vel, accent, legato, glide);
      v.started = ++this.counter;
      return;
    }
    if (this.def.kind === "drum") for (const v of this.voices) if (v.active) v.choke(note);
    let v = this.voices.find((x) => x.note === note && x.gateOn && this.def.kind !== "drum");
    v ??= this.voices.find((x) => !x.active);
    v ??= this.voices.filter((x) => !x.gateOn).sort((a, b) => a.started - b.started)[0];
    v ??= [...this.voices].sort((a, b) => a.started - b.started)[0];
    v.start(note, vel, accent, false, false);
    v.started = ++this.counter;
  }
  noteOff(note: number) {
    if (this.def.kind === "mono") {
      const was = this.held[this.held.length - 1];
      this.held = this.held.filter((n) => n !== note);
      const v = this.voices[0];
      if (!this.held.length) { if (v.note === note || was === note) v.stop(); }
      else if (was === note) v.start(this.held[this.held.length - 1], v.vel, false, true, this.iGlide >= 0 && this.eff[this.iGlide] > 0.001);
      return;
    }
    if (this.def.kind === "drum") return; // drums play out their own length
    for (const v of this.voices) if (v.note === note && v.gateOn) v.stop();
  }
  allOff(hard = false) {
    this.held = [];
    for (const v of this.voices) { v.stop(); if (hard) { v.note = -1; } }
    if (hard) this.voices = Array.from({ length: this.def.voices }, (_, i) => this.def.createVoice(this.rate, i));
  }
  render(n: number, ctx: VoiceCtx) {
    this.mono.fill(0, 0, n);
    for (const v of this.voices) if (v.active) v.render(this.mono, n, this.eff, ctx);
    const g = dbToGain(this.eff[this.iLevel]) * this.def.level * (this.eff[this.iLevel] <= -47.9 ? 0 : 1);
    const pan = this.eff[this.iPan], gl = g * Math.cos((pan + 1) * Math.PI / 4) * Math.SQRT2, gr = g * Math.sin((pan + 1) * Math.PI / 4) * Math.SQRT2;
    let peak = 0;
    for (let i = 0; i < n; i++) { const x = this.mono[i]; this.L[i] = x * gl; this.R[i] = x * gr; }
    if (this.fx) this.fx.process(this.L, this.R, n, this.eff);
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(this.L[i]), Math.abs(this.R[i]));
    this.peak = Math.max(peak, this.peak * 0.995);
  }
}

type Pending = { beat: number; on: boolean; track: number; slots: number[]; notes: number[]; vel: number; flags: NoteFlags; gateBeats: number };
type ParsedCable = { src: (e: Engine) => number; unit: Unit; index: number; amt: number };

export class Engine {
  state!: SynthState;
  slots: (Slot | null)[] = new Array(SLOTS).fill(null);
  fxUnit = new Unit(FX_PARAMS, {}); modUnit = new Unit(MOD_PARAMS, {});
  cables: ParsedCable[] = [];
  lfos = [new Lfo(101), new Lfo(202), new Lfo(303), new Lfo(404)]; lfoVal = new Float64Array(4);
  delay: StereoDelay; reverb: Reverb; master: Master;
  sendDL = new Float32Array(BLOCK); sendDR = new Float32Array(BLOCK); sendRL = new Float32Array(BLOCK); sendRR = new Float32Array(BLOCK);
  busL = new Float32Array(BLOCK); busR = new Float32Array(BLOCK); tmpL = new Float32Array(BLOCK); tmpR = new Float32Array(BLOCK);
  fxI: Record<string, number> = Object.fromEntries(FX_PARAMS.map((d, i) => [d.id, i]));
  ctx: VoiceCtx;
  // Transport and sequencer.
  playing = false; beat = 0; counters = new Int32Array(TRACKS); pending: Pending[] = []; queued = -1; rng = new Rng(12345);
  slidePending = new Uint8Array(TRACKS);
  // Per-track outputs for the patch bay.
  tGate = new Int32Array(TRACKS); tHit = new Float64Array(TRACKS).fill(-1e9); tHitLen = new Float64Array(TRACKS).fill(1);
  tPitch = new Float64Array(TRACKS); tVel = new Float64Array(TRACKS); tA = new Float64Array(TRACKS).fill(0.5); tB = new Float64Array(TRACKS).fill(0.5);
  tAs = new Float64Array(TRACKS).fill(0.5); tBs = new Float64Array(TRACKS).fill(0.5); tPos = new Int32Array(TRACKS).fill(-1);
  wheel = 0; press = 0; keyVel = 0.8; soloOnly = -1; peakL = 0; peakR = 0;

  readonly rate: number;
  constructor(rate: number, state: SynthState) { this.rate = rate;
    this.delay = new StereoDelay(rate); this.reverb = new Reverb(rate); this.master = new Master(rate);
    this.ctx = { rate, bend: 0, wheel: 0, bpm: 120 };
    this.setState(state);
  }

  /* ---------------- State ---------------- */
  setState(s: SynthState) {
    this.state = s;
    s.slots.forEach((st, i) => {
      const def = machineById(st.machine);
      const cur = this.slots[i];
      if (!def) { this.slots[i] = null; return; }
      if (!cur || cur.def.id !== def.id) this.slots[i] = new Slot(def, st.params, this.rate);
      else for (const d of cur.defs) cur.set(d.id, st.params[d.id] ?? d.def);
      this.slots[i]!.mute = st.mute; this.slots[i]!.solo = st.solo;
    });
    for (const d of FX_PARAMS) this.fxUnit.set(d.id, s.fx[d.id] ?? d.def);
    for (const d of MOD_PARAMS) this.modUnit.set(d.id, s.mod[d.id] ?? d.def);
    this.ctx.bpm = s.bpm;
    this.parseCables();
  }
  setParam(unit: string, id: string, v: number) {
    if (unit === "fx") { this.state.fx[id] = v; this.fxUnit.set(id, v); return; }
    if (unit === "mod") { this.state.mod[id] = v; this.modUnit.set(id, v); return; }
    const i = Number(unit), slot = this.slots[i];
    if (slot) { this.state.slots[i].params[id] = v; slot.set(id, v); }
  }
  parseCables() {
    const out: ParsedCable[] = [];
    for (const u of [this.fxUnit, this.modUnit, ...this.slots]) if (u) { u.touched = []; u.mod.fill(0); u.eff.set(u.base); }
    for (const c of this.state.cables) {
      const src = this.sourceFn(c.src);
      const [u, id] = c.dst.split(".") as [string, string];
      const unit = u === "fx" ? this.fxUnit : u === "mod" ? this.modUnit : u.startsWith("s") ? this.slots[Number(u.slice(1))] : null;
      if (!src || !unit) continue;
      const index = unit.index(id);
      if (index < 0) continue;
      if (!unit.touched.includes(index)) unit.touched.push(index);
      out.push({ src, unit, index, amt: c.amt });
    }
    this.cables = out;
  }
  // Each patch source as a function read once per block.
  sourceFn(id: string): ((e: Engine) => number) | null {
    let m = /^t(\d)\.(\w+)$/.exec(id);
    if (m) {
      const t = Number(m[1]), o = m[2];
      if (t >= TRACKS || !TRACK_OUTPUTS.some((x) => x.id === o)) return null;
      switch (o) {
        case "gate": return (e) => (e.tGate[t] > 0 ? 1 : 0);
        case "env": return (e) => { const age = e.beat - e.tHit[t]; return age < 0 ? 0 : Math.exp(-age / Math.max(0.02, e.tHitLen[t] * 0.6)); };
        case "pitch": return (e) => e.tPitch[t];
        case "vel": return (e) => e.tVel[t];
        case "a": return (e) => e.tAs[t];
        case "b": return (e) => e.tBs[t];
        default: return (e) => { const tr = e.track(t); if (!tr || e.tPos[t] < 0) return 0; const per = DIVISIONS[tr.division].perBeat; return ((e.beat * per) % tr.length) / tr.length; };
      }
    }
    m = /^lfo(\d)$/.exec(id); if (m) { const k = Number(m[1]); return k < 4 ? (e) => e.lfoVal[k] : null; }
    m = /^mac(\d)$/.exec(id); if (m) { const k = Number(m[1]), i = this.modUnit.index(`mac${k}`); return k < 4 ? (e) => e.modUnit.eff[i] : null; }
    if (id === "in.wheel") return (e) => e.wheel;
    if (id === "in.vel") return (e) => e.keyVel;
    if (id === "in.press") return (e) => e.press;
    return null;
  }
  track(t: number): Track | undefined { return this.state.patterns[this.state.pattern]?.tracks[t]; }

  /* ---------------- Live input ---------------- */
  noteOn(slot: number, note: number, vel: number, f?: NoteFlags) { this.keyVel = vel; this.slots[slot]?.noteOn(note, vel, f); }
  noteOff(slot: number, note: number) { this.slots[slot]?.noteOff(note); }
  panic() { for (const s of this.slots) s?.allOff(true); this.pending = []; this.tGate.fill(0); this.delay.l.clear(); this.delay.r.clear(); }
  play() {
    this.playing = true; this.beat = 0; this.counters.fill(0); this.pending = []; this.rng = new Rng(12345);
    this.slidePending.fill(0); this.tHit.fill(-1e9); this.tPos.fill(-1);
  }
  stop() {
    this.playing = false;
    for (const p of this.pending) if (!p.on) for (const s of p.slots) for (const n of p.notes) this.noteOff(s, n);
    this.pending = []; this.tGate.fill(0); this.tPos.fill(-1);
  }
  queuePattern(p: number) { if (!this.playing) { this.state.pattern = p; this.parseCables(); } else this.queued = p; }

  /* ---------------- Sequencer ---------------- */
  private fireStep(t: number, tr: Track, counter: number, stepBeat: number) {
    const pos = counter % tr.length, st = tr.steps[pos], per = DIVISIONS[tr.division].perBeat, stepBeats = 1 / per;
    this.tPos[t] = pos;
    if (st.a !== null) this.tA[t] = st.a;
    if (st.b !== null) this.tB[t] = st.b;
    const slideIn = this.slidePending[t] === 1;
    this.slidePending[t] = 0;
    if (!st.on || tr.mute || !tr.targets.length) return;
    if (st.prob < 1 && this.rng.next() >= st.prob) return;
    const notes = CHORDS[st.chord].iv.map((iv) => Math.min(127, st.note + iv));
    const r = st.ratchet, sub = stepBeats / r;
    for (let k = 0; k < r; k++) {
      // A slid step holds its gate into the next step, so the next note arrives legato.
      const gate = st.slide && k === r - 1 ? sub * 1.05 : Math.min(st.len * stepBeats, r > 1 ? sub * 0.9 : st.len * stepBeats);
      this.pending.push({ beat: stepBeat + k * sub, on: true, track: t, slots: tr.targets.slice(), notes, vel: st.vel, flags: { accent: st.accent, slide: slideIn && k === 0 }, gateBeats: Math.max(0.01, gate) });
    }
    if (st.slide) this.slidePending[t] = 1;
  }
  private runPending(until: number) {
    if (!this.pending.length) return;
    this.pending.sort((a, b) => a.beat - b.beat || (a.on === b.on ? 0 : a.on ? 1 : -1));
    while (this.pending.length && this.pending[0].beat < until) {
      const p = this.pending.shift()!;
      if (p.on) {
        for (const s of p.slots) for (const n of p.notes) this.slots[s]?.noteOn(n, p.vel, p.flags);
        this.tGate[p.track]++; this.tHit[p.track] = p.beat; this.tHitLen[p.track] = p.gateBeats; this.tPitch[p.track] = Math.max(-1, Math.min(1, (p.notes[0] - 60) / 24)); this.tVel[p.track] = p.vel;
        this.pending.push({ ...p, on: false, beat: p.beat + p.gateBeats });
        this.pending.sort((a, b) => a.beat - b.beat || (a.on === b.on ? 0 : a.on ? 1 : -1));
      } else {
        for (const s of p.slots) for (const n of p.notes) this.slots[s]?.noteOff(n);
        this.tGate[p.track] = Math.max(0, this.tGate[p.track] - 1);
      }
    }
  }
  private advanceSequencer(beats: number) {
    const end = this.beat + beats;
    if (this.queued >= 0 && Math.floor(end / 4) > Math.floor(this.beat / 4)) { this.state.pattern = this.queued; this.queued = -1; this.parseCables(); }
    for (let t = 0; t < TRACKS; t++) {
      const tr = this.track(t);
      if (!tr) continue;
      const per = DIVISIONS[tr.division].perBeat;
      for (;;) {
        const c = this.counters[t];
        const swing = per === 4 || per === 8 ? (c % 2 === 1 ? this.state.swing / per : 0) : 0;
        const at = c / per + swing;
        if (at >= end) break;
        this.fireStep(t, tr, c, Math.max(at, this.beat));
        this.counters[t]++;
      }
    }
    this.runPending(end);
  }

  /* ---------------- Audio ---------------- */
  process(outL: Float32Array, outR: Float32Array, n: number) {
    for (let off = 0; off < n; off += BLOCK) {
      const m = Math.min(BLOCK, n - off);
      this.block(m);
      outL.set(this.busL.subarray(0, m), off); outR.set(this.busR.subarray(0, m), off);
    }
  }
  private block(n: number) {
    const bpm = this.state.bpm, beats = (n / this.rate) * (bpm / 60);
    this.ctx.bpm = bpm; this.ctx.wheel = this.wheel;
    if (this.playing) this.advanceSequencer(beats); else this.runPending(Infinity);
    // CV lanes glide for 5 ms so stepped values don't click.
    const cvc = 1 - Math.exp(-n / (0.005 * this.rate));
    for (let t = 0; t < TRACKS; t++) { this.tAs[t] += (this.tA[t] - this.tAs[t]) * cvc; this.tBs[t] += (this.tB[t] - this.tBs[t]) * cvc; }
    // LFOs: synced ones follow the transport, free ones run on their own.
    const mod = this.modUnit;
    for (let k = 0; k < 4; k++) {
      const shape = Math.round(mod.eff[k * 3]), sync = LFO_RATES[Math.round(mod.eff[k * 3 + 1])], hz = mod.eff[k * 3 + 2];
      this.lfoVal[k] = sync.beats > 0 && this.playing ? this.lfos[k].setPhase(this.beat / sync.beats, shape)
        : this.lfos[k].advance(sync.beats > 0 ? (beats / sync.beats) : (hz * n) / this.rate, shape);
    }
    // Patch cables, then every unit's effective values.
    for (const c of this.cables) c.unit.mod[c.index] += c.src(this) * c.amt;
    this.modUnit.apply(); this.fxUnit.apply();
    if (this.playing) this.beat += beats;
    const anySolo = this.slots.some((s) => s?.solo);
    this.busL.fill(0); this.busR.fill(0); this.sendDL.fill(0); this.sendDR.fill(0); this.sendRL.fill(0); this.sendRR.fill(0);
    this.slots.forEach((s, i) => {
      if (!s) return;
      s.apply();
      s.render(n, this.ctx);
      const audible = this.soloOnly >= 0 ? this.soloOnly === i : !s.mute && (!anySolo || s.solo);
      if (!audible) return;
      const d = s.eff[s.iDelay], r = s.eff[s.iReverb];
      for (let j = 0; j < n; j++) {
        const l = s.L[j], rr = s.R[j];
        this.busL[j] += l; this.busR[j] += rr;
        this.sendDL[j] += l * d; this.sendDR[j] += rr * d; this.sendRL[j] += l * r; this.sendRR[j] += rr * r;
      }
    });
    const fx = this.fxUnit.eff, F = (id: string) => fx[this.fxI[id]];
    const dl = this.busL, dr = this.busR, tmpL = this.tmpL, tmpR = this.tmpR;
    tmpL.fill(0); tmpR.fill(0);
    this.delay.process(this.sendDL, this.sendDR, tmpL, tmpR, n, (DELAY_TIMES[Math.round(F("dTime"))].beats * 60) / bpm, F("dFb"), F("dTone"), F("dPing") > 0.5);
    const dLev = F("dLevel");
    for (let j = 0; j < n; j++) { dl[j] += tmpL[j] * dLev; dr[j] += tmpR[j] * dLev; tmpL[j] = 0; tmpR[j] = 0; }
    this.reverb.process(this.sendRL, this.sendRR, tmpL, tmpR, n, F("rSize"), F("rDamp"));
    const rLev = F("rLevel");
    for (let j = 0; j < n; j++) { dl[j] += tmpL[j] * rLev; dr[j] += tmpR[j] * rLev; }
    this.master.process(dl, dr, n, F("drive"), F("master"), F("limit") > 0.5);
    let pl = 0, pr = 0;
    for (let j = 0; j < n; j++) { pl = Math.max(pl, Math.abs(dl[j])); pr = Math.max(pr, Math.abs(dr[j])); }
    this.peakL = Math.max(pl, this.peakL * 0.99); this.peakR = Math.max(pr, this.peakR * 0.99);
  }
}

// Plays the current pattern from the start for a number of bars and returns
// the audio. `solo` renders one slot alone (with its effect sends) as a stem.
export function renderOffline(state: SynthState, rate: number, bars: number, opts: { solo?: number; tail?: number } = {}) {
  const e = new Engine(rate, structuredClone(state));
  if (opts.solo !== undefined) e.soloOnly = opts.solo;
  e.play();
  const playFrames = Math.round((bars * 4 * 60 * rate) / state.bpm);
  const tailFrames = Math.round((opts.tail ?? 0) * rate);
  const L = new Float32Array(playFrames + tailFrames), R = new Float32Array(playFrames + tailFrames);
  const chunk = 1024;
  for (let at = 0; at < playFrames; at += chunk) { const m = Math.min(chunk, playFrames - at); e.process(L.subarray(at, at + m), R.subarray(at, at + m), m); }
  e.stop();
  for (let at = playFrames; at < L.length; at += chunk) { const m = Math.min(chunk, L.length - at); e.process(L.subarray(at, at + m), R.subarray(at, at + m), m); }
  return { L, R };
}
