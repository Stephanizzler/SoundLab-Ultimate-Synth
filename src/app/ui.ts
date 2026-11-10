// Small DOM helpers and the knob control used across the rack.
import { formatParam, fromNorm, toNorm, type ParamDef } from "../engine/machine.ts";

type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined>;
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v as EventListener);
    else if (k === "class") el.className = String(v);
    else if (k in el && typeof v !== "string") (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of kids) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}
export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export function select(options: readonly (string | { value: string; label: string; group?: string })[], value: string, onChange: (v: string) => void, label?: string) {
  const s = h("select", { "aria-label": label });
  const groups = new Map<string, HTMLOptGroupElement>();
  options.forEach((o, i) => {
    const opt = typeof o === "string" ? h("option", { value: String(i) }, o) : h("option", { value: o.value }, o.label);
    const g = typeof o === "string" ? undefined : o.group;
    if (g) { if (!groups.has(g)) { const og = h("optgroup", { label: g }); groups.set(g, og); s.append(og); } groups.get(g)!.append(opt); }
    else s.append(opt);
  });
  s.value = value;
  s.addEventListener("change", () => onChange(s.value));
  return s;
}

// Every knob on screen, so the audio thread's modulated values can be drawn on them.
export const knobRegistry = new Map<string, KnobHandle>();
export type KnobHandle = { el: HTMLElement; set(v: number): void; setMod(v: number | null): void; setPatched(on: boolean): void };

const ARC = 270, R = 17, C = 2 * Math.PI * R;
function arcDash(n: number) { const len = (C * ARC) / 360; return `${len * n} ${C}`; }

// A rotary knob for continuous values; switches become selects or toggles.
// Drag up/down (Shift for fine), scroll, arrow keys; double-click resets.
// While a patch source is armed, a tap on the knob patches it instead.
export function control(key: string, d: ParamDef, value: number, onChange: (v: number) => void, armed: () => boolean, onPatch: () => void): HTMLElement {
  if (d.options && d.options.length === 2 && d.options[0] === "Off") {
    const b = h("button", { class: "toggle", "aria-pressed": String(value > 0.5), title: d.name }, d.name);
    b.addEventListener("click", () => {
      if (armed()) { onPatch(); return; }
      const v = Number(b.getAttribute("aria-pressed") !== "true"); b.setAttribute("aria-pressed", String(!!v)); onChange(v);
    });
    const wrap = h("div", { class: "ctl ctl-toggle" }, b);
    knobRegistry.set(key, { el: wrap, set: (v) => b.setAttribute("aria-pressed", String(v > 0.5)), setMod: () => {}, setPatched: (on) => wrap.classList.toggle("patched", on) });
    return wrap;
  }
  if (d.options) {
    const s = select(d.options, String(Math.round(value)), (v) => onChange(Number(v)), d.name);
    s.addEventListener("pointerdown", (e) => { if (armed()) { e.preventDefault(); onPatch(); } });
    const wrap = h("label", { class: "ctl ctl-select" }, h("span", { class: "ctl-name" }, d.name), s);
    knobRegistry.set(key, { el: wrap, set: (v) => (s.value = String(Math.round(v))), setMod: () => {}, setPatched: (on) => wrap.classList.toggle("patched", on) });
    return wrap;
  }
  let v = value;
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg"); svg.setAttribute("viewBox", "0 0 44 44"); svg.setAttribute("aria-hidden", "true");
  const mk = (cls: string) => { const c = document.createElementNS(NS, "circle"); c.setAttribute("cx", "22"); c.setAttribute("cy", "22"); c.setAttribute("r", String(R)); c.setAttribute("class", cls); c.setAttribute("transform", "rotate(135 22 22)"); svg.append(c); return c; };
  mk("k-track").setAttribute("stroke-dasharray", arcDash(1));
  const val = mk("k-val");
  const dot = document.createElementNS(NS, "circle"); dot.setAttribute("r", "2.6"); dot.setAttribute("class", "k-mod"); svg.append(dot);
  const ptr = document.createElementNS(NS, "line"); ptr.setAttribute("x1", "22"); ptr.setAttribute("y1", "22"); ptr.setAttribute("class", "k-ptr"); svg.append(ptr);
  const out = h("output", {});
  const knob = h("div", { class: "knob", role: "slider", tabindex: 0, "aria-label": d.name, "aria-valuemin": 0, "aria-valuemax": 100 }, svg);
  const wrap = h("div", { class: "ctl", title: `${d.name}. Drag, scroll or use arrow keys; double-click to reset.` }, knob, h("span", { class: "ctl-name" }, d.name), out);
  const at = (n: number) => { const a = ((135 + n * ARC) * Math.PI) / 180; return [22 + Math.cos(a) * R, 22 + Math.sin(a) * R]; };
  const draw = () => {
    const n = toNorm(d, v);
    val.setAttribute("stroke-dasharray", arcDash(n));
    const a = ((135 + n * ARC) * Math.PI) / 180;
    ptr.setAttribute("x2", String(22 + Math.cos(a) * (R - 6))); ptr.setAttribute("y2", String(22 + Math.sin(a) * (R - 6)));
    out.textContent = formatParam(d, v);
    knob.setAttribute("aria-valuenow", String(Math.round(n * 100))); knob.setAttribute("aria-valuetext", formatParam(d, v));
  };
  const setNorm = (n: number) => { const nv = fromNorm(d, n); if (nv !== v) { v = nv; draw(); onChange(v); } };
  let startY = 0, startN = 0;
  knob.addEventListener("pointerdown", (e) => {
    if (armed()) { e.preventDefault(); onPatch(); return; }
    knob.setPointerCapture(e.pointerId); startY = e.clientY; startN = toNorm(d, v); e.preventDefault();
  });
  knob.addEventListener("pointermove", (e) => {
    if (!knob.hasPointerCapture(e.pointerId)) return;
    setNorm(startN + (startY - e.clientY) / (e.shiftKey ? 900 : 180));
  });
  knob.addEventListener("pointerup", (e) => { if (knob.hasPointerCapture(e.pointerId)) knob.releasePointerCapture(e.pointerId); });
  knob.addEventListener("dblclick", () => setNorm(toNorm(d, d.def)));
  knob.addEventListener("wheel", (e) => { e.preventDefault(); setNorm(toNorm(d, v) - Math.sign(e.deltaY) * (e.shiftKey ? 0.004 : 0.02)); }, { passive: false });
  knob.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 0.005 : 0.02, n = toNorm(d, v);
    const map: Record<string, number> = { ArrowUp: n + step, ArrowRight: n + step, ArrowDown: n - step, ArrowLeft: n - step, PageUp: n + 0.1, PageDown: n - 0.1, Home: 0, End: 1 };
    if (e.key in map) { e.preventDefault(); setNorm(map[e.key]); }
  });
  draw();
  knobRegistry.set(key, {
    el: wrap,
    set: (nv) => { v = nv; draw(); },
    setMod: (m) => { if (m === null) { dot.style.display = "none"; return; } dot.style.display = ""; const [x, y] = at(toNorm(d, m)); dot.setAttribute("cx", String(x)); dot.setAttribute("cy", String(y)); },
    setPatched: (on) => { wrap.classList.toggle("patched", on); if (!on) dot.style.display = "none"; },
  });
  dot.style.display = "none";
  return wrap;
}

export const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
export const noteName = (n: number) => `${NOTE_NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
