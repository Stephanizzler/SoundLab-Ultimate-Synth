// Faceplates: each machine's panel is dressed to evoke the instrument it is
// modelled on (panel colour, materials, section colour bands, knob caps,
// switch colours, an LCD where there was one). They are SoundLab's own
// designs: no logos, artwork or exact layouts are copied, and the names are
// SoundLab's own plays on the originals.

export type Face = {
  tagline: string; // the line under the nameplate
  cheeks?: "walnut" | "oak" | "rosewood" | "metal" | "light-wood"; // end cheeks
  lcd?: boolean; // a two-line display showing the patch, as on digital synths
  stripes?: string[]; // colour band per panel section, cycling
  font?: string;
  plate?: "italic" | "wide" | "mono" | "script" | "stencil";
  v: Record<string, string>; // CSS variables (see .face in style.css)
};

const dark = { bg: "#121212", text: "#f1f1ef", label: "#c9c9c4", line: "#2c2c2c", track: "#333", arc: "#e9e6dc", ptr: "#fff", cap: "#1a1a1a", skirt: "#9a9a9a", btn: "#1d1d1d", btnText: "#d8d8d2", on: "#e9e6dc", onText: "#111" };
const v = (o: Partial<typeof dark>) => {
  const x = { ...dark, ...o };
  return { "--fp-bg": x.bg, "--fp-text": x.text, "--fp-label": x.label, "--fp-line": x.line, "--fp-track": x.track, "--fp-arc": x.arc, "--fp-ptr": x.ptr, "--fp-cap": x.cap, "--fp-skirt": x.skirt, "--fp-btn": x.btn, "--fp-btn-text": x.btnText, "--fp-on": x.on, "--fp-on-text": x.onText };
};
const HELV = '"Helvetica Neue", Helvetica, Arial, sans-serif';

export const FACES: Record<string, Face> = {
  "ladder-mono": { tagline: "Monophonic analog synthesizer", cheeks: "walnut", plate: "italic", font: HELV,
    stripes: ["#e9e6dc"], v: v({ bg: "#141414", skirt: "#b9b9b4", on: "#f0ece0", arc: "#f0ece0" }) },
  "studio-poly": { tagline: "Programmable polyphonic synthesizer", cheeks: "walnut", plate: "wide", font: HELV,
    stripes: ["#d7c08a"], v: v({ bg: "#101010", text: "#efe6cf", label: "#d4c9ab", arc: "#d7c08a", on: "#d63a2b", onText: "#fff", skirt: "#3a3a3a" }) },
  "chorus-poly": { tagline: "Polyphonic synthesizer · six voices", plate: "wide", font: HELV,
    stripes: ["#d9472f", "#ee8b2c", "#efc64a", "#e8e5dc", "#5a8fd1"], v: v({ bg: "#1b1b1c", arc: "#ee8b2c", on: "#ee8b2c", skirt: "#555" }) },
  "flagship-poly": { tagline: "Eight-voice polyphonic synthesizer", plate: "wide", font: HELV,
    stripes: ["#f08a25", "#f2c230", "#d8413a", "#e9e6dc", "#3f7bc8"], v: v({ bg: "#0e0e0f", arc: "#f2c230", on: "#f08a25", skirt: "#444" }) },
  "multimode-poly": { tagline: "Polyphonic synthesizer", cheeks: "metal", plate: "stencil", font: HELV,
    stripes: ["#4f86c6"], v: v({ bg: "#15181d", arc: "#8fb5e6", on: "#4f86c6", onText: "#fff", skirt: "#7c8796" }) },
  "expressive-poly": { tagline: "Polyphonic synthesizer · touch sensitive", cheeks: "rosewood", plate: "italic", font: HELV,
    stripes: ["#d9433b", "#ee8a2a", "#f1c84a", "#62b16a", "#4b87c9", "#ece5d6"], v: v({ bg: "#2a221d", text: "#f2e9d8", label: "#d9cbb3", line: "#45392f", track: "#4a3d33", arc: "#f1c84a", cap: "#1d1612", skirt: "#8a7660", btn: "#3a2f27", btnText: "#efe3cc" }) },
  "scream-mono": { tagline: "Monophonic synthesizer · patchable", plate: "mono", font: HELV,
    stripes: ["#f4f4f2"], v: v({ bg: "#0f0f0f", arc: "#f4f4f2", skirt: "#2a2a2a", cap: "#060606" }) },
  "acid-bass": { tagline: "Computer controlled bass line", plate: "mono", font: HELV,
    stripes: ["#1b1b1b"], v: v({ bg: "linear-gradient(180deg, #d4d6d7, #b4b7b9)", text: "#141414", label: "#262626", line: "#8e9294", track: "#9a9ea1", arc: "#141414", ptr: "#f4f4f4", cap: "#151515", skirt: "#6e7275", btn: "#2a2a2a", btnText: "#eee", on: "#141414", onText: "#f4f4f4" }) },
  "super-va": { tagline: "Virtual analog synthesizer · 16 parts", lcd: true, plate: "wide", font: HELV,
    stripes: ["#e0262f"], v: v({ bg: "linear-gradient(180deg, #1c1d20, #0f1012)", arc: "#e0262f", on: "#e0262f", onText: "#fff", skirt: "#5c5f66", cap: "#222428" }) },
  "lead-va": { tagline: "Virtual analog lead synthesizer", lcd: true, plate: "wide", font: HELV,
    stripes: ["#ffffff"], v: v({ bg: "#c3122d", text: "#ffffff", label: "#ffe2e6", line: "#9b0d23", track: "#8c0b1f", arc: "#ffffff", ptr: "#ffffff", cap: "#1a1a1a", skirt: "#3a0a12", btn: "#a10f26", btnText: "#ffe9ec", on: "#ffffff", onText: "#c3122d" }) },
  "wave-scanner": { tagline: "Wave computer · wavetable synthesizer", cheeks: "oak", lcd: true, plate: "stencil", font: HELV,
    stripes: ["#f0a24a"], v: v({ bg: "#253c58", text: "#eef3f8", label: "#c7d6e6", line: "#355273", track: "#2f4a69", arc: "#f0a24a", cap: "#14212f", skirt: "#8aa3bd", btn: "#1c3049", btnText: "#e2ebf4", on: "#f0a24a" }) },
  "fm-six": { tagline: "Digital programmable algorithm synthesizer", lcd: true, plate: "wide", font: HELV,
    stripes: ["#2aa198", "#a73a5c"], v: v({ bg: "#2e2a26", text: "#ebe5d9", label: "#cfc6b6", line: "#463f38", track: "#4a433c", arc: "#2aa198", cap: "#1f1c19", skirt: "#5a524a", btn: "#3b3530", btnText: "#e8e1d4", on: "#a73a5c", onText: "#fff" }) },
  "west-coast": { tagline: "Music easel · complex waveform generator", cheeks: "light-wood", plate: "script", font: '"Avenir Next", "Segoe UI", Arial, sans-serif',
    stripes: ["#e3463a", "#f2c03c", "#3f86d4", "#5dbb63", "#f08a2c"], v: v({ bg: "#0d111a", arc: "#f2c03c", on: "#3f86d4", onText: "#fff", skirt: "#3a4252", cap: "#060910" }) },
  "string-machine": { tagline: "String ensemble", cheeks: "walnut", plate: "italic", font: HELV,
    stripes: ["#e07b39"], v: v({ bg: "#161514", text: "#f1e9dc", label: "#d8ccb8", arc: "#e07b39", on: "#e07b39", onText: "#1a120b", skirt: "#5a5048" }) },
  "boom-kit": { tagline: "Rhythm composer · analog drums", plate: "wide", font: HELV,
    stripes: ["#e2442b", "#f08a2a", "#f3c64b", "#efe6d0"], v: v({ bg: "linear-gradient(180deg, #2b2b2b 0 72%, #1c1c1c 72%)", arc: "#f08a2a", cap: "#8c8c8a", skirt: "#5c5c5a", ptr: "#111", on: "#f08a2a" }) },
  "punch-kit": { tagline: "Rhythm composer · analog and digital drums", plate: "wide", font: HELV,
    stripes: ["#f07a1a"], v: v({ bg: "linear-gradient(180deg, #dcdcd8, #c6c6c1)", text: "#1c1c1c", label: "#2c2c2c", line: "#9e9e99", track: "#a8a8a3", arc: "#f07a1a", ptr: "#f4f4f4", cap: "#2b2b2b", skirt: "#777", btn: "#2b2b2b", btnText: "#eee", on: "#f07a1a", onText: "#111" }) },
};
export const faceOf = (id: string): Face => FACES[id] ?? { tagline: "", v: v({}) };
