// Every machine in the rack, in the order the picker shows them.
import type { MachineDef } from "../engine/machine.ts";
import { minimoog } from "./minimoog.ts";
import { prophet5 } from "./prophet5.ts";
import { juno60 } from "./juno60.ts";
import { jupiter8 } from "./jupiter8.ts";
import { obxa } from "./obxa.ts";
import { cs80 } from "./cs80.ts";
import { ms20 } from "./ms20.ts";
import { tb303 } from "./tb303.ts";
import { virus } from "./virus.ts";
import { nordLead2 } from "./nordlead2.ts";
import { ppg } from "./ppg.ts";
import { dx7 } from "./dx7.ts";
import { buchla } from "./buchla.ts";
import { solina } from "./solina.ts";
import { tr808, tr909 } from "./drums.ts";

export const MACHINES: MachineDef[] = [
  minimoog, prophet5, juno60, jupiter8, obxa, cs80, ms20, tb303,
  virus, nordLead2, ppg, dx7, buchla, solina, tr808, tr909,
];
export const machineById = (id: string) => MACHINES.find((m) => m.id === id);
export { drumName } from "./drums.ts";

// Each preset's calibrated patch level (tools/calibrate-presets.mjs).
import { PRESET_TRIMS } from "./preset-trims.ts";
for (const m of MACHINES) for (const p of m.presets) {
  const t = PRESET_TRIMS[m.id]?.[p.name];
  if (t !== undefined && p.values.patchLevel === undefined) p.values = { ...p.values, patchLevel: t };
}
