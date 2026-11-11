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
  | { type: "control"; wheel?: number; bend?: number; press?: number };
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
  constructor(rate: number, post: (t: Tick) => void, allowNative = true) { this.rate = rate; this.post = post; this.allowNative = allowNative; if (!allowNative) setNativeEnabled(false); }
  handle(m: ToWorklet) {
    if (m.type === "native" && !this.allowNative) return;
    if (m.type === "native" && !this.engine) { setNativeEnabled(m.on); return; }
    if (m.type === "state") { if (this.engine) this.engine.setState(m.state); else this.engine = new Engine(this.rate, m.state); return; }
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
    this.frames += n;
    if (this.frames >= this.rate / 30) {
      this.frames = 0;
      const mods: [string, number, number][] = [];
      e.slots.forEach((s, i) => s?.touched.forEach((k) => mods.push([String(i), k, s.eff[k]])));
      e.fxUnit.touched.forEach((k) => mods.push(["fx", k, e.fxUnit.eff[k]]));
      e.modUnit.touched.forEach((k) => mods.push(["mod", k, e.modUnit.eff[k]]));
      this.post({
        type: "tick", playing: e.playing, beat: e.beat, pattern: e.state.pattern, queued: e.queued,
        pos: Array.from(e.tPos), slots: e.slots.map((s) => s?.peak ?? 0), peakL: e.peakL, peakR: e.peakR, mods, native: nativeEnabled(),
      });
    }
  }
}
