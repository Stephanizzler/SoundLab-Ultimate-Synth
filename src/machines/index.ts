// Every machine in the rack, in the order the picker shows them.
import type { MachineDef } from "../engine/machine.ts";
import { ladderMono, studioPoly, chorusPoly, flagshipPoly, multimodePoly, screamMono, acidBass, superVa, leadVa, waveScanner, expressivePoly } from "./analog.ts";
import { fmSix, westCoast, stringMachine } from "./digital.ts";
import { boomKit, punchKit } from "./drums.ts";

export const MACHINES: MachineDef[] = [
  ladderMono, studioPoly, chorusPoly, flagshipPoly, multimodePoly, expressivePoly, screamMono, acidBass,
  superVa, leadVa, waveScanner, fmSix, westCoast, stringMachine, boomKit, punchKit,
];
export const machineById = (id: string) => MACHINES.find((m) => m.id === id);
export { drumName } from "./drums.ts";
