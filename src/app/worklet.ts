// The AudioWorklet: runs the engine on the audio thread and reports the
// playhead, meters and moving knobs back to the page about 30 times a second.
import { Engine } from "../engine/engine.ts";
import type { SynthState } from "../engine/state.ts";
import type { NoteFlags } from "../engine/engine.ts";

declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor { readonly port: MessagePort; }

export type ToWorklet =
  | { type: "state"; state: SynthState }
  | { type: "param"; unit: string; id: string; value: number }
  | { type: "note"; slot: number; note: number; vel: number; on: boolean; flags?: NoteFlags }
  | { type: "play" } | { type: "stop" } | { type: "panic" }
  | { type: "pattern"; index: number }
  | { type: "control"; wheel?: number; bend?: number; press?: number };
export type Tick = {
  type: "tick"; playing: boolean; beat: number; pattern: number; queued: number;
  pos: number[]; slots: number[]; peakL: number; peakR: number;
  mods: [string, number, number][]; // unit, param index, effective value
};

class SynthProcessor extends AudioWorkletProcessor {
  engine: Engine | null = null;
  frames = 0;
  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<ToWorklet>) => this.handle(e.data);
  }
  handle(m: ToWorklet) {
    if (m.type === "state") { if (this.engine) this.engine.setState(m.state); else this.engine = new Engine(sampleRate, m.state); return; }
    const e = this.engine;
    if (!e) return;
    switch (m.type) {
      case "param": e.setParam(m.unit, m.id, m.value); break;
      case "note": if (m.on) e.noteOn(m.slot, m.note, m.vel, m.flags); else e.noteOff(m.slot, m.note); break;
      case "play": e.play(); break;
      case "stop": e.stop(); break;
      case "panic": e.stop(); e.panic(); break;
      case "pattern": e.queuePattern(m.index); break;
      case "control":
        if (m.wheel !== undefined) e.wheel = m.wheel;
        if (m.bend !== undefined) e.ctx.bend = m.bend;
        if (m.press !== undefined) e.press = m.press;
        break;
    }
  }
  process(_in: Float32Array[][], outputs: Float32Array[][]) {
    const out = outputs[0], e = this.engine;
    if (!e || !out?.length) return true;
    const L = out[0], R = out[1] ?? out[0];
    e.process(L, R, L.length);
    this.frames += L.length;
    if (this.frames >= sampleRate / 30) {
      this.frames = 0;
      const mods: [string, number, number][] = [];
      e.slots.forEach((s, i) => s?.touched.forEach((k) => mods.push([String(i), k, s.eff[k]])));
      e.fxUnit.touched.forEach((k) => mods.push(["fx", k, e.fxUnit.eff[k]]));
      e.modUnit.touched.forEach((k) => mods.push(["mod", k, e.modUnit.eff[k]]));
      const t: Tick = {
        type: "tick", playing: e.playing, beat: e.beat, pattern: e.state.pattern, queued: e.queued,
        pos: Array.from(e.tPos), slots: e.slots.map((s) => s?.peak ?? 0), peakL: e.peakL, peakR: e.peakR, mods,
      };
      this.port.postMessage(t);
    }
    return true;
  }
}
registerProcessor("soundlab-synth", SynthProcessor);
