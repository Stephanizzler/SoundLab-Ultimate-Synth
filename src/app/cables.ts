// What the rack's back view and the patch graph share: the app context they
// edit through, cable colours, and the small popovers for a cable's amount
// and for choosing which knob a cable goes to.
import type { SynthState } from "../engine/state.ts";
import { destinations, sources } from "../engine/state.ts";
import { h, select } from "./ui.ts";

export type PatchCtx = {
  state: () => SynthState;
  commit: () => void; // send the state to the audio thread and record an undo step
  changed: () => void; // re-render whatever shows cables
  status: (s: string) => void;
};

const COLOURS = ["#e8453c", "#f2c230", "#4f8fe0", "#4fc27a", "#e8e4d8", "#e07b39", "#b46be0"];
export const cableColour = (i: number) => COLOURS[i % COLOURS.length];
// Sag like a real patch lead: the longer the cable, the further it hangs.
export function cablePath(x1: number, y1: number, x2: number, y2: number) {
  const sag = 30 + Math.hypot(x2 - x1, y2 - y1) * 0.25;
  return `M ${x1} ${y1} C ${x1} ${y1 + sag}, ${x2} ${y2 + sag}, ${x2} ${y2}`;
}
export const sourceName = (st: SynthState, id: string) => sources(st).find((s) => s.id === id)?.name ?? id;
export function destName(st: SynthState, id: string) {
  const d = destinations(st).find((x) => x.id === id);
  return d ? `${d.group} · ${d.name}` : id;
}

let open: HTMLElement | null = null;
export function closePopover() { open?.remove(); open = null; }
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePopover(); });
document.addEventListener("pointerdown", (e) => { if (open && !open.contains(e.target as Node)) closePopover(); }, true);

function place(el: HTMLElement, x: number, y: number) {
  document.body.append(el);
  const r = el.getBoundingClientRect(), pad = 12;
  el.style.left = `${Math.max(pad, Math.min(window.innerWidth - r.width - pad, x - r.width / 2))}px`;
  el.style.top = `${Math.max(pad, Math.min(window.innerHeight - r.height - pad, y + 12))}px`;
  open = el;
}

// Amount and removal for one cable, opened where it was clicked.
export function cablePopover(ctx: PatchCtx, index: number, x: number, y: number) {
  closePopover();
  const st = ctx.state(), c = st.cables[index];
  if (!c) return;
  const amt = h("input", { type: "range", min: -1, max: 1, step: 0.01, value: String(c.amt), "aria-label": "Amount" });
  const out = h("output", {}, `${Math.round(c.amt * 100)}%`);
  amt.addEventListener("input", () => { c.amt = Number(amt.value); out.textContent = `${Math.round(c.amt * 100)}%`; ctx.commit(); });
  const del = h("button", { class: "button small" }, "Remove cable");
  del.addEventListener("click", () => { st.cables.splice(index, 1); ctx.commit(); ctx.changed(); closePopover(); ctx.status("Cable removed."); });
  const pop = h("div", { class: "popover", role: "dialog", "aria-label": "Cable" },
    h("p", {}, h("strong", {}, sourceName(st, c.src)), " → ", destName(st, c.dst)),
    h("label", { class: "inline" }, "Amount ", amt, out), h("div", { class: "row" }, del));
  place(pop, x, y);
  amt.focus();
}

// Picks a knob of one module (prefix "s3.", "fx." or "mod.") and calls back with its id.
export function chooseKnob(ctx: PatchCtx, prefix: string, title: string, x: number, y: number, pick: (dst: string) => void) {
  closePopover();
  const opts = destinations(ctx.state()).filter((d) => d.id.startsWith(prefix)).map((d) => ({ value: d.id, label: d.name, group: d.def.group }));
  const sel = select([{ value: "", label: "Choose a knob…" }, ...opts], "", (v) => { if (v) { closePopover(); pick(v); } }, "Knob");
  const pop = h("div", { class: "popover", role: "dialog", "aria-label": title }, h("p", {}, h("strong", {}, title)), sel);
  place(pop, x, y);
  sel.focus();
}

// Adds a cable unless the same one exists; returns its index.
export function addCable(ctx: PatchCtx, src: string, dst: string, amt = 0.5) {
  const st = ctx.state();
  let i = st.cables.findIndex((c) => c.src === src && c.dst === dst);
  if (i < 0) {
    if (st.cables.length >= 64) { ctx.status("The patch bay holds 64 cables."); return -1; }
    st.cables.push({ src, dst, amt }); i = st.cables.length - 1;
    ctx.commit(); ctx.changed();
    ctx.status(`Patched ${sourceName(st, src)} → ${destName(st, dst)}. Click the cable to set its amount.`);
  }
  return i;
}
