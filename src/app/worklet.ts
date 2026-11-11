// The AudioWorklet: runs the engine (synthcore.ts) on the audio thread.
import { SynthCore, type ToWorklet } from "./synthcore.ts";
export type { ToWorklet, Tick } from "./synthcore.ts";

declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor { readonly port: MessagePort; }

class SynthProcessor extends AudioWorkletProcessor {
  core: SynthCore;
  constructor() {
    super();
    this.core = new SynthCore(sampleRate, (t) => this.port.postMessage(t));
    this.port.onmessage = (e: MessageEvent<ToWorklet>) => this.core.handle(e.data);
  }
  process(_in: Float32Array[][], outputs: Float32Array[][]) {
    const out = outputs[0];
    if (!out?.length) return true;
    this.core.process(out[0], out[1] ?? out[0], out[0].length);
    return true;
  }
}
registerProcessor("soundlab-synth", SynthProcessor);
