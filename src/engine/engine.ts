// The running instrument: eight rack slots, the step sequencer, the patch
// bay and the shared effects. The same code runs live in an AudioWorklet and
// offline for exports and tests, so a render sounds like what you heard.
import { machineById } from "../machines/index.ts";
import { ARP_RATES, fromNorm, toNorm, type MachineDef, type ParamDef, type SlotFx, type Voice, type VoiceCtx } from "./machine.ts";
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

// One rack slot: a machine's voices, how notes are assigned to them (poly,
// unison, mono, drums), the part settings (channel, key range, transpose)
// and the arpeggiator for machines that had one.
export class Slot extends Unit {
  voices: Voice[]; fx: SlotFx | null; counter = 0;
  L = new Float32Array(BLOCK); R = new Float32Array(BLOCK); vbuf = new Float32Array(BLOCK);
  peak = 0; follow = 0; mute = false; solo = false;
  held: number[] = []; // mono/unison note stack (played notes, last = sounding)
  sounding = new Map<number, number>(); // incoming note -> transposed note
  // Arpeggiator.
  arpHeld: { note: number; vel: number }[] = []; arpNote = -1; arpNext = -1; arpOff = -1; arpIdx = 0; arpClock = 0; arpRng = new Rng(99);
  readonly def: MachineDef;
  readonly rate: number;
  i: Record<string, number>;
  constructor(def: MachineDef, values: Record<string, number>, rate: number) {
    super(slotParamDefs(def.id), values);
    this.def = def; this.rate = rate;
    this.voices = Array.from({ length: def.voices }, (_, i) => def.createVoice(rate, i));
    this.fx = def.createFx?.(rate) ?? null;
    this.i = Object.fromEntries(["level", "pan", "delay", "reverb", "channel", "keyLo", "keyHi", "transpose", "assign", "uniVoices", "uniDetune", "spread", "arp", "arpRange", "arpRate"].map((k) => [k, this.index(k)]));
    this.i.glide = def.glideParam ? this.index(def.glideParam) : -1;
  }
  get iLevel() { return this.i.level; }
  get iDelay() { return this.i.delay; }
  get iReverb() { return this.i.reverb; }
  p(k: string, def = 0) { const i = this.i[k]; return i >= 0 ? this.eff[i] : def; }
  mode(): "poly" | "unison" | "mono" | "drum" {
    if (this.def.kind !== "poly") return this.def.kind;
    return (["poly", "unison", "mono"] as const)[Math.round(this.p("assign"))] ?? "poly";
  }
  listensOn(channel: number) { const c = Math.round(this.p("channel")); return c === 0 || c === channel + 1; }
  arpOn() { return this.def.kind !== "drum" && Math.round(this.p("arp")) > 0; }
  glideOn() { return this.i.glide >= 0 && this.eff[this.i.glide] > 0.001; }

  noteOn(note: number, vel: number, f: NoteFlags = {}) {
    if (note < this.p("keyLo", 0) || note > this.p("keyHi", 127)) return;
    const n = Math.max(0, Math.min(127, note + Math.round(this.p("transpose"))));
    if (this.sounding.has(note)) this.noteOff(note);
    this.sounding.set(note, n);
    if (this.arpOn()) { this.arpHeld.push({ note: n, vel }); return; }
    this.play(n, vel, f);
  }
  noteOff(note: number) {
    const n = this.sounding.get(note);
    if (n === undefined) return;
    this.sounding.delete(note);
    const k = this.arpHeld.findIndex((x) => x.note === n);
    if (k >= 0) { this.arpHeld.splice(k, 1); return; }
    this.unplay(n);
  }
  // Starts a (transposed) note on the voices.
  play(n: number, vel: number, f: NoteFlags = {}) {
    const mode = this.mode(), accent = !!f.accent;
    if (mode === "mono" || mode === "unison") {
      const vs = this.stack(mode);
      const lead = vs[0];
      const legato = this.held.length > 0 && lead.gateOn && (!this.def.slideOnly || !!f.slide);
      const glide = this.def.slideOnly ? legato : this.glideOn();
      this.held = this.held.filter((x) => x !== n); this.held.push(n);
      const target = this.monoTarget();
      if (legato && lead.note === target) return; // low-note priority: a higher key doesn't take over
      this.layout(vs);
      for (const v of vs) { v.start(target, vel, accent, legato, glide); v.started = ++this.counter; }
      return;
    }
    if (mode === "drum") for (const v of this.voices) if (v.active) v.choke(n);
    let v = mode === "drum" ? undefined : this.voices.find((x) => x.note === n && x.gateOn);
    v ??= this.voices.find((x) => !x.active);
    v ??= this.voices.filter((x) => !x.gateOn).sort((a, b) => a.started - b.started)[0];
    v ??= [...this.voices].sort((a, b) => a.started - b.started)[0];
    // Poly voices sit across the stereo field when the machine has a spread control (OB-Xa pan pots).
    v.detune = 0; v.pan = this.i.spread >= 0 && mode === "poly" ? this.p("spread") * (((this.voices.indexOf(v) * 0.618) % 1) * 2 - 1) : 0;
    v.start(n, vel, accent, false, mode !== "drum" && this.glideOn());
    v.started = ++this.counter;
  }
  unplay(n: number) {
    const mode = this.mode();
    if (mode === "mono" || mode === "unison") {
      const vs = this.stack(mode);
      const was = vs[0].note;
      this.held = this.held.filter((x) => x !== n);
      if (!this.held.length) for (const v of vs) v.stop();
      else if (was === n) { const t = this.monoTarget(); for (const v of vs) v.start(t, v.vel, false, true, this.glideOn()); }
      return;
    }
    if (mode === "drum") return; // drums play out their own length
    for (const v of this.voices) if (v.note === n && v.gateOn) v.stop();
  }
  // The voices a mono or unison note uses.
  stack(mode: string) { return mode === "mono" ? [this.voices[0]] : this.voices.slice(0, Math.max(2, Math.min(this.voices.length, Math.round(this.p("uniVoices", 4))))); }
  monoTarget() { return this.def.priority === "low" ? Math.min(...this.held) : this.held[this.held.length - 1]; }
  // Unison: spread the stack evenly in pitch and across the stereo field.
  layout(vs: Voice[]) {
    if (vs.length === 1) { vs[0].detune = 0; vs[0].pan = 0; return; }
    const det = this.p("uniDetune") / 100, spread = this.p("spread");
    vs.forEach((v, k) => { const pos = (k / (vs.length - 1)) * 2 - 1; v.detune = pos * det; v.pan = pos * spread; });
  }
  allOff(hard = false) {
    this.held = []; this.sounding.clear(); this.arpHeld = []; this.arpNote = -1; this.arpNext = -1;
    for (const v of this.voices) v.stop();
    if (hard) this.voices = Array.from({ length: this.def.voices }, (_, i) => this.def.createVoice(this.rate, i));
  }
  // The arpeggiator steps on the transport's beat when it plays, or on its own clock.
  arpTick(beats: number, transportBeat: number | null) {
    if (!this.arpOn()) {
      if (this.arpNote >= 0) { this.unplay(this.arpNote); this.arpNote = -1; }
      if (this.arpHeld.length) { for (const h of this.arpHeld) this.play(h.note, h.vel); this.arpHeld = []; }
      return;
    }
    const now = transportBeat ?? this.arpClock, end = now + beats;
    this.arpClock += beats;
    if (this.arpOff >= 0 && this.arpOff < end && this.arpNote >= 0) { this.unplay(this.arpNote); this.arpNote = -1; this.arpOff = -1; }
    if (!this.arpHeld.length) { this.arpNext = -1; this.arpIdx = 0; return; }
    const step = ARP_RATES[Math.round(this.p("arpRate"))]?.beats ?? 0.25;
    if (this.arpNext < 0 || this.arpNext > end + step || this.arpNext < now - step) this.arpNext = transportBeat !== null ? Math.ceil(now / step - 1e-9) * step : now;
    while (this.arpNext < end) {
      if (this.arpNote >= 0) this.unplay(this.arpNote);
      const seq = this.arpSequence();
      const pick = seq[this.arpIdx % seq.length];
      this.arpIdx++;
      this.play(pick.note, pick.vel);
      this.arpNote = pick.note; this.arpOff = this.arpNext + step * 0.5; this.arpNext += step;
    }
  }
  arpSequence() {
    const mode = Math.round(this.p("arp")), oct = Math.round(this.p("arpRange")) + 1;
    const base = mode === 5 ? this.arpHeld.slice() : this.arpHeld.slice().sort((a, b) => a.note - b.note);
    const up: { note: number; vel: number }[] = [];
    for (let o = 0; o < oct; o++) for (const h of base) if (h.note + 12 * o <= 127) up.push({ note: h.note + 12 * o, vel: h.vel });
    if (mode === 2) return up.reverse();
    if (mode === 3) return up.length > 1 ? [...up, ...up.slice(1, -1).reverse()] : up;
    if (mode === 4) { const k = Math.floor(this.arpRng.next() * up.length); return [up[k]]; }
    return up;
  }
  render(n: number, ctx: VoiceCtx) {
    this.L.fill(0, 0, n); this.R.fill(0, 0, n);
    // A unison stack starts in phase, so scale it a little harder than 1/sqrt(n).
    const uni = this.mode() === "unison" ? 1.2 * this.stack("unison").length ** -0.75 : 1;
    for (const v of this.voices) {
      if (!v.active) continue;
      this.vbuf.fill(0, 0, n);
      v.render(this.vbuf, n, this.eff, ctx);
      const a = ((v.pan + 1) * Math.PI) / 4, gl = Math.cos(a) * Math.SQRT2 * uni, gr = Math.sin(a) * Math.SQRT2 * uni;
      for (let k = 0; k < n; k++) { const x = this.vbuf[k]; this.L[k] += x * gl; this.R[k] += x * gr; }
    }
    const lv = this.eff[this.i.level];
    const g = lv <= -47.9 ? 0 : dbToGain(lv) * this.def.level;
    const pan = this.eff[this.i.pan], gl = g * Math.cos((pan + 1) * Math.PI / 4) * Math.SQRT2, gr = g * Math.sin((pan + 1) * Math.PI / 4) * Math.SQRT2;
    for (let k = 0; k < n; k++) { this.L[k] *= gl; this.R[k] *= gr; }
    if (this.fx) this.fx.process(this.L, this.R, n, this.eff);
    let peak = 0;
    for (let k = 0; k < n; k++) peak = Math.max(peak, Math.abs(this.L[k]), Math.abs(this.R[k]));
    this.peak = Math.max(peak, this.peak * 0.995);
    // Envelope follower for sidechaining: fast attack, smooth release. Taken before
    // mute, so a muted "ghost" kick can still duck other parts.
    const target = Math.min(1, peak * 2);
    this.follow += (target - this.follow) * (1 - Math.exp(-n / ((target > this.follow ? 0.004 : 0.12) * this.rate)));
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
    this.ctx = { rate, bend: 0, wheel: 0, bpm: 120, press: 0 };
    this.setState(state);
  }

  /* ---------------- State ---------------- */
  // Recreates every slot's voices, e.g. after switching between the C++ and TypeScript engines.
  rebuildVoices() { for (const s of this.slots) s?.allOff(); this.slots = this.slots.map(() => null); this.setState(this.state); }
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
    m = /^s(\d)\.follow$/.exec(id); if (m) { const i = Number(m[1]); return i < SLOTS ? (e) => e.slots[i]?.follow ?? 0 : null; }
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
  // A note from a keyboard on a MIDI channel (0-15): every slot listening on
  // that channel whose key range holds the note plays it (splits and layers).
  midiNote(channel: number, note: number, vel: number, on: boolean) {
    if (on) this.keyVel = vel;
    for (const s of this.slots) if (s?.listensOn(channel)) { if (on) s.noteOn(note, vel); else s.noteOff(note); }
  }
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
    const notes = [...new Set([...CHORDS[st.chord].iv.map((iv) => Math.min(127, st.note + iv)), ...st.more])];
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
    this.ctx.bpm = bpm; this.ctx.wheel = this.wheel; this.ctx.press = this.press;
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
      s.arpTick(beats, this.playing ? this.beat - beats : null);
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
