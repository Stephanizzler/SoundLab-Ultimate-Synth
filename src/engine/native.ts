// Loads the C++ audio core (native/, compiled to WebAssembly) and provides
// voices that run in it. Machines that have been ported create these voices
// when the native engine is on; the TypeScript slot still assigns notes.
// Works in the AudioWorklet, the render Worker and Node (no browser APIs).
import { NATIVE_WASM_BASE64 } from "./native-wasm.ts";
import { Voice, type VoiceCtx } from "./machine.ts";

type Exports = {
  memory: WebAssembly.Memory;
  sl_version(): number; sl_out(): number; sl_params(): number; sl_max_block(): number;
  sl_minimood_create(rate: number, seed: number): number;
  sl_minimood_start(h: number, note: number, vel: number, accent: number, legato: number, glide: number): void;
  sl_minimood_stop(h: number): void; sl_minimood_active(h: number): number; sl_minimood_pitch(h: number): number;
  sl_minimood_render(h: number, n: number, rate: number, bend: number, wheel: number, press: number, detune: number): void;
};
type Instance = { ex: Exports; out: Float32Array; params: Float64Array; used: number };

// AudioWorklet scopes have no atob, so decode base64 by hand.
function decodeBase64(s: string) {
  const table = new Uint8Array(128);
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".split("").forEach((c, i) => (table[c.charCodeAt(0)] = i));
  const clean = s.replace(/=+$/, ""), out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = table[clean.charCodeAt(i)], b = table[clean.charCodeAt(i + 1)], c = table[clean.charCodeAt(i + 2)] ?? 0, d = table[clean.charCodeAt(i + 3)] ?? 0;
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

let module: WebAssembly.Module | null = null, failed = false, enabled = true, current: Instance | null = null;
const POOL = 64; // voices per instance (see MAX_VOICES in native/src/wasm_api.cpp)

// The browser and TypeScript engines use JavaScript's Math, so imports keep the maths identical.
function instantiate(): Instance | null {
  if (failed || typeof WebAssembly === "undefined") return null;
  try {
    module ??= new WebAssembly.Module(decodeBase64(NATIVE_WASM_BASE64));
    const inst = new WebAssembly.Instance(module, { env: { sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: Math.exp, pow: Math.pow, log: Math.log } });
    const ex = inst.exports as unknown as Exports;
    if (ex.sl_version() !== 1) throw new Error("Unexpected native engine version");
    return { ex, out: new Float32Array(ex.memory.buffer, ex.sl_out(), ex.sl_max_block()), params: new Float64Array(ex.memory.buffer, ex.sl_params(), 256), used: 0 };
  } catch {
    failed = true;
    return null;
  }
}
// A slot for one more voice: the current instance, or a fresh one when it is full.
function allocate() {
  if (!current || current.used >= POOL) current = instantiate();
  if (!current) return null;
  current.used++;
  return current;
}

// Whether ported machines should use the C++ engine. Voices created after a change follow it.
export function setNativeEnabled(on: boolean) { enabled = on; }
// Validates rather than compiles: browsers refuse synchronous compiling of
// larger modules on the page's main thread (it is fine in worklets and workers).
let valid: boolean | null = null;
export function nativeAvailable() {
  if (failed || typeof WebAssembly === "undefined") return false;
  try { valid ??= WebAssembly.validate(decodeBase64(NATIVE_WASM_BASE64)); } catch { valid = false; }
  return valid;
}
export const nativeEnabled = () => enabled && nativeAvailable();

// The MiniMood voice, rendered by the C++ port in native/include/soundlab/machines/minimood.h.
export class NativeMiniMood extends Voice {
  inst: Instance; h: number; glideNext = false;
  constructor(rate: number, seed: number, inst: Instance) {
    super(rate, seed);
    this.inst = inst;
    this.h = inst.ex.sl_minimood_create(rate, seed);
  }
  start(note: number, vel: number, accent: boolean, legato: boolean, glide: boolean) {
    this.glideNext = glide;
    super.start(note, vel, accent, legato, glide);
  }
  trigger(legato: boolean) { this.inst.ex.sl_minimood_start(this.h, this.note, this.vel, this.accent ? 1 : 0, legato ? 1 : 0, this.glideNext ? 1 : 0); }
  release() { this.inst.ex.sl_minimood_stop(this.h); }
  get active() { return this.inst.ex.sl_minimood_active(this.h) === 1; }
  render(out: Float32Array, n: number, p: Float64Array, ctx: VoiceCtx) {
    const { ex, params } = this.inst;
    params.set(p.length > params.length ? p.subarray(0, params.length) : p);
    for (let at = 0; at < n; at += this.inst.out.length) {
      const m = Math.min(this.inst.out.length, n - at);
      ex.sl_minimood_render(this.h, m, ctx.rate, ctx.bend, ctx.wheel, ctx.press, this.detune);
      const o = this.inst.out;
      for (let i = 0; i < m; i++) out[at + i] += o[i];
    }
    this.pitch = ex.sl_minimood_pitch(this.h);
  }
}
// Creates a native MiniMood voice if the C++ engine is on and loaded, otherwise null.
export function nativeMiniMood(rate: number, seed: number): Voice | null {
  if (!nativeEnabled()) return null;
  const inst = allocate();
  return inst ? new NativeMiniMood(rate, seed, inst) : null;
}
