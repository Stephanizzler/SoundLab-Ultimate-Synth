// The piano roll: the selected track from C1 to C7 (middle C ± 3 octaves).
// Click an empty cell to add a note (notes on one step form a chord), drag a
// note up or down to change it, drag its right edge to set its length, click
// it to remove it. The keyboard on the left plays the note under the pointer.
import { CHORDS, DIVISIONS, type Track } from "../engine/state.ts";
import { h, noteName } from "./ui.ts";

export const ROLL_LOW = 24, ROLL_HIGH = 96; // C1 .. C7
const ROWS = ROLL_HIGH - ROLL_LOW + 1, CELL_H = 14, KEYS_W = 46;
const BLACK = new Set([1, 3, 6, 8, 10]);

export type RollCtx = {
  track: () => Track;
  commit: () => void; // record the edit
  stepsChanged: () => void; // refresh the step grid
  preview: (notes: number[], vel: number) => void;
  status: (s: string) => void;
};

const css = (name: string, fb: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb;

export function renderPianoRoll(ctx: RollCtx, host: HTMLElement) {
  let cellW = 24, playPos = -1;
  const keys = h("canvas", { class: "prkeys", "aria-label": "Piano keys: click to hear a note" });
  const grid = h("canvas", { class: "prgrid", tabindex: 0, "aria-label": "Piano roll grid" });
  const inner = h("div", { class: "prinner" }, keys, grid);
  const scroller = h("div", { class: "prscroll" }, inner);
  const zoom = h("input", { type: "range", min: 12, max: 48, step: 2, value: String(cellW), "aria-label": "Step width" });
  const centre = h("button", { class: "button small" }, "Middle C");
  centre.addEventListener("click", () => scrollToNote(60));
  zoom.addEventListener("input", () => { cellW = Number(zoom.value); draw(); });
  host.replaceChildren(h("div", { class: "row wrap prbar" }, h("strong", { id: "prTitle" }), h("span", { class: "muted small" }, "C1 – C7 · middle C ± 3 octaves. Click to add a note (several on one step make a chord), drag to move or lengthen, click a note to remove it."), centre, h("label", { class: "inline" }, "Zoom", zoom)), scroller);

  const dims = () => { const tr = ctx.track(); return { tr, cols: tr.length, W: tr.length * cellW, H: ROWS * CELL_H }; };
  const rowOf = (note: number) => ROLL_HIGH - note;
  function scrollToNote(n: number) { scroller.scrollTop = rowOf(n) * CELL_H - scroller.clientHeight / 2 + CELL_H / 2; }
  function size(c: HTMLCanvasElement, w: number, hh: number) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.style.width = `${w}px`; c.style.height = `${hh}px`; c.width = Math.round(w * dpr); c.height = Math.round(hh * dpr);
    const g = c.getContext("2d")!; g.setTransform(dpr, 0, 0, dpr, 0, 0); return g;
  }
  function draw() {
    const { tr, cols, W, H } = dims();
    (host.querySelector("#prTitle") as HTMLElement).textContent = tr.name;
    // Keys.
    const k = size(keys, KEYS_W, H);
    for (let r = 0; r < ROWS; r++) {
      const n = ROLL_HIGH - r, black = BLACK.has(n % 12);
      k.fillStyle = black ? "#16181c" : "#dfe2e7"; k.fillRect(0, r * CELL_H, black ? KEYS_W * 0.62 : KEYS_W, CELL_H - 1);
      if (black) { k.fillStyle = "#dfe2e7"; k.fillRect(KEYS_W * 0.62, r * CELL_H, KEYS_W * 0.38, CELL_H - 1); }
      if (n % 12 === 0) { k.fillStyle = "#3a3f48"; k.font = "9px 'JetBrains Mono', monospace"; k.fillText(noteName(n), KEYS_W - 24, r * CELL_H + 10); }
    }
    // Grid.
    const g = size(grid, Math.max(W, 120), H);
    const per = DIVISIONS[tr.division].perBeat;
    g.fillStyle = css("--bg", "#0d0f12"); g.fillRect(0, 0, W, H);
    for (let r = 0; r < ROWS; r++) {
      const n = ROLL_HIGH - r;
      if (BLACK.has(n % 12)) { g.fillStyle = "#ffffff06"; g.fillRect(0, r * CELL_H, W, CELL_H); }
      g.fillStyle = n % 12 === 0 ? "#ffffff22" : "#ffffff0b"; g.fillRect(0, r * CELL_H + CELL_H - 1, W, 1);
    }
    for (let c = 0; c <= cols; c++) { g.fillStyle = c % (per * 4) === 0 ? "#ffffff40" : c % per === 0 ? "#ffffff22" : "#ffffff0d"; g.fillRect(c * cellW, 0, 1, H); }
    // Middle C guide.
    g.fillStyle = "#f5a52422"; g.fillRect(0, rowOf(60) * CELL_H, W, CELL_H);
    const acc = css("--accent", "#f5a524");
    for (let c = 0; c < cols; c++) {
      const st = tr.steps[c];
      if (!st.on) continue;
      const w = Math.max(4, Math.min(st.len, cols - c) * cellW - 2), x = c * cellW + 1;
      const chord = CHORDS[st.chord].iv.slice(1).map((iv) => st.note + iv);
      for (const n of chord) { if (n < ROLL_LOW || n > ROLL_HIGH) continue; g.fillStyle = "#f5a52455"; g.fillRect(x, rowOf(n) * CELL_H + 1, w, CELL_H - 2); }
      for (const n of [st.note, ...st.more]) {
        if (n < ROLL_LOW || n > ROLL_HIGH) continue;
        g.globalAlpha = 0.45 + 0.55 * st.vel; g.fillStyle = acc; g.fillRect(x, rowOf(n) * CELL_H + 1, w, CELL_H - 2); g.globalAlpha = 1;
        g.fillStyle = "#00000055"; g.fillRect(x + w - 3, rowOf(n) * CELL_H + 3, 2, CELL_H - 6); // length handle
      }
    }
    if (playPos >= 0 && playPos < cols) { g.fillStyle = css("--text", "#e8ebf0"); g.fillRect(playPos * cellW, 0, 2, H); }
  }

  // Editing.
  type Drag = { mode: "resize" | "move"; step: number; note: number; startY: number; moved: boolean };
  let drag: Drag | null = null;
  const at = (e: PointerEvent) => { const r = grid.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top; return { x, y, step: Math.floor(x / cellW), note: ROLL_HIGH - Math.floor(y / CELL_H) }; };
  grid.addEventListener("pointerdown", (e) => {
    const { tr } = dims(), p = at(e);
    if (p.step < 0 || p.step >= tr.length || p.note < ROLL_LOW || p.note > ROLL_HIGH) return;
    const st = tr.steps[p.step];
    e.preventDefault(); grid.setPointerCapture(e.pointerId);
    const mine = st.on && (st.note === p.note || st.more.includes(p.note));
    if (mine) {
      const endX = (p.step + Math.min(st.len, tr.length - p.step)) * cellW;
      drag = { mode: endX - p.x < 7 ? "resize" : "move", step: p.step, note: p.note, startY: e.clientY, moved: false };
      return;
    }
    if (st.on && CHORDS[st.chord].iv.slice(1).some((iv) => st.note + iv === p.note)) { ctx.status("That note comes from the chord lane; change it there."); return; }
    if (!st.on) { st.on = true; st.note = p.note; st.more = []; st.len = 1; }
    else if (st.more.length >= 8) { ctx.status("A step holds up to nine notes."); return; }
    else st.more.push(p.note);
    ctx.preview([p.note], st.vel);
    drag = { mode: "resize", step: p.step, note: p.note, startY: e.clientY, moved: true };
    draw();
  });
  grid.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const { tr } = dims(), st = tr.steps[drag.step], p = at(e);
    if (drag.mode === "resize") {
      const len = Math.max(0.25, Math.min(16, Math.round(((p.x - drag.step * cellW) / cellW) * 4) / 4));
      if (len !== st.len) { st.len = len; drag.moved = true; draw(); }
      return;
    }
    const n = Math.max(ROLL_LOW, Math.min(ROLL_HIGH, drag.note + Math.round((drag.startY - e.clientY) / CELL_H)));
    const cur = drag.note;
    if (n === cur || (n !== cur && (st.note === n || st.more.includes(n)))) return;
    if (st.note === cur) st.note = n; else st.more = st.more.map((x) => (x === cur ? n : x));
    drag.note = n; drag.startY = e.clientY; drag.moved = true;
    ctx.preview([n], st.vel); draw();
  });
  const end = () => {
    if (!drag) return;
    const { tr } = dims(), st = tr.steps[drag.step], d = drag; drag = null;
    if (d.mode === "move" && !d.moved) {
      // A click on a note removes it; the lowest remaining note leads the step.
      if (st.note === d.note) {
        if (st.more.length) { const lo = Math.min(...st.more); st.note = lo; st.more = st.more.filter((x) => x !== lo); }
        else st.on = false;
      } else st.more = st.more.filter((x) => x !== d.note);
    }
    // Keep the lowest note as the step's main note.
    if (st.on && st.more.some((x) => x < st.note)) { const all = [st.note, ...st.more].sort((a, b) => a - b); st.note = all[0]; st.more = all.slice(1); }
    ctx.commit(); ctx.stepsChanged(); draw();
  };
  grid.addEventListener("pointerup", end); grid.addEventListener("pointercancel", end);
  keys.addEventListener("pointerdown", (e) => { const r = keys.getBoundingClientRect(); const n = ROLL_HIGH - Math.floor((e.clientY - r.top) / CELL_H); if (n >= ROLL_LOW && n <= ROLL_HIGH) ctx.preview([n], 0.8); });

  draw();
  requestAnimationFrame(() => scrollToNote(ctx.track().steps.find((s) => s.on)?.note ?? 60));
  return {
    redraw: draw,
    playhead(pos: number) { if (pos !== playPos) { playPos = pos; draw(); } },
  };
}
