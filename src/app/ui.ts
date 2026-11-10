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

// How a faceplate draws its controls (see faces.ts). Plain is the app's own look.
export type Look = {
  knob?: "moog" | "silver" | "pointer" | "rubber" | "grey" | "plain";
  scale?: boolean; // printed numbers around knobs (0-10, or -5..+5 for bipolar)
  fader?: boolean; // continuous controls as vertical faders
  cells?: boolean; // continuous controls as membrane value cells (DX-style)
  sw?: "rocker" | "led" | "tablet" | "membrane" | "bat" | "push" | "plain";
  selectors?: boolean; // short switch lists as rotary selectors labelled around the dial
};

const NS = "http://www.w3.org/2000/svg";
const svgEl = (tag: string, attrs: Record<string, string | number>) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v)); return e; };
// Shared gradients for knob caps, added to the page once.
if (typeof document !== "undefined" && !document.getElementById("knobDefs")) {
  const defs = svgEl("svg", { id: "knobDefs", width: 0, height: 0, "aria-hidden": "true", style: "position:absolute" });
  defs.innerHTML = `<defs>
    <radialGradient id="kgBlack" cx="38%" cy="30%" r="78%"><stop offset="0" stop-color="#5a5a5a"/><stop offset=".45" stop-color="#1b1b1b"/><stop offset="1" stop-color="#050505"/></radialGradient>
    <radialGradient id="kgSilver" cx="40%" cy="30%" r="80%"><stop offset="0" stop-color="#f8f8f8"/><stop offset=".6" stop-color="#aeb1b5"/><stop offset="1" stop-color="#686b70"/></radialGradient>
    <radialGradient id="kgGrey" cx="40%" cy="30%" r="80%"><stop offset="0" stop-color="#c2c3c0"/><stop offset=".6" stop-color="#8b8c89"/><stop offset="1" stop-color="#4c4d4a"/></radialGradient>
    <radialGradient id="kgRubber" cx="40%" cy="30%" r="85%"><stop offset="0" stop-color="#4a4b50"/><stop offset="1" stop-color="#17181b"/></radialGradient>
  </defs>`;
  document.body.prepend(defs);
}

// Pointer drag (vertical, Shift for fine), wheel, keys and double-click reset for any value control.
function bindValue(el: HTMLElement, d: ParamDef, get: () => number, setNorm: (n: number) => void, armed: () => boolean, onPatch: () => void, pixels = 180) {
  let startY = 0, startN = 0;
  el.addEventListener("pointerdown", (e) => {
    if (armed()) { e.preventDefault(); onPatch(); return; }
    el.setPointerCapture(e.pointerId); startY = e.clientY; startN = toNorm(d, get()); e.preventDefault();
  });
  el.addEventListener("pointermove", (e) => { if (el.hasPointerCapture(e.pointerId)) setNorm(startN + (startY - e.clientY) / (e.shiftKey ? pixels * 5 : pixels)); });
  el.addEventListener("pointerup", (e) => { if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId); });
  el.addEventListener("dblclick", () => setNorm(toNorm(d, d.def)));
  el.addEventListener("wheel", (e) => { e.preventDefault(); setNorm(toNorm(d, get()) - Math.sign(e.deltaY) * (e.shiftKey ? 0.004 : 0.02)); }, { passive: false });
  el.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 0.005 : 0.02, n = toNorm(d, get());
    const map: Record<string, number> = { ArrowUp: n + step, ArrowRight: n + step, ArrowDown: n - step, ArrowLeft: n - step, PageUp: n + 0.1, PageDown: n - 0.1, Home: 0, End: 1 };
    if (e.key in map) { e.preventDefault(); setNorm(map[e.key]); }
  });
}

// Draws a knob body of the given style at the centre of a 72-unit (scaled) or 44-unit (plain) box.
function knobBody(svg: SVGElement, style: string, c: number, r: number) {
  if (style === "moog") {
    svg.append(svgEl("circle", { cx: c, cy: c, r: r + 3, fill: "#0a0a0a" }), svgEl("circle", { cx: c, cy: c, r: r + 2, fill: "none", stroke: "#2c2c2c", "stroke-width": 2, "stroke-dasharray": "1.6 1.4" }));
    svg.append(svgEl("circle", { cx: c, cy: c, r: r - 2, fill: "url(#kgBlack)", class: "k-cap" }));
  } else if (style === "silver") {
    svg.append(svgEl("circle", { cx: c, cy: c, r: r + 2, fill: "url(#kgBlack)" }), svgEl("circle", { cx: c, cy: c, r: r - 5, fill: "url(#kgSilver)" }));
  } else if (style === "pointer") {
    svg.append(svgEl("circle", { cx: c, cy: c, r: r - 1, fill: "url(#kgBlack)", stroke: "#000", "stroke-width": 1 }));
  } else if (style === "rubber") {
    svg.append(svgEl("circle", { cx: c, cy: c, r, fill: "url(#kgRubber)", stroke: "#0008", "stroke-width": 1 }));
  } else if (style === "grey") {
    svg.append(svgEl("circle", { cx: c, cy: c, r: r + 1, fill: "#141414" }), svgEl("circle", { cx: c, cy: c, r: r - 2, fill: "url(#kgGrey)" }));
  }
}
// Panel legends for switch positions.
const LEGENDS: Record<string, string> = { Triangle: "TRI", "Tri-saw": "T-SAW", Saw: "SAW", Sawtooth: "SAW", Square: "SQ", "Wide pulse": "WIDE", "Narrow pulse": "NARR", "Reverse saw": "R-SAW", Pulse: "PULSE", Sine: "SINE", Noise: "NOISE", "White noise": "NOISE", "Ring mod": "RING" };
const legend = (o: string) => LEGENDS[o] ?? o;
const SW_START = 135, SWEEP = 270; // degrees, clockwise from the right-hand side (SVG angles)
const polar = (c: number, r: number, deg: number) => [c + Math.cos((deg * Math.PI) / 180) * r, c + Math.sin((deg * Math.PI) / 180) * r];

// A control for one parameter, drawn in the faceplate's style.
// While a patch source is armed, a tap on the control patches it instead.
export function control(key: string, d: ParamDef, value: number, onChange: (v: number) => void, armed: () => boolean, onPatch: () => void, look: Look = {}): HTMLElement {
  const patched = (wrap: HTMLElement) => (on: boolean) => wrap.classList.toggle("patched", on);
  // On/off switches.
  if (d.options && d.options.length === 2 && d.options[0] === "Off") {
    const style = look.sw ?? "plain";
    const b = h("button", { class: `toggle sw-${style}`, "aria-pressed": String(value > 0.5), title: d.name },
      style === "led" ? h("span", { class: "led", "aria-hidden": "true" }) : null,
      style === "bat" ? h("span", { class: "bat", "aria-hidden": "true" }, h("i")) : null,
      style === "rocker" ? h("span", { class: "rock", "aria-hidden": "true" }) : null,
      h("span", { class: "swname" }, d.name));
    b.addEventListener("click", () => {
      if (armed()) { onPatch(); return; }
      const v = Number(b.getAttribute("aria-pressed") !== "true"); b.setAttribute("aria-pressed", String(!!v)); onChange(v);
    });
    const wrap = h("div", { class: "ctl ctl-toggle" }, b);
    knobRegistry.set(key, { el: wrap, set: (v) => b.setAttribute("aria-pressed", String(v > 0.5)), setMod: () => {}, setPatched: patched(wrap) });
    return wrap;
  }
  // Short switch lists as rotary selectors, labelled around the dial like a hardware range switch,
  // with the short legends a panel would print.
  const short = d.options?.map(legend);
  if (d.options && short && look.selectors && d.options.length <= 6 && short.every((o) => o.length <= 6)) {
    let v = Math.round(value);
    const n = d.options.length, sweep = Math.min(240, (n - 1) * 52), first = -90 - sweep / 2, C0 = 40, R0 = 13;
    const angle = (i: number) => (n === 1 ? -90 : first + (i * sweep) / (n - 1));
    const svg = svgEl("svg", { viewBox: "0 0 80 80", "aria-hidden": "true" }) as SVGSVGElement;
    d.options.forEach((o, i) => {
      const [x1, y1] = polar(C0, R0 + 5, angle(i)), [x2, y2] = polar(C0, R0 + 8, angle(i)), [tx, ty] = polar(C0, R0 + 17, angle(i));
      svg.append(svgEl("line", { x1, y1, x2, y2, class: "k-tick" }));
      const t = svgEl("text", { x: tx, y: ty + 3, "text-anchor": "middle", class: "k-num" }); t.textContent = short[i]; svg.append(t); void o;
    });
    knobBody(svg, look.knob && look.knob !== "plain" ? look.knob : "pointer", C0, R0);
    const ptr = svgEl("line", { class: "k-ptr" }); svg.append(ptr);
    const knob = h("div", { class: "knob sel", role: "slider", tabindex: 0, "aria-label": d.name, "aria-valuemin": 0, "aria-valuemax": n - 1 }, svg);
    const wrap = h("div", { class: "ctl ctl-sel", title: `${d.name}. Drag, scroll or use arrow keys.` }, knob, h("span", { class: "ctl-name" }, d.name));
    const draw = () => {
      const [x1, y1] = polar(C0, 3, angle(v)), [x2, y2] = polar(C0, R0 - 2, angle(v));
      ptr.setAttribute("x1", String(x1)); ptr.setAttribute("y1", String(y1)); ptr.setAttribute("x2", String(x2)); ptr.setAttribute("y2", String(y2));
      knob.setAttribute("aria-valuenow", String(v)); knob.setAttribute("aria-valuetext", d.options![v]);
    };
    bindValue(knob, d, () => v, (nn) => { const nv = fromNorm(d, nn); if (nv !== v) { v = nv; draw(); onChange(v); } }, armed, onPatch, 60);
    draw();
    knobRegistry.set(key, { el: wrap, set: (nv) => { v = Math.round(nv); draw(); }, setMod: () => {}, setPatched: patched(wrap) });
    return wrap;
  }
  if (d.options) {
    const s = select(d.options, String(Math.round(value)), (v) => onChange(Number(v)), d.name);
    s.addEventListener("pointerdown", (e) => { if (armed()) { e.preventDefault(); onPatch(); } });
    const wrap = h("label", { class: "ctl ctl-select" }, h("span", { class: "ctl-name" }, d.name), s);
    knobRegistry.set(key, { el: wrap, set: (v) => (s.value = String(Math.round(v))), setMod: () => {}, setPatched: patched(wrap) });
    return wrap;
  }
  let v = value;
  const out = h("output", {});
  const text = () => formatParam(d, v);
  // Membrane value cell: name and value in a pressable key; drag to change.
  if (look.cells) {
    const cell = h("div", { class: "cell", role: "slider", tabindex: 0, "aria-label": d.name, "aria-valuemin": 0, "aria-valuemax": 100, title: `${d.name}. Drag up or down, scroll or use arrow keys.` }, h("span", { class: "cell-name" }, d.name), out);
    const mod = h("i", { class: "cell-mod", hidden: true });
    cell.append(mod);
    const wrap = h("div", { class: "ctl ctl-cell" }, cell);
    const draw = () => { out.textContent = text(); cell.setAttribute("aria-valuenow", String(Math.round(toNorm(d, v) * 100))); cell.setAttribute("aria-valuetext", text()); };
    bindValue(cell, d, () => v, (nn) => { const nv = fromNorm(d, nn); if (nv !== v) { v = nv; draw(); onChange(v); } }, armed, onPatch, 220);
    draw();
    knobRegistry.set(key, { el: wrap, set: (nv) => { v = nv; draw(); }, setMod: (m) => { mod.hidden = m === null; if (m !== null) mod.style.width = `${toNorm(d, m) * 100}%`; }, setPatched: patched(wrap) });
    return wrap;
  }
  // Vertical fader with a printed scale.
  if (look.fader) {
    const capEl = h("i", { class: "fcap" }), modEl = h("b", { class: "fmod", hidden: true });
    const fader = h("div", { class: "fader", role: "slider", tabindex: 0, "aria-label": d.name, "aria-valuemin": 0, "aria-valuemax": 100, "aria-orientation": "vertical" }, h("span", { class: "fscale", "aria-hidden": "true" }), modEl, capEl);
    const wrap = h("div", { class: "ctl ctl-fader", title: `${d.name}. Drag, scroll or use arrow keys; double-click to reset.` }, fader, h("span", { class: "ctl-name" }, d.name), out);
    const pos = (n: number) => `calc(8px + ${(1 - n).toFixed(4)} * (100% - 16px))`; // the cap travels between the track ends
    const draw = () => { const n = toNorm(d, v); capEl.style.top = pos(n); out.textContent = text(); fader.setAttribute("aria-valuenow", String(Math.round(n * 100))); fader.setAttribute("aria-valuetext", text()); };
    bindValue(fader, d, () => v, (nn) => { const nv = fromNorm(d, nn); if (nv !== v) { v = nv; draw(); onChange(v); } }, armed, onPatch, 110);
    draw();
    knobRegistry.set(key, { el: wrap, set: (nv) => { v = nv; draw(); }, setMod: (m) => { modEl.hidden = m === null; if (m !== null) modEl.style.top = pos(toNorm(d, m)); }, setPatched: (on) => { wrap.classList.toggle("patched", on); if (!on) modEl.hidden = true; } });
    return wrap;
  }
  // Rotary knob.
  const style = look.knob ?? "plain", scaled = style !== "plain";
  const S = scaled ? 72 : 44, c = S / 2, kr = scaled ? 15 : 17;
  const svg = svgEl("svg", { viewBox: `0 0 ${S} ${S}`, "aria-hidden": "true" }) as SVGSVGElement;
  let val: SVGElement | null = null;
  if (!scaled) {
    const len = (2 * Math.PI * kr * SWEEP) / 360, circ = 2 * Math.PI * kr;
    const ring = (cls: string) => svgEl("circle", { cx: c, cy: c, r: kr, class: cls, transform: `rotate(135 ${c} ${c})`, "stroke-dasharray": `${len} ${circ}` });
    svg.append(ring("k-track")); val = ring("k-val"); svg.append(val);
    svg.append(svgEl("circle", { cx: c, cy: c, r: 12.5, class: "k-cap" }));
  } else {
    if (look.scale !== false) {
      const bip = d.min < 0 && d.max > 0;
      const labels = bip ? ["−5", "", "0", "", "+5"] : ["0", "2", "4", "6", "8", "10"];
      for (let i = 0; i <= 10; i++) { const a = SW_START + (i / 10) * SWEEP; const [x1, y1] = polar(c, kr + 5, a), [x2, y2] = polar(c, kr + (i % 5 === 0 ? 9 : 7.5), a); svg.append(svgEl("line", { x1, y1, x2, y2, class: "k-tick" })); }
      labels.forEach((t, i) => { if (!t) return; const a = SW_START + (i / (labels.length - 1)) * SWEEP; const [x, y] = polar(c, kr + 15, a); const e = svgEl("text", { x, y: y + 3, "text-anchor": "middle", class: "k-num" }); e.textContent = t; svg.append(e); });
    }
    knobBody(svg, style, c, kr);
  }
  const dot = svgEl("circle", { r: 2.6, class: "k-mod" }); svg.append(dot);
  const ptr = svgEl("line", { class: "k-ptr" }); svg.append(ptr);
  const knob = h("div", { class: `knob ${scaled ? "scaled" : ""}`, role: "slider", tabindex: 0, "aria-label": d.name, "aria-valuemin": 0, "aria-valuemax": 100 }, svg);
  const wrap = h("div", { class: `ctl ${scaled ? "ctl-scaled" : ""}`, title: `${d.name}. Drag, scroll or use arrow keys; double-click to reset.` }, knob, h("span", { class: "ctl-name" }, d.name), out);
  const ang = (n: number) => SW_START + n * SWEEP;
  const draw = () => {
    const n = toNorm(d, v), a = ang(n);
    if (val) { const len = (2 * Math.PI * kr * SWEEP) / 360; val.setAttribute("stroke-dasharray", `${len * n} ${2 * Math.PI * kr}`); }
    const [x1, y1] = polar(c, scaled ? 3 : 4, a), [x2, y2] = polar(c, scaled ? kr - 2 : 11, a);
    ptr.setAttribute("x1", String(x1)); ptr.setAttribute("y1", String(y1)); ptr.setAttribute("x2", String(x2)); ptr.setAttribute("y2", String(y2));
    out.textContent = text();
    knob.setAttribute("aria-valuenow", String(Math.round(n * 100))); knob.setAttribute("aria-valuetext", text());
  };
  bindValue(knob, d, () => v, (nn) => { const nv = fromNorm(d, nn); if (nv !== v) { v = nv; draw(); onChange(v); } }, armed, onPatch);
  draw();
  (dot as SVGElement).style.display = "none";
  knobRegistry.set(key, {
    el: wrap,
    set: (nv) => { v = nv; draw(); },
    setMod: (m) => { if (m === null) { (dot as SVGElement).style.display = "none"; return; } (dot as SVGElement).style.display = ""; const [x, y] = polar(c, scaled ? kr + 3 : kr, ang(toNorm(d, m))); dot.setAttribute("cx", String(x)); dot.setAttribute("cy", String(y)); },
    setPatched: (on) => { wrap.classList.toggle("patched", on); if (!on) (dot as SVGElement).style.display = "none"; },
  });
  return wrap;
}

export const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
export const noteName = (n: number) => `${NOTE_NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
