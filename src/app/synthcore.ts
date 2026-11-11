// The synth engine behind the page's messages: used by the AudioWorklet and,
// where a browser won't load the worklet, by a main-thread fallback. It
// reports the playhead, meters and moving knobs about 30 times a second.
import { Engine } from "../engine/engine.ts";
import type { SynthState } from "../engine/state.ts";
import type { NoteFlags } from "../engine/engine.ts";
import { setNativeEnabled, nativeEnabled } from "../engine/native.ts";


export type ToWorklet =
  | { type: "state"; state: SynthState }
  | { type: "param"; unit: string; id: string; value: number }
  | { type: "note"; slot: number; note: number; vel: number; on: boolean; flags?: NoteFlags }
  | { type: "midi"; channel: number; note: number; vel: number; on: boolean }
  | { type: "play" } | { type: "stop" } | { type: "panic" }
  | { type: "pattern"; index: number }
  | { type: "native"; on: boolean }
  | { type: "control"; wheel?: number; bend?: number; press?: number }
  | { type: "record"; on: boolean; audio: boolean; midi: boolean };
// While recording: the output's audio (16-bit, interleaved stereo) and the
// notes each slot played, sent about 30 times a second, and once more at the end.
export type RecChunk = { type: "rec"; pcm: Int16Array | null; notes: [number, number, number, number, number][]; start: number; done: boolean; rate: number };
export type Tick = {
  type: "tick"; playing: boolean; beat: number; pattern: number; queued: number;
  pos: number[]; slots: number[]; peakL: number; peakR: number;
  mods: [string, number, number][]; // unit, param index, effective value
  native: boolean; // the C++ engine is loaded and on in the audio thread
};

export class SynthCore {
  engine: Engine | null = null;
  frames = 0;
  readonly rate: number;
  readonly post: (t: Tick) => void;
  readonly allowNative: boolean;
  readonly postRec: (r: RecChunk, transfer: Transferable[]) => void;
  rec: { audio: boolean; midi: boolean; start: number; pcm: Int16Array; at: number; notes: [number, number, number, number, number][] } | null = null;
  constructor(rate: number, post: (t: Tick) => void, allowNative = true, postRec: (r: RecChunk, transfer: Transferable[]) => void = () => {}) {
    this.rate = rate; this.post = post; this.allowNative = allowNative; this.postRec = postRec; if (!allowNative) setNativeEnabled(false);
  }
  private flushRec(done: boolean) {
    const r = this.rec;
    if (!r) return;
    const pcm = r.audio ? r.pcm.slice(0, r.at) : null;
    this.postRec({ type: "rec", pcm, notes: r.notes, start: r.start, done, rate: this.rate }, pcm ? [pcm.buffer] : []);
    r.at = 0; r.notes = [];
    if (done) { this.rec = null; if (this.engine) this.engine.onNote = null; }
  }
  private hookNotes() {
    const e = this.engine, r = this.rec;
    if (!e || !r || !r.midi) return;
    e.onNote = (slot, note, vel, on, frame) => { this.rec?.notes.push([frame, slot, note, Math.round(vel * 127), on ? 1 : 0]); };
  }
  handle(m: ToWorklet) {
    if (m.type === "native" && !this.allowNative) return;
    if (m.type === "native" && !this.engine) { setNativeEnabled(m.on); return; }
    if (m.type === "state") { if (this.engine) this.engine.setState(m.state); else { this.engine = new Engine(this.rate, m.state); this.hookNotes(); } return; }
    if (m.type === "record") {
      if (!m.on) { this.flushRec(true); return; }
      this.rec = { audio: m.audio, midi: m.midi, start: this.engine?.clock ?? 0, pcm: new Int16Array(Math.ceil(this.rate / 15) * 2 + 4096), at: 0, notes: [] };
      this.hookNotes();
      return;
    }
    const e = this.engine;
    if (!e) return;
    switch (m.type) {
      case "param": e.setParam(m.unit, m.id, m.value); break;
      case "note": if (m.on) e.noteOn(m.slot, m.note, m.vel, m.flags); else e.noteOff(m.slot, m.note); break;
      case "midi": e.midiNote(m.channel, m.note, m.vel, m.on); break;
      case "play": e.play(); break;
      case "stop": e.stop(); break;
      case "panic": e.stop(); e.panic(); break;
      case "pattern": e.queuePattern(m.index); break;
      case "native": setNativeEnabled(m.on); e.rebuildVoices(); break;
      case "control":
        if (m.wheel !== undefined) e.wheel = m.wheel;
        if (m.bend !== undefined) e.ctx.bend = m.bend;
        if (m.press !== undefined) e.press = m.press;
        break;
    }
  }
  process(L: Float32Array, R: Float32Array, n: number) {
    const e = this.engine;
    if (!e) { L.fill(0, 0, n); R.fill(0, 0, n); return; }
    e.process(L, R, n);
    const r = this.rec;
    if (r?.audio) {
      if (r.at + n * 2 > r.pcm.length) this.flushRec(false);
      const pcm = r.pcm;
      for (let i = 0, p = r.at; i < n; i++, p += 2) {
        const l = L[i] < -1 ? -1 : L[i] > 1 ? 1 : L[i], rr = R[i] < -1 ? -1 : R[i] > 1 ? 1 : R[i];
        pcm[p] = Math.round(l * 32767); pcm[p + 1] = Math.round(rr * 32767);
      }
      r.at += n * 2;
    }
    this.frames += n;
    if (this.frames >= this.rate / 30) {
      this.frames = 0;
      const mods: [string, number, number][] = [];
      e.slots.forEach((s, i) => s?.touched.forEach((k) => mods.push([String(i), k, s.eff[k]])));
      e.fxUnit.touched.forEach((k) => mods.push(["fx", k, e.fxUnit.eff[k]]));
      e.modUnit.touched.forEach((k) => mods.push(["mod", k, e.modUnit.eff[k]]));
      if (this.rec) this.flushRec(false);
      this.post({
        type: "tick", playing: e.playing, beat: e.beat, pattern: e.state.pattern, queued: e.queued,
        pos: Array.from(e.tPos), slots: e.slots.map((s) => s?.peak ?? 0), peakL: e.peakL, peakR: e.peakR, mods, native: nativeEnabled(),
      });
    }
  }
}
