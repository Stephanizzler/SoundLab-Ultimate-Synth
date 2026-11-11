// Renders exports off the main thread: the mix, optional stems, and their loudness.
import { renderOffline } from "../engine/engine.ts";
import { measureLoudness, type Loudness } from "../core/index.ts";
import type { SynthState } from "../engine/state.ts";
import { setNativeEnabled } from "../engine/native.ts";

export type RenderJob = { state: SynthState; rate: number; bars: number; tail: number; stems: number[]; native: boolean };
export type RenderReply =
  | { type: "progress"; value: number; label: string }
  | { type: "done"; mix: { L: Float32Array; R: Float32Array; loudness: Loudness }; stems: { slot: number; L: Float32Array; R: Float32Array }[] }
  | { type: "error"; message: string };

export function runRender(job: RenderJob, progress: (value: number, label: string) => void): RenderReply {
  setNativeEnabled(job.native);
  const total = 1 + job.stems.length;
  progress(0, "Rendering the mix");
  const mix = renderOffline(job.state, job.rate, job.bars, { tail: job.tail });
  const stems = job.stems.map((slot, i) => {
    progress((i + 1) / total, `Rendering stem ${i + 1} of ${job.stems.length}`);
    return { slot, ...renderOffline(job.state, job.rate, job.bars, { tail: job.tail, solo: slot }) };
  });
  return { type: "done", mix: { ...mix, loudness: measureLoudness([mix.L, mix.R], job.rate) }, stems };
}

const ctx = self as unknown as Worker;
if (typeof ctx.postMessage === "function" && typeof (globalThis as { document?: unknown }).document === "undefined")
  ctx.onmessage = (e: MessageEvent<RenderJob>) => {
    try {
      const r = runRender(e.data, (value, label) => ctx.postMessage({ type: "progress", value, label }));
      if (r.type === "done") ctx.postMessage(r, [r.mix.L.buffer, r.mix.R.buffer, ...r.stems.flatMap((s) => [s.L.buffer, s.R.buffer])]);
    } catch (err) {
      ctx.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };
