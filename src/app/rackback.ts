// The back of the rack: every module's jacks, and the patch cables between
// them, drawn as hanging leads. Drag from an output to an input (or the other
// way) to patch; click a cable to set its amount or remove it. Cables to a
// knob without its own jack plug into that module's "Any knob" input.
import { machineById } from "../machines/index.ts";
import { FX_PARAMS, TRACK_OUTPUTS, slotParamDefs } from "../engine/state.ts";
import { h } from "./ui.ts";
import { addCable, cablePath, cablePopover, cableColour, chooseKnob, closePopover, type PatchCtx } from "./cables.ts";

// Knobs most worth a dedicated input jack, in order of preference.
const FAVOURITES = ["cutoff", "res", "emph", "lpPeak", "hpCut", "envAmt", "contour", "lpEg", "pw", "aPw", "pos", "o1Shape", "fm", "index", "timbre", "glide", "detune", "kTune", "bdTune", "bdDecay", "sdSnappy"];
const SLOT_MIXER = ["level", "pan", "delay", "reverb"];

type Jack = { port: string; label: string; dir: "in" | "out"; any?: string };
function jack(j: Jack) {
  return h("button", { class: `jack ${j.dir}`, "data-port": j.port, "data-dir": j.dir, "data-any": j.any, title: `${j.dir === "out" ? "Output" : "Input"}: ${j.label}. Drag to patch.` }, h("i", { "aria-hidden": "true" }), h("span", {}, j.label));
}
function group(title: string, jacks: Jack[]) { return h("div", { class: "jgroup" }, h("span", { class: "gt" }, title), h("div", { class: "jacks" }, ...jacks.map(jack))); }
function module(title: string, sub: string, ...groups: HTMLElement[]) {
  return h("div", { class: "backmod" }, h("span", { class: "screw", "aria-hidden": "true" }), h("div", { class: "bid" }, h("b", {}, title), h("span", {}, sub)), ...groups, h("span", { class: "screw", "aria-hidden": "true" }));
}

export function renderRackBack(ctx: PatchCtx, host: HTMLElement) {
  const st = ctx.state();
  const wrap = h("div", { class: "rackback" });
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "cablelayer"); svg.setAttribute("aria-hidden", "true");

  // Modules, top to bottom like the front.
  const tracks = st.patterns[st.pattern].tracks;
  wrap.append(module("Sequencer", "Track outputs",
    ...tracks.map((tr, t) => group(tr.name, TRACK_OUTPUTS.map((o) => ({ port: `t${t}.${o.id}`, label: o.name, dir: "out" as const }))))));
  wrap.append(module("Modulators", "LFOs, macros and controller",
    group("LFO out", [0, 1, 2, 3].map((k) => ({ port: `lfo${k}`, label: `LFO ${k + 1}`, dir: "out" as const }))),
    group("Macro out", [0, 1, 2, 3].map((k) => ({ port: `mac${k}`, label: `Macro ${k + 1}`, dir: "out" as const }))),
    group("Controller", [{ port: "in.wheel", label: "Mod wheel", dir: "out" }, { port: "in.vel", label: "Velocity", dir: "out" }, { port: "in.press", label: "Aftertouch", dir: "out" }]),
    group("CV in", [...[0, 1, 2, 3].map((k) => ({ port: `mod.lfo${k}Hz`, label: `LFO ${k + 1} rate`, dir: "in" as const })), { port: "", label: "Any knob", dir: "in", any: "mod." }])));
  st.slots.forEach((s, i) => {
    const m = machineById(s.machine);
    if (!m) return;
    const defs = slotParamDefs(s.machine);
    const fav = FAVOURITES.filter((id) => defs.some((d) => d.id === id)).slice(0, 6);
    const name = (id: string) => defs.find((d) => d.id === id)?.name ?? id;
    wrap.append(module(`${i + 1} · ${m.name}`, m.kind === "drum" ? "Drum machine" : "Synthesizer",
      group("Audio", [{ port: `s${i}.follow`, label: "Level out (sidechain)", dir: "out" }]),
      group("CV in", [...fav.map((id) => ({ port: `s${i}.${id}`, label: name(id), dir: "in" as const })), { port: "", label: "Any knob", dir: "in", any: `s${i}.` }]),
      group("Mixer in", SLOT_MIXER.map((id) => ({ port: `s${i}.${id}`, label: name(id), dir: "in" as const })))));
  });
  wrap.append(module("Effects & master", "Delay, reverb, bus",
    group("CV in", [...["dTime", "dFb", "dLevel", "rSize", "rLevel", "drive", "master"].map((id) => ({ port: `fx.${id}`, label: FX_PARAMS.find((d) => d.id === id)!.name, dir: "in" as const })), { port: "", label: "Any knob", dir: "in", any: "fx." }])));
  wrap.append(svg);
  host.append(wrap);

  // Where each port sits; cables to knobs without a jack go to the module's "Any knob" input.
  const centre = (el: Element) => { const r = el.getBoundingClientRect(), w = wrap.getBoundingClientRect(); return [r.left - w.left + r.width / 2, r.top - w.top + 10]; };
  const portEl = (port: string) => wrap.querySelector(`.jack[data-port="${CSS.escape(port)}"]`);
  const anyFor = (dst: string) => wrap.querySelector(`.jack[data-any="${CSS.escape(dst.slice(0, dst.indexOf(".") + 1))}"]`);
  function draw() {
    svg.setAttribute("width", String(wrap.scrollWidth)); svg.setAttribute("height", String(wrap.scrollHeight));
    svg.replaceChildren();
    wrap.querySelectorAll(".jack.used").forEach((j) => j.classList.remove("used"));
    st.cables.forEach((c, i) => {
      const a = portEl(c.src), b = portEl(c.dst) ?? anyFor(c.dst);
      if (!a || !b) return;
      a.classList.add("used"); b.classList.add("used");
      const [x1, y1] = centre(a), [x2, y2] = centre(b), d = cablePath(x1, y1, x2, y2);
      const col = cableColour(i);
      const shadow = document.createElementNS(svg.namespaceURI, "path"); shadow.setAttribute("d", d); shadow.setAttribute("class", "cshadow");
      const line = document.createElementNS(svg.namespaceURI, "path"); line.setAttribute("d", d); line.setAttribute("class", "cable-line"); line.setAttribute("stroke", col);
      const hit = document.createElementNS(svg.namespaceURI, "path"); hit.setAttribute("d", d); hit.setAttribute("class", "cable-hit");
      hit.addEventListener("click", (e) => cablePopover(ctx, i, (e as MouseEvent).clientX, (e as MouseEvent).clientY));
      const t = document.createElementNS(svg.namespaceURI, "title"); t.textContent = `${Math.round(c.amt * 100)}% · click to change`; hit.append(t);
      svg.append(shadow, line, hit);
    });
  }
  // Dragging a new lead.
  let drag: { from: HTMLElement; path: SVGPathElement } | null = null;
  wrap.addEventListener("pointerdown", (e) => {
    const j = (e.target as HTMLElement).closest(".jack") as HTMLElement | null;
    if (!j) return;
    e.preventDefault(); closePopover();
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path") as SVGPathElement; path.setAttribute("class", "cable-line dragging"); path.setAttribute("stroke", cableColour(st.cables.length));
    svg.append(path);
    drag = { from: j, path };
    wrap.setPointerCapture(e.pointerId);
  });
  wrap.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const [x1, y1] = centre(drag.from), w = wrap.getBoundingClientRect();
    drag.path.setAttribute("d", cablePath(x1, y1, e.clientX - w.left, e.clientY - w.top));
  });
  wrap.addEventListener("pointerup", (e) => {
    if (!drag) return;
    const from = drag.from; drag.path.remove(); drag = null;
    // Look under any cables lying across the jack.
    const target = document.elementsFromPoint(e.clientX, e.clientY).map((el) => el.closest(".jack")).find(Boolean) as HTMLElement | undefined;
    if (!target || target === from) return;
    const out = from.dataset.dir === "out" ? from : target.dataset.dir === "out" ? target : null;
    const inp = from.dataset.dir === "in" ? from : target.dataset.dir === "in" ? target : null;
    if (!out || !inp) { ctx.status("Connect an output (amber) to an input (blue)."); return; }
    const src = out.dataset.port!;
    if (inp.dataset.any) chooseKnob(ctx, inp.dataset.any, "Patch to which knob?", e.clientX, e.clientY, (dst) => addCable(ctx, src, dst));
    else addCable(ctx, src, inp.dataset.port!);
  });
  requestAnimationFrame(draw);
  new ResizeObserver(() => draw()).observe(wrap);
}
