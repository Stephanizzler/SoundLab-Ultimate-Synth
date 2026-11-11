import { color } from "../core/design.ts";
import { readBundle, writeBundle, problems, owner, BUNDLE_MIME, type Project, type Loudness } from "../core/index.ts";
import { MACHINES, machineById, drumName } from "../machines/index.ts";
import { MIXER_PARAMS, formatParam, type MachineDef, type ParamDef } from "../engine/machine.ts";
import { faceOf } from "./faces.ts";
import {
  CHORDS, DIVISIONS, FX_PARAMS, MOD_PARAMS, PATTERNS, SLOTS, TRACKS, MAX_STEPS, TRACK_OUTPUTS,
  PERFORMANCES, compactState, demoState, destinations, emptyStep, emptyTrack, performanceSlots, sanitizeState, slotParamDefs, slotState, sources,
  type SynthState, type Step, type Track,
} from "../engine/state.ts";
import { APP_ID, describe, midiToTrack, patternToMidi, saveRender, stateFromVersion } from "../engine/projectio.ts";
import { MIDI_MIME } from "../engine/midi.ts";
import { nativeAvailable } from "../engine/native.ts";
import { writeWav } from "../engine/wav.ts";
import { h, $, select, control, knobRegistry, noteName, type Look } from "./ui.ts";
import "@fontsource/michroma/latin-400.css";
import "@fontsource/barlow-condensed/latin-500.css";
import "@fontsource/barlow-condensed/latin-600.css";
import "@fontsource/barlow-condensed/latin-700.css";
import "@fontsource/barlow-condensed/latin-500-italic.css";
import "@fontsource/barlow-condensed/latin-700-italic.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-600.css";
import "@fontsource/cinzel/latin-700.css";
import { zipOne } from "./zipone.ts";
import WORKLET from "./worklet.ts?worklet";
import RenderWorker from "./render-worker.ts?worker&inline";
import type { Tick, ToWorklet } from "./worklet.ts";
import { runRender, type RenderJob, type RenderReply } from "./render-worker.ts";

// The claude.ai viewer refuses confirm() dialogs, so there the action simply goes ahead.
const inViewer = !!(window as unknown as { claude?: unknown }).claude;
const ask = (msg: string) => inViewer || window.confirm(msg);

// Design tokens -> CSS variables, so the page matches the other Pro apps.
for (const [k, v] of Object.entries(color)) document.documentElement.style.setProperty(`--${k}`, v);
const clock = { now: () => new Date().toISOString(), id: () => crypto.randomUUID() };

/* =========================================================================
   State
   ========================================================================= */
const STORE_KEY = "soundlab.synth.session.v1";
function loadSaved(): SynthState | null {
  try { const raw = localStorage.getItem(STORE_KEY); return raw ? sanitizeState(JSON.parse(raw)) : null; } catch { return null; }
}
let state: SynthState = loadSaved() ?? demoState();
const ui = {
  slot: 0, // the slot the keyboard plays and whose panel is open
  open: new Set<number>([0]),
  track: 3, page: 0, lane: "note" as LaneId, armed: null as string | null,
  tick: null as Tick | null,
};
let saveTimer = 0;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify(compactState(state))); } catch { /* storage off: fine */ } }, 400);
}
const pattern = () => state.patterns[state.pattern];
const track = (t = ui.track) => pattern().tracks[t];
// Something structural changed: send the whole state to the audio thread.
function commit() { send({ type: "state", state }); persist(); }

/* =========================================================================
   Audio
   ========================================================================= */
let ac: AudioContext | null = null, node: AudioWorkletNode | null = null, starting: Promise<boolean> | null = null;
function send(m: ToWorklet) { node?.port.postMessage(m); }
async function loadWorklet(ctx: AudioContext) {
  const blob = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
  try { await ctx.audioWorklet.addModule(blob); }
  catch { await ctx.audioWorklet.addModule(`data:text/javascript;base64,${btoa(unescape(encodeURIComponent(WORKLET)))}`); }
  finally { URL.revokeObjectURL(blob); }
}
function ensureAudio(): Promise<boolean> {
  if (node && ac) { if (ac.state !== "running") void ac.resume(); return Promise.resolve(true); }
  starting ??= (async () => {
    try {
      if (!("AudioWorkletNode" in window)) throw new Error("This browser can't run the synth engine (no AudioWorklet).");
      ac = new AudioContext({ latencyHint: "interactive" });
      await loadWorklet(ac);
      node = new AudioWorkletNode(ac, "soundlab-synth", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
      node.connect(ac.destination);
      node.port.onmessage = (e: MessageEvent<Tick>) => onTick(e.data);
      send({ type: "native", on: useNative });
      send({ type: "state", state });
      await ac.resume();
      $("audioNote").textContent = `Audio on · ${(ac.sampleRate / 1000).toFixed(1)} kHz · ${Math.round(((ac.baseLatency || 0) + (ac.outputLatency || 0)) * 1000) || "–"} ms`;
      return true;
    } catch (e) {
      showError(e instanceof Error ? e.message : String(e));
      starting = null;
      return false;
    }
  })();
  return starting;
}

/* =========================================================================
   Transport
   ========================================================================= */
const playBtn = $<HTMLButtonElement>("play");
async function togglePlay() {
  if (!(await ensureAudio())) return;
  const playing = playBtn.getAttribute("aria-pressed") === "true";
  send({ type: playing ? "stop" : "play" });
  setPlaying(!playing);
}
function setPlaying(on: boolean) { playBtn.setAttribute("aria-pressed", String(on)); playBtn.textContent = on ? "■ Stop" : "▶ Play"; }
playBtn.addEventListener("click", togglePlay);
$("panic").addEventListener("click", () => { send({ type: "panic" }); setPlaying(false); });
const bpmIn = $<HTMLInputElement>("bpm"), swingIn = $<HTMLInputElement>("swing");
function syncTransport() {
  bpmIn.value = String(state.bpm); swingIn.value = String(state.swing);
  $("swingOut").textContent = `${Math.round(50 + state.swing * 50)}%`;
  const pats = $("patterns"); pats.replaceChildren();
  for (let p = 0; p < PATTERNS; p++) {
    const used = state.patterns[p].tracks.some((t) => t.steps.some((s) => s.on));
    const b = h("button", { class: `${p === state.pattern ? "on" : ""} ${used ? "used" : ""}`, role: "radio", "aria-checked": String(p === state.pattern), title: `Pattern ${"ABCDEFGH"[p]}${used ? "" : " (empty)"}` }, "ABCDEFGH"[p]);
    b.addEventListener("click", () => choosePattern(p));
    pats.append(b);
  }
}
function choosePattern(p: number) {
  const playing = ui.tick?.playing;
  send({ type: "pattern", index: p });
  if (!playing) { state.pattern = p; renderSeq(); renderPatch(); syncTransport(); persist(); }
  else $("patterns").children[p]?.classList.add("queued");
}
bpmIn.addEventListener("change", () => { state.bpm = Math.min(300, Math.max(30, Number(bpmIn.value) || 120)); bpmIn.value = String(state.bpm); commit(); });
swingIn.addEventListener("input", () => { state.swing = Number(swingIn.value); $("swingOut").textContent = `${Math.round(50 + state.swing * 50)}%`; commit(); });

function onTick(t: Tick) {
  const prev = ui.tick; ui.tick = t;
  if (useNative && !t.native && (!prev || prev.native)) $("engineNote").textContent = "The audio thread couldn't start the C++ engine, so every machine is using TypeScript. They sound the same.";
  if (useNative && t.native && prev && !prev.native) engineNote();
  if (t.playing !== (playBtn.getAttribute("aria-pressed") === "true")) setPlaying(t.playing);
  if (t.pattern !== state.pattern) { state.pattern = t.pattern; renderSeq(); renderPatch(); syncTransport(); }
  else if (prev && prev.queued !== t.queued) syncTransport();
  const lvl = (x: number) => `${Math.max(0, Math.min(100, ((20 * Math.log10(x + 1e-9) + 48) / 48) * 100))}%`;
  $("mL").style.setProperty("--v", lvl(t.peakL)); $("mR").style.setProperty("--v", lvl(t.peakR));
  t.slots.forEach((p, i) => document.querySelector(`#lamp${i}`)?.classList.toggle("on", p > 0.003));
  // Playhead.
  document.querySelectorAll(".step.now").forEach((e) => e.classList.remove("now"));
  if (t.playing) t.pos.forEach((pos, ti) => { if (pos >= 0 && Math.floor(pos / 16) === ui.page) document.querySelector(`#st${ti}_${pos % 16}`)?.classList.add("now"); });
  // Knobs being moved by cables.
  const seen = new Set<string>();
  for (const [unit, idx, v] of t.mods) {
    const defs = unit === "fx" ? FX_PARAMS : unit === "mod" ? MOD_PARAMS : slotParamDefs(state.slots[Number(unit)]?.machine ?? "");
    const key = `${unit === "fx" || unit === "mod" ? unit : `s${unit}`}.${defs[idx]?.id}`;
    seen.add(key); knobRegistry.get(key)?.setMod(v);
  }
  for (const [k, kh] of knobRegistry) if (!seen.has(k)) kh.setMod(null);
}

/* =========================================================================
   1 · Rack
   ========================================================================= */
const machineOptions = [
  { value: "", label: "— Empty —" },
  ...MACHINES.map((m) => ({ value: m.id, label: `${m.name} (after the ${m.inspiredBy.replace(/ \(\d{4}.*\)$/, "")})`, group: m.kind === "drum" ? "Drum machines" : m.kind === "mono" ? "Mono synths" : "Poly synths" })),
];
function setParam(unitKey: string, id: string, v: number) {
  if (unitKey === "fx") state.fx[id] = v; else if (unitKey === "mod") state.mod[id] = v; else state.slots[Number(unitKey)].params[id] = v;
  send({ type: "param", unit: unitKey, id, value: v }); persist();
}
// The Part and Slot output sections are SoundLab's own, so they keep the app's plain controls.
const SOUNDLAB_GROUPS = new Set(["Part", "Slot output"]);
function controlsFor(unitKey: string, keyPrefix: string, defs: ParamDef[], values: Record<string, number>, look: Look = {}) {
  const groups = new Map<string, HTMLElement>();
  const grid = h("div", { class: "groups-grid" });
  for (const d of defs) {
    const g = d.group ?? "";
    if (!groups.has(g)) { const box = h("div", { class: "ctls" }); groups.set(g, box); grid.append(h("fieldset", { class: "grp" }, h("legend", {}, g), box)); }
    const key = `${keyPrefix}.${d.id}`;
    groups.get(g)!.append(control(key, d, values[d.id] ?? d.def, (v) => setParam(unitKey, d.id, v), () => ui.armed !== null, () => patchTo(key), SOUNDLAB_GROUPS.has(g) ? {} : look));
  }
  return grid;
}
function slotUnit(i: number) {
  const s = state.slots[i], m = machineById(s.machine), open = ui.open.has(i) && !!m;
  const mute = h("button", { class: "mini", "aria-pressed": String(s.mute), title: "Mute", disabled: !m }, "M");
  mute.addEventListener("click", () => { s.mute = !s.mute; commit(); renderRack(); });
  const solo = h("button", { class: "mini solo", "aria-pressed": String(s.solo), title: "Solo", disabled: !m }, "S");
  solo.addEventListener("click", () => { s.solo = !s.solo; commit(); renderRack(); });
  const playHere = h("button", { class: "mini", "aria-pressed": String(play.target === "slot" && ui.slot === i), title: "Play this slot from the keyboard", disabled: !m }, "♪");
  playHere.addEventListener("click", () => { ui.slot = i; play.target = "slot"; ui.open.add(i); renderRack(); renderKeys(); });
  const toggle = h("button", { class: "mini", "aria-expanded": String(open), title: open ? "Close panel" : "Open panel", disabled: !m }, open ? "▾" : "▸");
  toggle.addEventListener("click", () => { if (ui.open.has(i)) ui.open.delete(i); else ui.open.add(i); renderRack(); });
  const machineSel = select(machineOptions, s.machine, (v) => changeMachine(i, v), `Slot ${i + 1} machine`); machineSel.classList.add("machine");
  const presetSel = m ? select(m.presets.map((p) => ({ value: p.name, label: p.name })).concat(m.presets.some((p) => p.name === s.preset) ? [] : [{ value: s.preset, label: s.preset || "Custom" }]), s.preset, (v) => applyPreset(i, v), `Slot ${i + 1} preset`) : null;
  presetSel?.classList.add("preset");
  const swatch = m ? h("span", { class: "swatch", "aria-hidden": "true" }) : null;
  if (swatch && m) swatch.style.background = faceOf(m.id).v["--fp-bg"];
  const head = h("div", { class: "uhead" }, h("span", { class: "lamp", id: `lamp${i}`, title: "Sounding" }), h("span", { class: "num" }, String(i + 1)), swatch, machineSel, presetSel, m ? partBadge(s.params) : null, mute, solo, playHere, toggle);
  const unit = h("div", { class: `unit ${ui.slot === i ? "sel" : ""}`, id: `slot${i}` }, head);
  if (open && m) unit.append(faceplate(i, m, s.preset, s.params));
  return unit;
}
// The open panel, dressed as the machine's faceplate (see faces.ts).
function faceplate(i: number, m: MachineDef, preset: string, values: Record<string, number>) {
  const f = faceOf(m.id);
  const body = h("div", { class: `ubody face tex-${f.texture ?? "smooth"} leg-${f.legend ?? "line"} pf-${f.plateFont ?? "plate"} ${f.cheeks ? `cheeks-${f.cheeks}` : ""} ${f.capFromStripe ? "capstripe" : ""}` });
  for (const [k, val] of Object.entries(f.v)) body.style.setProperty(k, val);
  const top = `${String(i + 1).padStart(2, "0")} ${preset || "Init"}`.toUpperCase().slice(0, 18);
  const display = f.display === "lcd" ? h("div", { class: "lcd", "aria-hidden": "true" }, h("span", {}, top), h("span", {}, m.name.toUpperCase().slice(0, 18)))
    : f.display === "led" ? h("div", { class: "led7", "aria-hidden": "true" }, String(i + 1).padStart(2, "0"), h("small", {}, (preset || "Init").slice(0, 14))) : null;
  const screw = () => (f.screws ? h("span", { class: "screw", "aria-hidden": "true" }) : null);
  body.append(h("div", { class: "plate" }, screw(), h("div", { class: "brandbox" }, h("span", { class: "brand" }, m.name), h("span", { class: "tag" }, f.tagline)), display, screw()));
  body.append(h("p", { class: "about" }, h("strong", {}, `Modelled on the ${m.inspiredBy}. `), m.about, " ", h("em", {}, "Not affiliated with or endorsed by the original's maker.")));
  const grid = controlsFor(String(i), `s${i}`, [...m.params, ...MIXER_PARAMS], values, f.look);
  let k = 0;
  grid.querySelectorAll<HTMLFieldSetElement>("fieldset.grp").forEach((fs) => {
    const g = fs.querySelector("legend")?.textContent ?? "";
    if (SOUNDLAB_GROUPS.has(g)) { fs.classList.add("sl"); return; }
    if (f.stripes) fs.style.setProperty("--stripe", f.stripes[k++ % f.stripes.length]);
  });
  body.append(grid);
  // Decorative strips: the drum machines' row of step keys, patch jacks on the semi-modulars.
  if (f.strip === "steps808" || f.strip === "steps909") {
    const cols = f.strip === "steps808" ? ["#e2442b", "#f08a2a", "#f3c64b", "#efe6d0"] : ["#efefea", "#efefea", "#f07a1a", "#efefea"];
    body.append(h("div", { class: "stepstrip", "aria-hidden": "true" }, ...Array.from({ length: 16 }, (_, j) => { const e = h("i", {}); e.style.background = cols[Math.floor(j / 4)]; return e; })));
  } else if (f.strip === "jacks") {
    body.append(h("div", { class: "jackstrip", "aria-hidden": "true" }, ...Array.from({ length: 12 }, () => h("i", {}))));
  }
  return body;
}
// A short note of a slot's part settings when they differ from "every key, any channel".
function partBadge(p: Record<string, number>) {
  const def = (id: string) => MIXER_PARAMS.find((d) => d.id === id)!;
  const bits = [Math.round(p.channel) ? `Ch ${Math.round(p.channel)}` : "", p.keyLo > 0 && p.keyHi < 127 ? `${formatParam(def("keyLo"), p.keyLo)}–${formatParam(def("keyHi"), p.keyHi)}` : p.keyLo > 0 ? `${formatParam(def("keyLo"), p.keyLo)} and up` : p.keyHi < 127 ? `up to ${formatParam(def("keyHi"), p.keyHi)}` : "", p.transpose ? `${p.transpose > 0 ? "+" : ""}${p.transpose} st` : ""].filter(Boolean);
  return bits.length ? h("span", { class: "badge", title: "MIDI channel, key range and transpose (Part section)" }, bits.join(" · ")) : null;
}
function loadPerformance(name: string) {
  const slots = performanceSlots(name);
  if (!slots) return;
  state.slots = slots;
  const valid = new Set(destinations(state).map((d) => d.id));
  state.cables = state.cables.filter((c) => valid.has(c.dst));
  ui.slot = 0; ui.open = new Set([0]); play.target = "rack";
  commit(); renderAll();
  status(`Loaded the performance "${name}". The keyboard now plays the whole rack by MIDI channel.`);
}
function changeMachine(i: number, id: string) {
  state.slots[i] = slotState(id);
  // Cables into knobs the new machine doesn't have are removed.
  const valid = new Set(destinations(state).map((d) => d.id));
  state.cables = state.cables.filter((c) => valid.has(c.dst));
  if (id) { ui.open.add(i); ui.slot = i; }
  // Tracks that played this slot keep playing it; drum kits get drum notes on empty tracks.
  commit(); renderAll();
}
function applyPreset(i: number, name: string) {
  const s = state.slots[i], m = machineById(s.machine), p = m?.presets.find((x) => x.name === name);
  if (!m || !p) return;
  const mixer = Object.fromEntries(MIXER_PARAMS.map((d) => [d.id, s.params[d.id]]));
  s.params = { ...slotState(m.id).params, ...p.values, ...mixer }; s.preset = name;
  commit(); renderRack();
}
function renderRack() {
  knobRegistry.clear();
  const rack = $("rack"); rack.replaceChildren();
  const perf = select([{ value: "", label: "Load a performance (split / layer / multi)…" }, ...PERFORMANCES.map((p) => ({ value: p.name, label: p.name }))], "", (v) => {
    if (v && ask(`${PERFORMANCES.find((p) => p.name === v)?.about}\n\nThis replaces the rack's slots (the patterns stay).`)) loadPerformance(v); else renderRack();
  }, "Performance");
  rack.append(h("div", { class: "row wrap", style: "margin:0 0 4px" }, perf, h("span", { class: "muted small" }, "Every slot is a part with its own MIDI channel, key range and transpose (open a slot: Part), so the rack splits and layers like a Jupiter-8, a Nord Lead or a Virus in Multi mode.")));
  state.slots.forEach((_, i) => rack.append(slotUnit(i)));
  const unitBox = (key: number, title: string, about: string, body: () => HTMLElement) => {
    const open = ui.open.has(key);
    const t = h("button", { class: "mini", "aria-expanded": String(open) }, open ? "▾" : "▸");
    t.addEventListener("click", () => { if (ui.open.has(key)) ui.open.delete(key); else ui.open.add(key); renderRack(); });
    const u = h("div", { class: "unit" }, h("div", { class: "uhead" }, h("span", { class: "lamp" }), h("strong", { style: "flex:1" }, title), t));
    if (open) u.append(h("div", { class: "ubody" }, h("p", { class: "about" }, about), body()));
    return u;
  };
  rack.append(unitBox(100, "Effects & master", "Every slot has delay and reverb sends. The delay follows the tempo. The master limiter keeps sample peaks under −1 dBFS.", () => controlsFor("fx", "fx", FX_PARAMS, state.fx)));
  rack.append(unitBox(101, "Modulators", "Four LFOs (synced to the bar or free-running) and four macro knobs. They do nothing until you patch them in the patch bay.", () => controlsFor("mod", "mod", MOD_PARAMS, state.mod)));
  markPatched();
}

/* =========================================================================
   2 · Sequencer
   ========================================================================= */
type LaneId = "note" | "vel" | "len" | "prob" | "ratchet" | "chord" | "a" | "b" | "flags";
const LANES: { id: LaneId; name: string }[] = [
  { id: "note", name: "Note" }, { id: "vel", name: "Velocity" }, { id: "len", name: "Gate" }, { id: "prob", name: "Chance" },
  { id: "ratchet", name: "Ratchet" }, { id: "chord", name: "Chord" }, { id: "flags", name: "Slide / accent" }, { id: "a", name: "CV A" }, { id: "b", name: "CV B" },
];
const GATES = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16];
const CHORD_SHORT = ["·", "maj", "min", "maj7", "min7", "7", "sus4", "5th", "oct"];
const drumTrack = (tr: Track) => tr.targets.length > 0 && tr.targets.every((i) => machineById(state.slots[i]?.machine)?.kind === "drum");
function noteLabel(tr: Track, n: number) {
  if (drumTrack(tr)) { const m = machineById(state.slots[tr.targets[0]].machine)!; return drumName(m, n) ?? noteName(n); }
  return noteName(n);
}
function seqEdit() { commit(); syncTransport(); }

function renderSeq() {
  const root = $("seq"); root.replaceChildren();
  const pages = h("div", { class: "pages", role: "tablist", "aria-label": "Steps shown" });
  const maxLen = Math.max(...pattern().tracks.map((t) => t.length));
  for (let p = 0; p < MAX_STEPS / 16; p++) {
    const b = h("button", { class: p === ui.page ? "on" : "", disabled: p * 16 >= maxLen, role: "tab", "aria-selected": String(p === ui.page) }, `${p * 16 + 1}–${p * 16 + 16}`);
    b.addEventListener("click", () => { ui.page = p; renderSeq(); });
    pages.append(b);
  }
  const copyTo = select([{ value: "", label: "Copy pattern to…" }, ...Array.from({ length: PATTERNS }, (_, p) => ({ value: String(p), label: `Pattern ${"ABCDEFGH"[p]}` })).filter((o) => Number(o.value) !== state.pattern)], "", (v) => {
    if (v === "") return;
    state.patterns[Number(v)] = structuredClone(pattern()); seqEdit(); renderSeq();
    status(`Pattern ${"ABCDEFGH"[state.pattern]} copied to ${"ABCDEFGH"[Number(v)]}.`);
  }, "Copy pattern");
  root.append(h("div", { class: "seqbar" }, h("strong", {}, `Pattern ${"ABCDEFGH"[state.pattern]}`), pages, copyTo,
    h("span", { class: "muted small" }, "Click a step to turn it on. Each track plays the slots lit in blue (1–8).")));
  const grid = h("div", { class: "tracks-grid" });
  pattern().tracks.forEach((tr, t) => grid.append(trackRow(tr, t)));
  root.append(grid, laneEditor());
}
function trackRow(tr: Track, t: number) {
  const name = h("input", { type: "text", class: "tname", value: tr.name, maxlength: 40, "aria-label": `Track ${t + 1} name` });
  name.addEventListener("change", () => { tr.name = name.value.trim() || `Track ${t + 1}`; persist(); renderPatch(); });
  const targets = h("div", { class: "targets", role: "group", "aria-label": "Plays slots" });
  for (let i = 0; i < SLOTS; i++) {
    const m = machineById(state.slots[i].machine);
    const b = h("button", { "aria-pressed": String(tr.targets.includes(i)), title: m ? `Plays slot ${i + 1}: ${m.name}` : `Slot ${i + 1} is empty`, disabled: !m && !tr.targets.includes(i) }, String(i + 1));
    b.addEventListener("click", () => {
      tr.targets = tr.targets.includes(i) ? tr.targets.filter((x) => x !== i) : [...tr.targets, i].sort();
      const mm = machineById(state.slots[i].machine);
      // A track newly pointed at a drum kit with nothing on it starts on the kick.
      if (mm?.kind === "drum" && tr.targets.length === 1 && !tr.steps.some((s) => s.on)) { tr.note = 36; tr.steps.forEach((s) => (s.note = 36)); }
      seqEdit(); renderSeq();
    });
    targets.append(b);
  }
  const len = select(Array.from({ length: MAX_STEPS }, (_, k) => ({ value: String(k + 1), label: String(k + 1) })), String(tr.length), (v) => { tr.length = Number(v); seqEdit(); renderSeq(); }, "Track length in steps");
  len.classList.add("tlen"); len.title = "Track length in steps";
  const div = select(DIVISIONS.map((d, k) => ({ value: String(k), label: d.name })), String(tr.division), (v) => { tr.division = Number(v); seqEdit(); }, "Step length");
  div.title = "Step length";
  const mute = h("button", { class: "mini", "aria-pressed": String(tr.mute), title: "Mute track" }, "M");
  mute.addEventListener("click", () => { tr.mute = !tr.mute; seqEdit(); renderSeq(); });
  const head = h("div", { class: "thead" }, name, targets, len, div, mute);
  const steps = h("div", { class: "steps" });
  for (let j = 0; j < 16; j++) {
    const k = ui.page * 16 + j, st = tr.steps[k], out = k >= tr.length;
    const b = h("button", {
      id: `st${t}_${j}`, class: `step ${st.on ? "on" : ""} ${st.on && st.vel < 0.6 ? "soft" : ""} ${st.accent && st.on ? "acc" : ""} ${st.slide && st.on ? "sld" : ""} ${out ? "out" : ""}`,
      "aria-pressed": String(st.on), "aria-label": `Track ${t + 1} step ${k + 1}${st.on ? `, ${noteLabel(tr, st.note)}` : ""}`, disabled: out,
      title: st.on ? `${noteLabel(tr, st.note)} · velocity ${Math.round(st.vel * 100)}%` : `Step ${k + 1}`,
    });
    b.addEventListener("click", () => {
      if (ui.armed) return;
      if (!st.on && !tr.steps.some((s) => s.on)) st.note = tr.note;
      st.on = !st.on; ui.track = t; seqEdit(); renderSeq();
      if (st.on && tr.targets.length) previewStep(tr, st);
    });
    steps.append(b);
  }
  const row = h("div", { class: `trow ${t === ui.track ? "sel" : ""}` }, head, steps);
  row.addEventListener("pointerdown", (e) => { if (ui.track !== t && !(e.target as HTMLElement).closest("button.step")) { ui.track = t; renderSeq(); } });
  name.addEventListener("focus", () => { if (ui.track !== t) { ui.track = t; renderLanesOnly(); document.querySelectorAll(".trow").forEach((r, k) => r.classList.toggle("sel", k === t)); } });
  return row;
}
function previewStep(tr: Track, st: Step) {
  if (ui.tick?.playing) return;
  void ensureAudio().then((ok) => {
    if (!ok) return;
    const notes = CHORDS[st.chord].iv.map((iv) => st.note + iv);
    for (const s of tr.targets) for (const n of notes) send({ type: "note", slot: s, note: n, vel: st.vel, on: true });
    setTimeout(() => { for (const s of tr.targets) for (const n of notes) send({ type: "note", slot: s, note: n, vel: 0, on: false }); }, 180);
  });
}
function renderLanesOnly() { const old = document.querySelector(".lanes"); old?.replaceWith(laneEditor()); }
function laneEditor() {
  const tr = track(), wrap = h("div", { class: "lanes" });
  const tabs = h("div", { class: "lanetabs", role: "tablist", "aria-label": `Edit ${tr.name}` });
  for (const l of LANES) {
    const b = h("button", { class: l.id === ui.lane ? "on" : "", role: "tab", "aria-selected": String(l.id === ui.lane) }, l.name);
    b.addEventListener("click", () => { ui.lane = l.id; renderLanesOnly(); });
    tabs.append(b);
  }
  wrap.append(h("div", { class: "row wrap", style: "margin:0 0 6px" }, h("strong", {}, tr.name), h("span", { class: "muted small" }, laneHelp(ui.lane))), tabs);
  wrap.append(ui.lane === "flags" ? flagsLane(tr) : ui.lane === "chord" ? chordLane(tr) : barLane(tr, ui.lane));
  // Track tools.
  const shift = (d: number) => { const n = tr.length; const part = tr.steps.slice(0, n); tr.steps.splice(0, n, ...part.map((_, k) => part[(k - d + n) % n])); seqEdit(); renderSeq(); };
  const transpose = (d: number) => { tr.steps.forEach((s) => (s.note = Math.min(127, Math.max(0, s.note + d)))); tr.note = Math.min(127, Math.max(0, tr.note + d)); seqEdit(); renderSeq(); };
  const btn = (label: string, title: string, fn: () => void) => { const b = h("button", { class: "button small", title }, label); b.addEventListener("click", fn); return b; };
  const midiIn = h("label", { class: "button small", title: "Put a MIDI file's notes on this track" }, "Import .mid…", h("input", { type: "file", accept: ".mid,.midi", hidden: true }));
  midiIn.querySelector("input")!.addEventListener("change", async (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) importMidi(new Uint8Array(await f.arrayBuffer()), f.name); });
  wrap.append(h("div", { class: "tools" },
    btn("◀", "Shift steps left", () => shift(-1)), btn("▶", "Shift steps right", () => shift(1)),
    btn("−12", "Down an octave", () => transpose(-12)), btn("−1", "Down a semitone", () => transpose(-1)), btn("+1", "Up a semitone", () => transpose(1)), btn("+12", "Up an octave", () => transpose(12)),
    btn("Clear track", "Turn every step off and clear CV", () => { tr.steps = tr.steps.map(() => emptyStep(tr.note)); seqEdit(); renderSeq(); }),
    midiIn));
  return wrap;
}
function laneHelp(l: LaneId) {
  return {
    note: "Drag a bar up or down to change its note.", vel: "Draw velocity across the steps.", len: "How long each note is held, in steps.",
    prob: "The chance each step plays. Repeats exactly in renders.", ratchet: "Repeat a step 2–4 times inside its length.",
    chord: "Tap to cycle chord types built on the step's note.", flags: "Slide glides into the next note without retriggering; accent plays harder.",
    a: "Draw a control voltage for the patch bay. Right-click (or long-press) a step to make it hold the previous value.", b: "A second control lane for the patch bay. Right-click (or long-press) to hold.",
  }[l];
}
function barLane(tr: Track, lane: LaneId) {
  const box = h("div", { class: "lane", role: "group", "aria-label": `${lane} lane` });
  const bars: HTMLElement[] = [];
  const valueOf = (s: Step): { n: number; text: string; hold?: boolean } => {
    switch (lane) {
      case "note": return { n: (s.note - 24) / 84, text: noteLabel(tr, s.note).replace(/ .*/, "") };
      case "vel": return { n: s.vel, text: String(Math.round(s.vel * 100)) };
      case "len": { const i = GATES.findIndex((g) => g >= s.len - 1e-6); return { n: (i < 0 ? GATES.length - 1 : i) / (GATES.length - 1), text: String(s.len) }; }
      case "prob": return { n: s.prob, text: `${Math.round(s.prob * 100)}` };
      case "ratchet": return { n: (s.ratchet - 1) / 3, text: `×${s.ratchet}` };
      default: { const v = s[lane as "a" | "b"]; return v === null ? { n: 0, text: "hold", hold: true } : { n: v, text: String(Math.round(v * 100)) }; }
    }
  };
  const draw = (j: number) => {
    const k = ui.page * 16 + j, s = tr.steps[k], b = bars[j], v = valueOf(s);
    b.className = `bar ${lane === "a" || lane === "b" ? "cv" : ""} ${v.hold ? "hold" : ""} ${!s.on && lane !== "a" && lane !== "b" ? "off" : ""} ${k >= tr.length ? "out" : ""}`;
    (b.firstChild as HTMLElement).style.height = `${Math.max(0, Math.min(1, v.n)) * 100}%`;
    (b.lastChild as HTMLElement).textContent = v.text;
  };
  for (let j = 0; j < 16; j++) { const b = h("div", { class: "bar" }, h("i"), h("span")); bars.push(b); box.append(b); }
  bars.forEach((_, j) => draw(j));
  const setFrom = (j: number, y: number) => {
    const k = ui.page * 16 + j, s = tr.steps[k];
    if (!s || k >= tr.length) return;
    const r = box.getBoundingClientRect(), n = Math.max(0, Math.min(1, 1 - (y - r.top) / r.height));
    if (lane === "vel") s.vel = Math.max(0.05, Math.round(n * 20) / 20);
    else if (lane === "len") s.len = GATES[Math.round(n * (GATES.length - 1))];
    else if (lane === "prob") s.prob = Math.round(n * 20) / 20;
    else if (lane === "ratchet") s.ratchet = 1 + Math.round(n * 3);
    else if (lane === "a" || lane === "b") s[lane] = Math.round(n * 100) / 100;
    draw(j);
  };
  const colAt = (x: number) => { const r = box.getBoundingClientRect(); return Math.max(0, Math.min(15, Math.floor(((x - r.left) / r.width) * 16))); };
  let drag: { j: number; y: number; note: number } | null = null, pressTimer = 0;
  box.addEventListener("pointerdown", (e) => {
    box.setPointerCapture(e.pointerId); const j = colAt(e.clientX), s = tr.steps[ui.page * 16 + j];
    if (lane === "note") drag = { j, y: e.clientY, note: s.note };
    else {
      setFrom(j, e.clientY); drag = { j, y: e.clientY, note: 0 };
      if (lane === "a" || lane === "b") pressTimer = window.setTimeout(() => { s[lane] = null; draw(j); drag = null; seqEdit(); }, 600);
    }
  });
  box.addEventListener("pointermove", (e) => {
    if (!drag || !box.hasPointerCapture(e.pointerId)) return;
    if (Math.abs(e.clientY - drag.y) > 4) clearTimeout(pressTimer);
    if (lane === "note") {
      const k = ui.page * 16 + drag.j, s = tr.steps[k]; if (k >= tr.length) return;
      const n = Math.max(0, Math.min(127, drag.note + Math.round((drag.y - e.clientY) / 8)));
      if (n !== s.note) { s.note = n; if (!tr.steps.some((x) => x.on)) tr.note = n; draw(drag.j); }
    } else { const j = colAt(e.clientX); clearTimeout(pressTimer); setFrom(j, e.clientY); }
  });
  const end = () => {
    clearTimeout(pressTimer);
    if (drag) {
      drag = null; seqEdit();
      for (let j = 0; j < 16; j++) { const st = tr.steps[ui.page * 16 + j], el = document.getElementById(`st${ui.track}_${j}`); if (el && st) el.title = st.on ? `${noteLabel(tr, st.note)} · velocity ${Math.round(st.vel * 100)}%` : `Step ${ui.page * 16 + j + 1}`; }
    }
  };
  box.addEventListener("pointerup", end); box.addEventListener("pointercancel", end);
  box.addEventListener("contextmenu", (e) => {
    if (lane !== "a" && lane !== "b") return;
    e.preventDefault(); const j = colAt(e.clientX); tr.steps[ui.page * 16 + j][lane] = null; draw(j); seqEdit();
  });
  if (lane === "note") box.addEventListener("dblclick", (e) => { const j = colAt(e.clientX); const s = tr.steps[ui.page * 16 + j]; if (s) previewStep(tr, s); });
  return box;
}
function flagsLane(tr: Track) {
  const box = h("div", { class: "lane toggles" });
  for (const flag of ["slide", "accent"] as const)
    for (let j = 0; j < 16; j++) {
      const k = ui.page * 16 + j, s = tr.steps[k];
      const b = h("button", { class: flag === "accent" ? "acc" : "", "aria-pressed": String(s[flag]), disabled: k >= tr.length, title: `${flag === "slide" ? "Slide" : "Accent"} on step ${k + 1}` }, flag === "slide" ? "S" : "A");
      b.addEventListener("click", () => { s[flag] = !s[flag]; b.setAttribute("aria-pressed", String(s[flag])); seqEdit(); renderSeq(); });
      box.append(b);
    }
  return box;
}
function chordLane(tr: Track) {
  const box = h("div", { class: "lane toggles" });
  for (let j = 0; j < 16; j++) {
    const k = ui.page * 16 + j, s = tr.steps[k];
    const b = h("button", { "aria-pressed": String(s.chord > 0), disabled: k >= tr.length, title: CHORDS[s.chord].name }, CHORD_SHORT[s.chord]);
    b.addEventListener("click", () => { s.chord = (s.chord + 1) % CHORDS.length; b.textContent = CHORD_SHORT[s.chord]; b.title = CHORDS[s.chord].name; b.setAttribute("aria-pressed", String(s.chord > 0)); seqEdit(); if (s.on) previewStep(tr, s); });
    box.append(b);
  }
  return box;
}
function importMidi(bytes: Uint8Array, name: string, part = 0) {
  try {
    const tr = track(), r = midiToTrack(bytes, tr, { part, bpm: state.bpm });
    pattern().tracks[ui.track] = { ...r.track, targets: tr.targets, division: tr.division, mute: tr.mute, note: r.track.steps.find((s) => s.on)?.note ?? tr.note };
    seqEdit(); renderSeq(); renderPatch();
    const extra = [r.dropped ? `${r.dropped} notes that started on an already-used step were left out (one note per step; use the chord lane for chords)` : "", r.beyond ? `${r.beyond} notes past step 64 were left out` : ""].filter(Boolean).join("; ");
    status(`${name}: ${r.notes} notes placed on ${tr.name} (file tempo ${r.bpm} BPM, snapped to ${DIVISIONS[tr.division].name}).${extra ? ` ${extra}.` : ""}`);
    if (r.parts.length > 1) {
      const box = $("projectBox"); box.hidden = false; box.replaceChildren(h("p", {}, `${name} has ${r.parts.length} parts. Which one goes on ${tr.name}?`),
        select(r.parts.map((p, i) => ({ value: String(i), label: p })), String(part), (v) => importMidi(bytes, name, Number(v)), "MIDI part"));
    }
  } catch (e) { showError(e instanceof Error ? e.message : String(e)); }
}

/* =========================================================================
   3 · Patch bay
   ========================================================================= */
function cableLabel(id: string) { return sources(state).find((s) => s.id === id)?.name ?? id; }
function patchTo(dst: string) {
  if (!ui.armed) return;
  const valid = new Set(destinations(state).map((d) => d.id));
  if (!valid.has(dst)) { showError("That control can't be patched."); return; }
  const existing = state.cables.find((c) => c.src === ui.armed && c.dst === dst);
  if (!existing) {
    if (state.cables.length >= 64) { showError("The patch bay holds 64 cables."); return; }
    state.cables.push({ src: ui.armed, dst, amt: 0.5 });
  }
  status(`Patched ${cableLabel(ui.armed)} → ${destinations(state).find((d) => d.id === dst)?.name}. Set the amount in the patch bay.`);
  disarm(); commit(); renderPatch(); markPatched();
}
function arm(id: string) {
  ui.armed = ui.armed === id ? null : id;
  document.body.classList.toggle("arming", !!ui.armed);
  const bar = $("armBar");
  bar.hidden = !ui.armed;
  if (ui.armed) {
    const cancel = h("button", { class: "button small" }, "Cancel");
    cancel.addEventListener("click", disarm);
    bar.replaceChildren(h("span", {}, "Patching ", h("strong", {}, cableLabel(ui.armed)), ": tap any knob in the rack."), cancel);
    ui.open.add(ui.slot); renderRack();
  }
  document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("armed", (c as HTMLElement).dataset.src === ui.armed));
}
function disarm() { ui.armed = null; document.body.classList.remove("arming"); $("armBar").hidden = true; document.querySelectorAll(".chip.armed").forEach((c) => c.classList.remove("armed")); }
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && ui.armed) disarm(); });
function markPatched() { const on = new Set(state.cables.map((c) => c.dst)); for (const [k, kh] of knobRegistry) kh.setPatched(on.has(k)); }

function renderPatch() {
  const root = $("patch"); root.replaceChildren();
  root.append(h("p", { class: "muted small" }, "Every sequencer track, LFO, macro and controller is a source; every knob in the rack is a destination. Tap a source, then tap a knob. A cable adds to the knob's position; the amount is how far it can turn it (negative turns it down)."));
  const used = new Set(state.cables.map((c) => c.src));
  const chip = (id: string, label: string) => { const c = h("button", { class: `chip ${used.has(id) ? "used" : ""} ${ui.armed === id ? "armed" : ""}`, "data-src": id, title: `Patch ${cableLabel(id)}` }, label); c.addEventListener("click", () => arm(id)); return c; };
  const groups = h("div", { class: "srcgroups" });
  pattern().tracks.forEach((tr, t) => groups.append(h("div", { class: "srcrow" }, h("span", { class: "lbl", title: tr.name }, tr.name), ...TRACK_OUTPUTS.map((o) => chip(`t${t}.${o.id}`, o.name)))));
  groups.append(h("div", { class: "srcrow" }, h("span", { class: "lbl" }, "Modulators"), ...[0, 1, 2, 3].map((k) => chip(`lfo${k}`, `LFO ${k + 1}`)), ...[0, 1, 2, 3].map((k) => chip(`mac${k}`, `Macro ${k + 1}`))));
  groups.append(h("div", { class: "srcrow" }, h("span", { class: "lbl" }, "Controller"), chip("in.wheel", "Mod wheel"), chip("in.vel", "Key velocity"), chip("in.press", "Aftertouch")));
  root.append(groups);
  const srcOpts = sources(state).map((s) => ({ value: s.id, label: s.name, group: s.group }));
  // The chosen destination shows its slot too, since several slots have a "Cutoff".
  const dstOpts = destinations(state).map((d) => ({ value: d.id, label: `${d.id.startsWith("s") ? `${Number(d.id.slice(1, d.id.indexOf("."))) + 1} · ` : d.id.startsWith("fx.") ? "FX · " : "Mod · "}${d.name}`, group: d.group }));
  const list = h("div", { class: "cables" });
  state.cables.forEach((c, i) => {
    const amt = h("input", { type: "range", min: -1, max: 1, step: 0.01, value: String(c.amt), "aria-label": "Amount" });
    const out = h("output", {}, `${Math.round(c.amt * 100)}%`);
    amt.addEventListener("input", () => { c.amt = Number(amt.value); out.textContent = `${Math.round(c.amt * 100)}%`; commit(); });
    amt.addEventListener("dblclick", () => { c.amt = 0; amt.value = "0"; out.textContent = "0%"; commit(); });
    const del = h("button", { class: "mini del", title: "Remove cable", "aria-label": "Remove cable" }, "✕");
    del.addEventListener("click", () => { state.cables.splice(i, 1); commit(); renderPatch(); markPatched(); });
    list.append(h("div", { class: "cable" },
      select(srcOpts, c.src, (v) => { c.src = v; commit(); renderPatch(); }, "Source"), h("span", { class: "arrow" }, "→"),
      select(dstOpts, c.dst, (v) => { c.dst = v; commit(); markPatched(); }, "Destination"), h("div", { class: "amt" }, amt, out), del));
  });
  if (!state.cables.length) list.append(h("p", { class: "muted small" }, "No cables yet."));
  const add = h("button", { class: "button small" }, "+ Add cable");
  add.addEventListener("click", () => {
    const d = dstOpts.find((o) => o.value.startsWith(`s${ui.slot}.`)) ?? dstOpts[0];
    state.cables.push({ src: `t${ui.track}.a`, dst: d.value, amt: 0.5 }); commit(); renderPatch(); markPatched();
  });
  root.append(h("h3", {}, `Cables (${state.cables.length})`), list, h("div", { class: "row" }, add));
}

/* =========================================================================
   4 · Play: on-screen keys, computer keyboard, MIDI
   ========================================================================= */
// The keyboard plays either the selected slot, or the whole rack as MIDI
// channel 1 (so key ranges and layers apply).
const play = { octave: 4, vel: 0.8, down: new Map<number, number>(), midi: null as MIDIAccess | null, input: "", channelMode: "selected", target: "slot" as "slot" | "rack" };
function noteOn(note: number, vel = play.vel, slot: number | null = null, channel = 0) {
  void ensureAudio().then((ok) => {
    if (!ok) return;
    if (slot === null && play.target === "rack") send({ type: "midi", channel, note, vel, on: true });
    else send({ type: "note", slot: slot ?? ui.slot, note, vel, on: true });
  });
  keyEl(note)?.classList.add("down");
}
function noteOff(note: number, slot: number | null = null, channel = 0) {
  if (slot === null && play.target === "rack") send({ type: "midi", channel, note, vel: 0, on: false });
  else send({ type: "note", slot: slot ?? ui.slot, note, vel: 0, on: false });
  keyEl(note)?.classList.remove("down");
}
const keyEl = (n: number) => document.querySelector(`.kbd [data-note="${n}"]`);
function renderKeys() {
  const root = $("keys"); root.replaceChildren();
  const slotSel = select([{ value: "rack", label: "Whole rack (MIDI channel 1: splits and layers)" }, ...state.slots.map((s, i) => ({ value: String(i), label: `${i + 1} · ${machineById(s.machine)?.name ?? "Empty"}` }))], play.target === "rack" ? "rack" : String(ui.slot), (v) => {
    if (v === "rack") play.target = "rack"; else { play.target = "slot"; ui.slot = Number(v); }
    renderRack();
  }, "Keyboard plays");
  const oct = h("output", {}, `C${play.octave}`);
  const octBtn = (d: number, label: string) => { const b = h("button", { class: "button small", title: d < 0 ? "Octave down (Z)" : "Octave up (X)" }, label); b.addEventListener("click", () => { play.octave = Math.max(0, Math.min(8, play.octave + d)); renderKeys(); }); return b; };
  const vel = h("input", { type: "range", min: 0.05, max: 1, step: 0.01, value: String(play.vel), "aria-label": "Velocity" });
  vel.addEventListener("input", () => (play.vel = Number(vel.value)));
  const wheel = h("input", { type: "range", min: 0, max: 1, step: 0.01, value: "0", "aria-label": "Mod wheel" });
  wheel.addEventListener("input", () => send({ type: "control", wheel: Number(wheel.value) }));
  const bend = h("input", { type: "range", min: -2, max: 2, step: 0.01, value: "0", "aria-label": "Pitch bend (springs back)" });
  bend.addEventListener("input", () => send({ type: "control", bend: Number(bend.value) }));
  const spring = () => { bend.value = "0"; send({ type: "control", bend: 0 }); };
  bend.addEventListener("pointerup", spring); bend.addEventListener("change", spring);
  root.append(h("div", { class: "ctrls" }, h("label", {}, "Plays ", slotSel), h("span", {}, octBtn(-1, "◀"), " ", oct, " ", octBtn(1, "▶")),
    h("label", {}, "Velocity ", vel), h("label", {}, "Mod wheel ", wheel), h("label", {}, "Bend ", bend)));
  // Keys: two octaves on phones, three on wider screens.
  const octaves = window.innerWidth < 600 ? 2 : 3, base = play.octave * 12 + 12;
  const kbd = h("div", { class: "kbd", role: "group", "aria-label": "Keyboard" });
  const whites = [0, 2, 4, 5, 7, 9, 11], blacks = [1, 3, 6, 8, 10], whiteCount = octaves * 7 + 1;
  let wi = 0;
  for (let n = base; n <= base + octaves * 12; n++) {
    const pc = n % 12;
    if (whites.includes(pc)) { kbd.append(h("div", { class: "w", "data-note": n }, pc === 0 ? h("span", {}, noteName(n)) : null)); wi++; }
    else if (blacks.includes(pc)) { const left = (wi / whiteCount) * 100 - (0.32 * 100) / whiteCount; kbd.append(h("div", { class: "b", "data-note": n, style: `left:${left}%;width:${(0.64 * 100) / whiteCount}%` })); }
  }
  const pointers = new Map<number, number>();
  const at = (e: PointerEvent) => { const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null; const n = el?.dataset.note; return n ? Number(n) : null; };
  kbd.addEventListener("pointerdown", (e) => {
    e.preventDefault(); kbd.setPointerCapture(e.pointerId); const n = at(e); if (n === null) return;
    const r = (e.target as HTMLElement).getBoundingClientRect(), v = Math.max(0.15, Math.min(1, (e.clientY - r.top) / r.height + 0.2));
    pointers.set(e.pointerId, n); noteOn(n, e.pointerType === "mouse" ? play.vel : v);
  });
  kbd.addEventListener("pointermove", (e) => { if (!pointers.has(e.pointerId)) return; const n = at(e), was = pointers.get(e.pointerId)!; if (n !== null && n !== was) { noteOff(was); noteOn(n); pointers.set(e.pointerId, n); } });
  const up = (e: PointerEvent) => { const n = pointers.get(e.pointerId); if (n !== undefined) { noteOff(n); pointers.delete(e.pointerId); } };
  kbd.addEventListener("pointerup", up); kbd.addEventListener("pointercancel", up);
  root.append(kbd);
  root.append(h("p", { class: "muted small" }, "Computer keys: A W S E D F T G Y H U J K play one octave, Z and X change octave. A MIDI keyboard plays too: ", midiControls()));
}
const KEYMAP = "awsedftgyhujkolp;";
document.addEventListener("keydown", (e) => {
  const t = e.target as HTMLElement;
  if (e.metaKey || e.ctrlKey || e.altKey || t.closest("input, select, textarea")) return;
  if (e.code === "Space" && !t.closest("button")) { e.preventDefault(); void togglePlay(); return; }
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if (k === "z" || k === "x") { play.octave = Math.max(0, Math.min(8, play.octave + (k === "z" ? -1 : 1))); renderKeys(); return; }
  const i = KEYMAP.indexOf(k);
  if (i >= 0) { const n = play.octave * 12 + 12 + i; play.down.set(i, n); noteOn(n); }
});
document.addEventListener("keyup", (e) => { const i = KEYMAP.indexOf(e.key.toLowerCase()); const n = play.down.get(i); if (n !== undefined) { noteOff(n); play.down.delete(i); } });

function midiControls() {
  const span = h("span", {});
  if (!("requestMIDIAccess" in navigator)) { span.textContent = "this browser doesn't offer Web MIDI."; return span; }
  if (!play.midi) {
    const b = h("button", { class: "button small" }, "Connect MIDI");
    b.addEventListener("click", async () => {
      try { play.midi = await navigator.requestMIDIAccess(); play.midi.onstatechange = () => renderKeys(); hookMidi(); renderKeys(); }
      catch { showError("MIDI access was not allowed."); }
    });
    span.append(b); return span;
  }
  const ins = [...play.midi.inputs.values()];
  if (!ins.length) { span.textContent = "no MIDI inputs found."; return span; }
  span.append(
    select([{ value: "", label: "All inputs" }, ...ins.map((i) => ({ value: i.id, label: i.name ?? i.id }))], play.input, (v) => { play.input = v; }, "MIDI input"), " ",
    select([{ value: "selected", label: "Follow the on-screen keyboard's choice" }, { value: "channels", label: "Multitimbral: each slot's MIDI channel" }], play.channelMode, (v) => { play.channelMode = v; }, "MIDI routing"));
  return span;
}
function hookMidi() {
  if (!play.midi) return;
  for (const input of play.midi.inputs.values()) input.onmidimessage = (e: MIDIMessageEvent) => {
    if (play.input && input.id !== play.input) return;
    const d = e.data; if (!d || d.length < 2) return;
    const kind = d[0] & 0xf0, ch = d[0] & 15, multi = play.channelMode === "channels";
    // Multitimbral: the message's channel picks the slots. Otherwise it follows the keyboard's target.
    const on = (n: number, v: number) => { if (multi) { void ensureAudio().then((ok) => ok && send({ type: "midi", channel: ch, note: n, vel: v, on: true })); } else noteOn(n, v); };
    const off = (n: number) => { if (multi) send({ type: "midi", channel: ch, note: n, vel: 0, on: false }); else noteOff(n); };
    if (kind === 0x90 && d[2] > 0) on(d[1], d[2] / 127);
    else if (kind === 0x80 || kind === 0x90) off(d[1]);
    else if (kind === 0xb0 && d[1] === 1) send({ type: "control", wheel: d[2] / 127 });
    else if (kind === 0xe0) send({ type: "control", bend: (((d[2] << 7) | d[1]) - 8192) / 4096 });
    else if (kind === 0xd0) send({ type: "control", press: d[1] / 127 });
    else if (kind === 0xfa) { send({ type: "play" }); setPlaying(true); }
    else if (kind === 0xfc) { send({ type: "stop" }); setPlaying(false); }
  };
}

/* =========================================================================
   5 · Render & save, files and projects
   ========================================================================= */
type Opened = { project: Project; files: Map<string, Uint8Array>; fileName: string; songId: string; basedOn: string };
let opened: Opened | null = null;
let rendered: { mix: { L: Float32Array; R: Float32Array; loudness: Loudness }; stems: { slot: number; L: Float32Array; R: Float32Array }[]; rate: number; bars: number; tail: number; state: SynthState; wav: Uint8Array } | null = null;
const nameIn = $<HTMLInputElement>("name");
nameIn.addEventListener("change", () => { state.name = nameIn.value.trim().slice(0, 80) || "Untitled"; persist(); });

function status(s: string) { $("status").textContent = s; }
function showError(s: string) { const e = $("error"); e.textContent = s; e.hidden = false; setTimeout(() => (e.hidden = true), 8000); }

$("render").addEventListener("click", async () => {
  const bars = Number($<HTMLSelectElement>("bars").value), rate = Number($<HTMLSelectElement>("rate").value), tail = Number($<HTMLSelectElement>("tail").value);
  const stems = $<HTMLInputElement>("stems").checked ? state.slots.map((s, i) => (s.machine && !s.mute ? i : -1)).filter((i) => i >= 0) : [];
  const job: RenderJob = { state: structuredClone(state), rate, bars, tail, stems, native: useNative };
  const prog = $<HTMLProgressElement>("progress"); prog.hidden = false; prog.value = 0;
  ($("render") as HTMLButtonElement).disabled = true; status("Rendering…");
  const done = (r: RenderReply) => {
    prog.hidden = true; ($("render") as HTMLButtonElement).disabled = false;
    if (r.type === "error") { showError(r.message); status(""); return; }
    if (r.type !== "done") return;
    const wav = writeWav([r.mix.L, r.mix.R], rate, 24);
    rendered = { ...r, rate, bars, tail, state: job.state, wav };
    showResult();
  };
  try {
    const w = new RenderWorker();
    w.onmessage = (e: MessageEvent<RenderReply>) => { if (e.data.type === "progress") { prog.value = e.data.value; status(e.data.label); } else { done(e.data); w.terminate(); } };
    w.onerror = () => { w.terminate(); void inPage(); };
    w.postMessage(job);
  } catch { void inPage(); }
  async function inPage() { try { done(runRender(job, (v, l) => { prog.value = v; status(l); })); } catch (e) { done({ type: "error", message: String(e) }); } }
});
function showResult() {
  if (!rendered) return;
  const l = rendered.mix.loudness, secs = rendered.mix.L.length / rendered.rate;
  const dl = $("readouts"); dl.replaceChildren();
  const item = (k: string, v: string) => dl.append(h("div", {}, h("dt", {}, k), h("dd", {}, v)));
  item("Length", `${secs.toFixed(1)} s`); item("Loudness", l.integratedLufs === null ? "silent" : `${l.integratedLufs.toFixed(1)} LUFS`);
  item("True peak", `${l.truePeakDbtp.toFixed(1)} dBTP`); item("Range", l.loudnessRange === null ? "–" : `${l.loudnessRange.toFixed(1)} LU`);
  item("Format", `${rendered.rate / 1000} kHz · 24-bit · stereo`); if (rendered.stems.length) item("Stems", String(rendered.stems.length));
  const player = $<HTMLAudioElement>("player");
  if (player.src) URL.revokeObjectURL(player.src);
  player.src = URL.createObjectURL(new Blob([rendered.wav], { type: "audio/wav" }));
  $("result").hidden = false;
  status(l.truePeakDbtp > -1 ? "Rendered. True peak is above −1 dBTP: lower the master or turn the limiter on before delivery." : "Rendered.");
  $("saveHint").textContent = opened ? `Saves into ${opened.fileName} as a new version${opened.basedOn ? ", based on the version you picked" : ""}.` : "Starts a new project with this render as its first version.";
}
const fileBase = () => (state.name || "Synth").replace(/[\\/:*?"<>|]+/g, "").trim() || "Synth";
$("dlWav").addEventListener("click", () => rendered && download(`${fileBase()}.wav`, rendered.wav, "audio/wav"));
$("dlMidi").addEventListener("click", () => { try { download(`${fileBase()}.mid`, patternToMidi(state, Number($<HTMLSelectElement>("bars").value)), MIDI_MIME); } catch (e) { showError(String((e as Error).message)); } });
$("dlPatch").addEventListener("click", () => download(`${fileBase()}.json`, new TextEncoder().encode(JSON.stringify({ app: APP_ID, ...(compactState(state) as object) }, null, 1)), "application/json"));
$("saveProject").addEventListener("click", () => {
  if (!rendered) return;
  try {
    const r = rendered;
    const midi = (() => { try { return patternToMidi(r.state, r.bars); } catch { return undefined; } })();
    const saved = saveRender(opened?.project ?? null, opened?.files ?? new Map(), clock, {
      state: r.state, mix: r.mix, rate: r.rate, render: { bars: r.bars, sampleRate: r.rate, bitDepth: 24, tail: r.tail, stems: r.stems.length > 0 },
      songId: opened?.songId || undefined, basedOn: opened?.basedOn || undefined, memberId: opened ? owner(opened.project).id : undefined,
      stems: r.stems.map((s) => ({ name: `${s.slot + 1} ${machineById(r.state.slots[s.slot].machine)?.name ?? ""}`, audio: s })), midi,
      description: describe(r.state, { bars: r.bars, sampleRate: r.rate, bitDepth: 24, tail: r.tail, stems: r.stems.length > 0 }),
    });
    const fileName = opened?.fileName ?? `${fileBase()}.soundlab`;
    opened = { project: saved.project, files: saved.files, fileName, songId: saved.songId, basedOn: "" };
    download(fileName, writeBundle(saved.project, saved.files), BUNDLE_MIME);
    status(`Saved ${saved.version.label} into ${fileName}.`);
    renderProjectBox();
  } catch (e) { showError(e instanceof Error ? e.message : String(e)); }
});

// Opening files: projects, patches and MIDI.
$("open").addEventListener("change", async (e) => {
  const input = e.target as HTMLInputElement, f = input.files?.[0]; input.value = "";
  if (!f) return;
  const bytes = new Uint8Array(await f.arrayBuffer());
  try {
    if (/\.(mid|midi)$/i.test(f.name)) { importMidi(bytes, f.name); return; }
    if (/\.json$/i.test(f.name)) { loadState(sanitizeState(JSON.parse(new TextDecoder().decode(bytes)))); status(`Opened patch ${f.name}.`); return; }
    const b = await readBundle(bytes);
    const bad = problems(b.project);
    if (bad.length) throw new Error(`This project can't be opened: ${bad.slice(0, 3).join(" ")}`);
    opened = { project: b.project, files: b.files, fileName: f.name, songId: b.project.songs[0]?.id ?? "", basedOn: "" };
    renderProjectBox();
    status(`Opened ${f.name}.`);
  } catch (err) { showError(err instanceof Error ? err.message : String(err)); }
});
function renderProjectBox() {
  const box = $("projectBox");
  if (!opened) { box.hidden = true; return; }
  const p = opened.project, song = p.songs.find((s) => s.id === opened!.songId);
  box.hidden = false; box.replaceChildren();
  box.append(h("p", {}, h("strong", {}, p.title), ` · ${p.songs.length} song${p.songs.length === 1 ? "" : "s"} · renders are saved as new versions; nothing in the project is changed.`));
  const songSel = select([{ value: "", label: "New song" }, ...p.songs.map((s) => ({ value: s.id, label: s.title }))], opened.songId, (v) => { opened!.songId = v; opened!.basedOn = ""; renderProjectBox(); }, "Song");
  const versions = song?.versions ?? [];
  const verSel = select([{ value: "", label: "Not based on a version" }, ...versions.map((v) => ({ value: v.id, label: `${v.label}${v.source.app === APP_ID ? " (synth)" : ""}` }))], opened.basedOn, (v) => { opened!.basedOn = v; renderProjectBox(); showResult(); }, "Based on");
  box.append(h("div", { class: "row wrap" }, h("label", {}, "Song ", songSel), h("label", {}, "Based on ", verSel)));
  const synthVersions = versions.filter((v) => v.source.app === APP_ID);
  if (synthVersions.length) {
    const pick = select(synthVersions.map((v) => ({ value: v.id, label: v.label })), synthVersions[synthVersions.length - 1].id, () => {}, "Synth version");
    const btn = h("button", { class: "button small" }, "Open its patch");
    btn.addEventListener("click", () => {
      try { const st = stateFromVersion(p, pick.value); if (!st) throw new Error("That version has no saved patch."); loadState(st); opened!.basedOn = pick.value; renderProjectBox(); status("Opened the patch saved with that version. Render and save to make a new version based on it."); }
      catch (e) { showError(e instanceof Error ? e.message : String(e)); }
    });
    box.append(h("div", { class: "row wrap" }, h("span", { class: "small" }, "Reopen a synth version: "), pick, btn));
  }
  const midis = p.assets.filter((a) => a.kind === "midi" && opened!.files.has(a.id));
  if (midis.length) {
    const pick = select(midis.map((a) => ({ value: a.id, label: a.name })), midis[0].id, () => {}, "MIDI file");
    const btn = h("button", { class: "button small" }, `Put on ${track().name}`);
    btn.addEventListener("click", () => importMidi(opened!.files.get(pick.value)!, midis.find((a) => a.id === pick.value)!.name));
    box.append(h("div", { class: "row wrap" }, h("span", { class: "small" }, "MIDI in this project (from SoundLab MIDI Transcript or a DAW): "), pick, btn));
  }
}
function loadState(s: SynthState) {
  state = s; ui.track = Math.min(ui.track, TRACKS - 1); ui.page = 0; ui.slot = Math.max(0, state.slots.findIndex((x) => x.machine));
  send({ type: "stop" }); setPlaying(false); commit(); renderAll();
}
$("newSession").addEventListener("click", () => {
  if (!ask("Start an empty session? The current one is replaced (download its patch first to keep it).")) return;
  const s = demoState();
  s.name = "Untitled"; s.slots = s.slots.map(() => slotState("")); s.slots[0] = slotState("studio-poly"); s.cables = [];
  s.patterns = s.patterns.map(() => ({ tracks: Array.from({ length: TRACKS }, (_, i) => emptyTrack(i, i === 0 ? [0] : [])) }));
  loadState(s);
});
$("demo").addEventListener("click", () => { if (ask("Load the demo session? The current one is replaced.")) loadState(demoState()); });

// Downloads: the claude.ai viewer only saves some file types, so files come zipped there.
type Downloads = { save: (r: { filename: string; data: Uint8Array }) => Promise<unknown> };
const claudeHost = (window as unknown as { claude?: { use: (n: string) => Promise<unknown> } }).claude;
const downloadsReady: Promise<Downloads | null> = claudeHost ? claudeHost.use("downloads").then((d) => d as Downloads | null, () => null) : Promise.resolve(null);
async function download(name: string, bytes: Uint8Array, type: string) {
  const host = await downloadsReady;
  if (host) {
    try { await host.save({ filename: `${name}.zip`, data: zipOne(name, bytes) }); status(`Saved ${name}.zip. Unzip it to get ${name}.`); }
    catch (e) { const code = (e as { code?: string }).code; if (code !== "declined") showError(code === "rate_limited" ? "A save is already waiting for your answer." : "Saving files isn't available in this view."); }
    return;
  }
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/* =========================================================================
   Sound engine: machines ported to C++ run as WebAssembly when this is on
   ========================================================================= */
const ENGINE_KEY = "soundlab.synth.engine";
let useNative = (() => { try { return localStorage.getItem(ENGINE_KEY) !== "ts"; } catch { return true; } })() && nativeAvailable();
const engineSel = $<HTMLSelectElement>("engine");
engineSel.value = useNative ? "native" : "ts";
if (!nativeAvailable()) { engineSel.value = "ts"; engineSel.disabled = true; }
function engineNote() {
  $("engineNote").textContent = !nativeAvailable() ? "This browser can't run the C++ engine, so every machine uses TypeScript."
    : useNative ? `${PORTED.join(", ")} ${PORTED.length === 1 ? "runs" : "run"} in the C++ engine, which plug-ins and apps will use; the other machines still run in TypeScript. Both sound the same.`
    : "Every machine runs in TypeScript.";
}
const PORTED = ["MiniMood Model Q"];
engineSel.addEventListener("change", () => {
  useNative = engineSel.value === "native";
  try { localStorage.setItem(ENGINE_KEY, useNative ? "native" : "ts"); } catch { /* not stored: fine */ }
  send({ type: "native", on: useNative });
  engineNote();
  status(`Sound engine: ${useNative ? "C++ (WebAssembly)" : "TypeScript"}.`);
});
engineNote();

/* ========================================================================= */
function renderAll() { nameIn.value = state.name; syncTransport(); renderRack(); renderSeq(); renderPatch(); renderKeys(); renderProjectBox(); }
renderAll();
let lastWidth = window.innerWidth;
window.addEventListener("resize", () => { if ((window.innerWidth < 600) !== (lastWidth < 600)) renderKeys(); lastWidth = window.innerWidth; });
if ("serviceWorker" in navigator && location.protocol === "https:" && !claudeHost)
  navigator.serviceWorker.register("./sw.js").catch(() => { /* not allowed here */ });
