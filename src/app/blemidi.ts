// Bluetooth LE MIDI: the standard GATT service that Bluetooth MIDI keyboards
// and controllers offer, read directly with Web Bluetooth (Chrome and Edge on
// desktop and Android). Packets are decoded into ordinary MIDI messages.

export const BLE_MIDI_SERVICE = "03b80e5a-ede8-4b33-a751-6ce34ec4c700";
export const BLE_MIDI_CHARACTERISTIC = "7772e5db-3868-4112-a1a9-f2669d106bf3";

// Data bytes that follow a status byte.
function dataLength(status: number) {
  if (status >= 0xf8) return 0; // real-time
  switch (status & 0xf0) {
    case 0xc0: case 0xd0: return 1;
    case 0xf0: return status === 0xf1 || status === 0xf3 ? 1 : status === 0xf2 ? 2 : 0;
    default: return 2;
  }
}

// One BLE-MIDI packet: a header byte, then for each message a timestamp byte
// (bit 7 set) and a status byte, or data bytes reusing the last status
// (running status). System exclusive is skipped.
export function parseBleMidi(p: Uint8Array): number[][] {
  const out: number[][] = [];
  if (p.length < 2 || !(p[0] & 0x80)) return out;
  let i = 1, status = 0, inSysex = false;
  while (i < p.length) {
    let b = p[i];
    if (inSysex) {
      // Sysex ends with a timestamp byte then 0xF7.
      if (b & 0x80 && p[i + 1] === 0xf7) { inSysex = false; i += 2; continue; }
      i++; continue;
    }
    if (b & 0x80) {
      // Timestamp low byte; a status byte may follow.
      i++;
      if (i >= p.length) break;
      b = p[i];
      if (b & 0x80) {
        if (b === 0xf0) { inSysex = true; i++; continue; }
        if (b >= 0xf8) { out.push([b]); i++; continue; } // real-time messages don't change running status
        status = b; i++;
      }
    }
    if (!status) { i++; continue; }
    const n = dataLength(status), msg = [status];
    for (let k = 0; k < n && i < p.length && !(p[i] & 0x80); k++) msg.push(p[i++]);
    if (msg.length === n + 1) out.push(msg);
    else if (n === 0) out.push(msg);
    else break;
    if (n === 0) status = status >= 0xf0 ? 0 : status;
  }
  return out;
}

type BtDevice = { name?: string; gatt?: { connect(): Promise<BtServer>; disconnect(): void; connected: boolean }; addEventListener(t: string, f: () => void): void };
type BtServer = { getPrimaryService(uuid: string): Promise<{ getCharacteristic(uuid: string): Promise<BtCharacteristic> }> };
type BtCharacteristic = { startNotifications(): Promise<unknown>; addEventListener(t: string, f: (e: Event) => void): void; value?: DataView };

export const bluetoothAvailable = () => typeof navigator !== "undefined" && "bluetooth" in navigator;

// Asks the browser to pick a Bluetooth MIDI device, connects, and passes every
// incoming message to onMessage. Returns the device name and a disconnect function.
export async function connectBleMidi(onMessage: (msg: number[]) => void, onGone: () => void) {
  const bt = (navigator as unknown as { bluetooth: { requestDevice(o: unknown): Promise<BtDevice> } }).bluetooth;
  const device = await bt.requestDevice({ filters: [{ services: [BLE_MIDI_SERVICE] }] });
  const server = await device.gatt!.connect();
  const ch = await (await server.getPrimaryService(BLE_MIDI_SERVICE)).getCharacteristic(BLE_MIDI_CHARACTERISTIC);
  ch.addEventListener("characteristicvaluechanged", (e) => {
    const v = (e.target as unknown as BtCharacteristic).value;
    if (!v) return;
    for (const m of parseBleMidi(new Uint8Array(v.buffer, v.byteOffset, v.byteLength))) onMessage(m);
  });
  await ch.startNotifications();
  device.addEventListener("gattserverdisconnected", onGone);
  return { name: device.name || "Bluetooth MIDI device", disconnect: () => device.gatt?.disconnect() };
}
