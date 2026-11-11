// The modular patch graph: every source and destination as a node, cables as
// wires, like a modular patching tool. Drag an output port onto a node to
// patch it (choosing the knob), drag a track's Notes port onto a synth to
// have the track play it, drag node headers to arrange them, click a wire to
// set its amount or remove it. Node positions are remembered in this browser.
import { machineById } from "../machines/index.ts";
import { TRACK_OUTPUTS, destinations } from "../engine/state.ts";
import { h } from "./ui.ts";
import { addCable, cablePath, cablePopover, cableColour, chooseKnob, closePopover, type PatchCtx } from "./cables.ts";

type Port = { id: string; label: string };
type Node = { id: string; title: string; kind: "source" | "slot" | "fx"; outs: Port[]; ins: Port[]; accepts?: string; slot?: number };
const POS_KEY = "soundlab.synth.graph.v1";
const loadPos = (): Record<string, [number, number]> => { try { return JSON.parse(localStorage.getItem(POS_KEY) ?? "{}"); } catch { return {}; } };
const savePos = (p: Record<string, [number, number]>) => { try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch { /* fine */ } };

export function renderGraph(ctx: PatchCtx, host: HTMLElement, onRoute: (track: number, slot: number) => void) {
  const st = ctx.state(), tracks = st.patterns[st.pattern].tracks, dests = destinations(st);
  const cabledIns = (prefix: string) => [...new Set(st.cables.filter((c) => c.dst.startsWith(prefix)).map((c) => c.dst))].map((id) => ({ id, label: dests.find((d) => d.id === id)?.name ?? id }));
  const nodes: Node[] = [
    ...tracks.map((tr, t): Node => ({ id: `track${t}`, title: tr.name, kind: "source", outs: [{ id: `notes:${t}`, label: "Notes" }, ...TRACK_OUTPUTS.map((o) => ({ id: `t${t}.${o.id}`, label: o.name }))], ins: [] })),
    { id: "mods", title: "Modulators", kind: "source", outs: [...[0, 1, 2, 3].map((k) => ({ id: `lfo${k}`, label: `LFO ${k + 1}` })), ...[0, 1, 2, 3].map((k) => ({ id: `mac${k}`, label: `Macro ${k + 1}` }))], ins: cabledIns("mod."), accepts: "mod." },
    { id: "ctrl", title: "Controller", kind: "source", outs: [{ id: "in.wheel", label: "Mod wheel" }, { id: "in.vel", label: "Velocity" }, { id: "in.press", label: "Aftertouch" }], ins: [] },
    ...st.slots.flatMap((s, i): Node[] => {
      const m = machineById(s.machine);
      if (!m) return [];
      const notesIn = tracks.some((tr) => tr.targets.includes(i)) ? [{ id: `notesin:${i}`, label: "Notes in" }] : [];
      return [{ id: `slot${i}`, title: `${i + 1} · ${m.name}`, kind: "slot", slot: i, outs: [{ id: `s${i}.follow`, label: "Level out" }], ins: [...notesIn, ...cabledIns(`s${i}.`)], accepts: `s${i}.` }];
    }),
    { id: "fx", title: "Effects & master", kind: "fx", outs: [], ins: cabledIns("fx."), accepts: "fx." },
  ];
  // Default layout: modulators and controller first, the tracks in two
  // columns, then the synths in two columns and the effects on the right.
  const pos = loadPos();
  const heightOf = (n: Node) => 34 + (n.outs.length + n.ins.length + (n.accepts ? 1 : 0)) * 18;
  let y0 = 10, ty = [10, 10], sy = [10, 10];
  for (const n of nodes) {
    if (pos[n.id]) continue;
    if (n.id === "mods" || n.id === "ctrl") { pos[n.id] = [10, y0]; y0 += heightOf(n) + 14; }
    else if (n.kind === "source") { const c = Number(n.id.slice(5)) % 2; pos[n.id] = [220 + c * 200, ty[c]]; ty[c] += heightOf(n) + 12; }
    else if (n.kind === "slot") { const c = (n.slot ?? 0) % 2; pos[n.id] = [650 + c * 220, sy[c]]; sy[c] += heightOf(n) + 14; }
    else pos[n.id] = [1100, 10];
  }
  const W = Math.max(1000, ...nodes.map((n) => pos[n.id][0] + 220)), H = Math.max(560, ...nodes.map((n) => pos[n.id][1] + 60 + (n.outs.length + n.ins.length) * 18));

  const area = h("div", { class: "graph", style: `width:${W}px;height:${H}px` });
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "graphwires"); svg.setAttribute("width", String(W)); svg.setAttribute("height", String(H)); svg.setAttribute("aria-hidden", "true");
  area.append(svg);
  const port = (p: Port, dir: "in" | "out") => h("div", { class: `gport ${dir}`, "data-port": p.id, "data-dir": dir, title: dir === "out" ? `Drag ${p.label} onto a node to patch it` : p.label }, dir === "in" ? h("i", { "aria-hidden": "true" }) : null, h("span", {}, p.label), dir === "out" ? h("i", { "aria-hidden": "true" }) : null);
  for (const n of nodes) {
    const el = h("div", { class: `gnode ${n.kind}`, "data-node": n.id, "data-accepts": n.accepts, "data-slot": n.slot === undefined ? undefined : String(n.slot), style: `left:${pos[n.id][0]}px;top:${pos[n.id][1]}px` },
      h("div", { class: "ghead" }, n.title),
      ...n.ins.map((p) => port(p, "in")),
      n.accepts ? h("div", { class: "gport in add", "data-dir": "in", "data-add": "1", title: "Drop an output here to patch a knob" }, h("i", { "aria-hidden": "true" }), h("span", {}, "+ knob")) : null,
      ...n.outs.map((p) => port(p, "out")));
    area.append(el);
  }
  const scroller = h("div", { class: "graphwrap" }, area);
  host.append(scroller);

  const centre = (el: Element) => { const r = el.getBoundingClientRect(), a = area.getBoundingClientRect(); return [el.classList.contains("out") ? r.right - a.left - 4 : r.left - a.left + 4, r.top - a.top + r.height / 2]; };
  const portOf = (id: string) => area.querySelector(`.gport[data-port="${CSS.escape(id)}"]`);
  const flat = (x1: number, y1: number, x2: number, y2: number) => { const dx = Math.max(40, Math.abs(x2 - x1) * 0.5); return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`; };
  function draw() {
    svg.replaceChildren();
    const mk = (d: string, cls: string, colour: string) => { const p = document.createElementNS(svg.namespaceURI, "path"); p.setAttribute("d", d); p.setAttribute("class", cls); p.setAttribute("stroke", colour); svg.append(p); return p; };
    // Note routing: which slots each track plays.
    tracks.forEach((tr, t) => tr.targets.forEach((i) => {
      const a = portOf(`notes:${t}`), b = portOf(`notesin:${i}`);
      if (!a || !b) return;
      const [x1, y1] = centre(a), [x2, y2] = centre(b);
      const hit = mk(flat(x1, y1, x2, y2), "gwire notes", "var(--muted)");
      const tt = document.createElementNS(svg.namespaceURI, "title"); tt.textContent = `${tr.name} plays slot ${i + 1} · click to disconnect`; hit.append(tt);
      hit.addEventListener("click", () => onRoute(t, i));
    }));
    st.cables.forEach((c, i) => {
      const a = portOf(c.src), b = portOf(c.dst);
      if (!a || !b) return;
      const [x1, y1] = centre(a), [x2, y2] = centre(b), d = flat(x1, y1, x2, y2);
      mk(d, "gwire", cableColour(i));
      const hit = mk(d, "gwire-hit", "transparent");
      const tt = document.createElementNS(svg.namespaceURI, "title"); tt.textContent = `${Math.round(c.amt * 100)}% · click to change`; hit.append(tt);
      hit.addEventListener("click", (e) => cablePopover(ctx, i, (e as MouseEvent).clientX, (e as MouseEvent).clientY));
      const lbl = document.createElementNS(svg.namespaceURI, "text");
      lbl.setAttribute("x", String((x1 + x2) / 2)); lbl.setAttribute("y", String((y1 + y2) / 2 - 4)); lbl.setAttribute("class", "gamt"); lbl.textContent = `${c.amt > 0 ? "+" : ""}${Math.round(c.amt * 100)}%`;
      svg.append(lbl);
    });
  }
  // Dragging nodes by their header, and new wires from output ports.
  let mode: { kind: "node"; el: HTMLElement; id: string; dx: number; dy: number } | { kind: "wire"; from: HTMLElement; path: SVGPathElement } | null = null;
  area.addEventListener("pointerdown", (e) => {
    const t = e.target as HTMLElement, a = area.getBoundingClientRect();
    const head = t.closest(".ghead"), out = t.closest(".gport.out") as HTMLElement | null;
    if (head) { const el = head.parentElement as HTMLElement; mode = { kind: "node", el, id: el.dataset.node!, dx: e.clientX - a.left - el.offsetLeft, dy: e.clientY - a.top - el.offsetTop }; }
    else if (out) { const path = document.createElementNS("http://www.w3.org/2000/svg", "path") as SVGPathElement; path.setAttribute("class", "gwire dragging"); path.setAttribute("stroke", cableColour(st.cables.length)); svg.append(path); mode = { kind: "wire", from: out, path }; }
    else return;
    e.preventDefault(); closePopover(); area.setPointerCapture(e.pointerId);
  });
  area.addEventListener("pointermove", (e) => {
    if (!mode) return;
    const a = area.getBoundingClientRect(), x = e.clientX - a.left, y = e.clientY - a.top;
    if (mode.kind === "node") {
      const nx = Math.max(0, Math.min(W - 60, x - mode.dx)), ny = Math.max(0, Math.min(H - 30, y - mode.dy));
      mode.el.style.left = `${nx}px`; mode.el.style.top = `${ny}px`; pos[mode.id] = [nx, ny]; draw();
    } else { const [x1, y1] = centre(mode.from); mode.path.setAttribute("d", flat(x1, y1, x, y)); }
  });
  area.addEventListener("pointerup", (e) => {
    if (!mode) return;
    const m = mode; mode = null;
    if (m.kind === "node") { savePos(pos); return; }
    m.path.remove();
    // Look under any wires lying across the node.
    const node = document.elementsFromPoint(e.clientX, e.clientY).map((el) => el.closest(".gnode")).find(Boolean) as HTMLElement | undefined;
    if (!node) return;
    const src = m.from.dataset.port!;
    if (src.startsWith("notes:")) {
      if (node.dataset.slot === undefined) { ctx.status("Note outputs go to a synth or drum machine."); return; }
      onRoute(Number(src.slice(6)), Number(node.dataset.slot));
      return;
    }
    if (!node.dataset.accepts) { ctx.status("That node has no knobs to patch."); return; }
    chooseKnob(ctx, node.dataset.accepts, `Patch to which knob of ${node.querySelector(".ghead")?.textContent}?`, e.clientX, e.clientY, (dst) => addCable(ctx, src, dst));
  });
  requestAnimationFrame(draw);
}
