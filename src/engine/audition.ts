// A short phrase for each preset role, played by the Audition button and by
// the preset audit and calibration (tools/preset-audit.mjs), so a preset is
// judged and levelled the way it is heard. Times in seconds.
import type { PresetRole } from "./machine.ts";

export type Phrase = { notes: number[][]; len: number; gap: number };
export const ROLE_LABELS: Record<PresetRole, string> = {
  bass: "Bass", lead: "Lead", pad: "Pads", strings: "Strings", brass: "Brass", keys: "Keys", organ: "Organ", pluck: "Plucks & sequences", bell: "Bells & mallets", fx: "Effects & noise", kit: "Kits",
};
export const PHRASES: Record<PresetRole, Phrase> = {
  bass: { notes: [[36], [36], [43], [41], [36], [48], [38], [36]], len: 0.22, gap: 0.25 },
  lead: { notes: [[64], [67], [69], [72], [71], [67], [64], [62]], len: 0.3, gap: 0.33 },
  keys: { notes: [[57, 60, 64], [53, 57, 60, 65]], len: 0.6, gap: 0.9 },
  pluck: { notes: [[60], [64], [67], [72], [67], [64]], len: 0.15, gap: 0.25 },
  bell: { notes: [[72], [79], [76]], len: 0.4, gap: 0.9 },
  pad: { notes: [[57, 60, 64, 69]], len: 2.4, gap: 3.2 },
  strings: { notes: [[57, 60, 64, 69]], len: 2.4, gap: 3.2 },
  organ: { notes: [[57, 60, 64, 69]], len: 2.4, gap: 3.2 },
  brass: { notes: [[57, 60, 64], [55, 59, 62]], len: 1.0, gap: 1.4 },
  fx: { notes: [[60], [55]], len: 1.6, gap: 2.2 },
  kit: { notes: [[36], [42], [38], [42], [36], [46], [39], [42]], len: 0.1, gap: 0.25 },
};
