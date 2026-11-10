// Faceplates: each machine's panel follows the instrument it is modelled on
// as closely as SoundLab's own designs allow: panel colour and finish, wood
// or metal cheeks, how sections are marked, the kind of controls (knobs with
// printed scales, rotary selectors, faders, membrane keys), switch types,
// displays and decorative strips. No logos, trademarks or copied artwork:
// the names are SoundLab's own plays on the originals.
import type { Look } from "./ui.ts";

export type Face = {
  tagline: string; // the line under the nameplate
  look: Look; // how controls are drawn
  cheeks?: "walnut" | "oak" | "rosewood" | "metal" | "light-wood";
  texture?: "hammer" | "grain" | "brushed" | "smooth";
  legend?: "line" | "band" | "box"; // how panel sections are labelled
  display?: "lcd" | "led"; // patch display, as on digital synths
  plateFont?: "plate" | "serif" | "label" | "label-italic" | "mono";
  strip?: "steps808" | "steps909" | "jacks"; // decorative bottom strip
  screws?: boolean;
  capFromStripe?: boolean; // fader caps take each section's colour
  stripes?: string[]; // colour per panel section, cycling
  v: Record<string, string>; // CSS variables (see .face in style.css)
};

const base = { bg: "#121212", text: "#f1f1ef", label: "#c9c9c4", line: "#2c2c2c", track: "#333", arc: "#e9e6dc", ptr: "#fff", cap: "#1a1a1a", skirt: "#9a9a9a", btn: "#1d1d1d", btnText: "#d8d8d2", on: "#e9e6dc", onText: "#111", fcap: "#e8e6df" };
const v = (o: Partial<typeof base>) => {
  const x = { ...base, ...o };
  return { "--fp-bg": x.bg, "--fp-text": x.text, "--fp-label": x.label, "--fp-line": x.line, "--fp-track": x.track, "--fp-arc": x.arc, "--fp-ptr": x.ptr, "--fp-cap": x.cap, "--fp-skirt": x.skirt, "--fp-btn": x.btn, "--fp-btn-text": x.btnText, "--fp-on": x.on, "--fp-on-text": x.onText, "--fp-fcap": x.fcap };
};

export const FACES: Record<string, Face> = {
  // Black panel in a wooden case, white legends, bakelite knobs with numbered dials, rotary range and wave switches, rocker switches.
  "ladder-mono": { tagline: "Monophonic analog synthesizer", cheeks: "walnut", texture: "grain", legend: "line", plateFont: "label-italic",
    look: { knob: "moog", scale: true, selectors: true, sw: "rocker" }, stripes: ["#efece3"],
    v: v({ bg: "#121212", ptr: "#f4f2ea", on: "#e9a23b", onText: "#1a1205" }) },
  // Black panel, walnut ends, black knobs with silver caps, square buttons with red LEDs, cream legends in boxed sections.
  "studio-poly": { tagline: "Programmable polyphonic synthesizer", cheeks: "walnut", texture: "grain", legend: "box", plateFont: "plate",
    look: { knob: "silver", scale: true, sw: "led" }, stripes: ["#d9c79a"],
    v: v({ bg: "#0f0f0f", text: "#efe6cf", label: "#d8cba8", ptr: "#1a1a1a", on: "#e2382a" }) },
  // Black panel with wood ends, sliders with white caps, colour-coded sections and push buttons.
  "chorus-poly": { tagline: "Polyphonic synthesizer", cheeks: "walnut", texture: "smooth", legend: "band", plateFont: "plate",
    look: { fader: true, sw: "push", knob: "pointer", scale: true, selectors: false }, stripes: ["#d9472f", "#ee8b2c", "#efc64a", "#e8e5dc", "#5a8fd1"],
    v: v({ bg: "#1a1a1b", on: "#ee8b2c", fcap: "#ecebe6" }) },
  // Black panel, metal ends, sliders, and rows of buttons coloured by section.
  "flagship-poly": { tagline: "Polyphonic synthesizer", cheeks: "metal", texture: "smooth", legend: "band", plateFont: "plate", capFromStripe: true,
    look: { fader: true, sw: "led", knob: "pointer", scale: true }, stripes: ["#f08a25", "#f2c230", "#d8413a", "#e9e6dc", "#3f7bc8"],
    v: v({ bg: "#0d0d0e", on: "#f08a25", fcap: "#e9e6dc" }) },
  // Black panel with blue-boxed sections, silver-capped knobs, LED buttons.
  "multimode-poly": { tagline: "Polyphonic synthesizer", cheeks: "metal", texture: "grain", legend: "box", plateFont: "plate",
    look: { knob: "silver", scale: true, sw: "led" }, stripes: ["#5d8fd0"],
    v: v({ bg: "#14161a", ptr: "#1a1a1a", on: "#5d8fd0", onText: "#fff" }) },
  // Warm brown textured top, rows of sliders with coloured caps, coloured tablet switches.
  "expressive-poly": { tagline: "Polyphonic synthesizer · touch response", cheeks: "rosewood", texture: "hammer", legend: "band", plateFont: "serif", capFromStripe: true,
    look: { fader: true, sw: "tablet", knob: "pointer", scale: true }, stripes: ["#d9433b", "#ee8a2a", "#f1c84a", "#62b16a", "#4b87c9", "#ece5d6"],
    v: v({ bg: "#2b231e", text: "#f2e9d8", label: "#dccdb4", line: "#46392f", btn: "#3a2f27", btnText: "#efe3cc" }) },
  // Black panel, small knobs with white scales, white-boxed sections, a strip of patch jacks.
  "scream-mono": { tagline: "Monophonic synthesizer", texture: "grain", legend: "box", plateFont: "label", strip: "jacks", screws: true,
    look: { knob: "pointer", scale: true, selectors: true, sw: "bat" }, stripes: ["#f4f4f2"],
    v: v({ bg: "#0e0e0e" }) },
  // Brushed silver, black knobs, dark legends.
  "acid-bass": { tagline: "Computer controlled", texture: "brushed", legend: "line", plateFont: "label", screws: true,
    look: { knob: "pointer", scale: true, selectors: true, sw: "push" }, stripes: ["#1b1b1b"],
    v: v({ bg: "linear-gradient(180deg, #d6d8d9, #b3b6b8)", text: "#141414", label: "#1f1f1f", line: "#8e9294", btn: "#2a2a2a", btnText: "#eee", on: "#141414", onText: "#f4f4f4" }) },
  // Dark panel with red accents, rubber knobs, LED buttons, LCD.
  "super-va": { tagline: "Virtual analog synthesizer", texture: "grain", legend: "line", display: "lcd", plateFont: "plate",
    look: { knob: "rubber", scale: true, sw: "led" }, stripes: ["#e0262f"],
    v: v({ bg: "linear-gradient(180deg, #1d1e21, #101113)", ptr: "#e0262f", on: "#e0262f", onText: "#fff" }) },
  // Red panel, white legends, black knobs, LED buttons, LED display.
  "lead-va": { tagline: "Virtual analog synthesizer", texture: "smooth", legend: "line", display: "led", plateFont: "plate",
    look: { knob: "rubber", scale: true, sw: "led" }, stripes: ["#ffffff"],
    v: v({ bg: "#c3122d", text: "#ffffff", label: "#ffe3e7", line: "#9b0d23", ptr: "#ffffff", btn: "#a10f26", btnText: "#ffe9ec", on: "#ffd84d", onText: "#3a0a12" }) },
  // Blue-grey panel, wooden ends, LCD, small knobs.
  "wave-scanner": { tagline: "Wave computer", cheeks: "oak", texture: "hammer", legend: "box", display: "lcd", plateFont: "plate",
    look: { knob: "pointer", scale: true, sw: "led" }, stripes: ["#f0a24a"],
    v: v({ bg: "#2a4260", text: "#eef3f8", label: "#cad8e7", line: "#3c5a7d", btn: "#1c3049", btnText: "#e2ebf4", on: "#f0a24a" }) },
  // Dark brown panel, membrane keys and value cells, LCD.
  "fm-six": { tagline: "Digital programmable algorithm synthesizer", texture: "smooth", legend: "band", display: "lcd", plateFont: "plate",
    look: { cells: true, sw: "membrane" }, stripes: ["#2aa198", "#a73a5c", "#6f8f3c"],
    v: v({ bg: "#2e2a26", text: "#ebe5d9", label: "#d2c9ba", line: "#463f38", btn: "#3b3530", btnText: "#e8e1d4", on: "#a73a5c", onText: "#fff" }) },
  // Navy panel in a wooden case, colourful sections, coloured slider caps, bat toggles, a strip of jacks.
  "west-coast": { tagline: "Music easel", cheeks: "light-wood", texture: "grain", legend: "band", plateFont: "serif", capFromStripe: true, strip: "jacks",
    look: { fader: true, sw: "bat", knob: "pointer", scale: true }, stripes: ["#e3463a", "#f2c03c", "#3f86d4", "#5dbb63", "#f08a2c"],
    v: v({ bg: "#0e1320" }) },
  // Black panel, wooden ends, orange voice tabs, sliders.
  "string-machine": { tagline: "String ensemble", cheeks: "walnut", texture: "smooth", legend: "line", plateFont: "label-italic",
    look: { fader: true, sw: "tablet", knob: "pointer" }, stripes: ["#e07b39"],
    v: v({ bg: "#141312", text: "#f1e9dc", label: "#d9cdb9", on: "#e07b39", onText: "#1a120b", fcap: "#efe7d8" }) },
  // Dark grey, small grey knobs, colour band of step keys underneath.
  "boom-kit": { tagline: "Rhythm composer", texture: "grain", legend: "band", plateFont: "label", strip: "steps808", screws: true,
    look: { knob: "grey", scale: true, sw: "push" }, stripes: ["#e2442b", "#f08a2a", "#f3c64b", "#efe6d0"],
    v: v({ bg: "#2a2a29", ptr: "#111", on: "#f08a2a" }) },
  // Light grey, black knobs, orange labels, white and orange step keys.
  "punch-kit": { tagline: "Rhythm composer", texture: "brushed", legend: "band", plateFont: "label", strip: "steps909", screws: true,
    look: { knob: "pointer", scale: true, sw: "push" }, stripes: ["#f07a1a"],
    v: v({ bg: "linear-gradient(180deg, #dededa, #c7c7c2)", text: "#1c1c1c", label: "#262626", line: "#9e9e99", btn: "#2b2b2b", btnText: "#eee", on: "#f07a1a", onText: "#111" }) },
};
const fallback: Face = { tagline: "", look: {}, v: v({}) };
export const faceOf = (id: string): Face => FACES[id] ?? fallback;
