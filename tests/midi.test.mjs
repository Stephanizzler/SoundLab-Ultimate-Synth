// Bluetooth LE MIDI packet decoding (the BLE-MIDI specification's layout).
import assert from "node:assert/strict";
const { parseBleMidi } = await import("../src/app/blemidi.ts");
const P = (...b) => new Uint8Array(b);
// header, timestamp, note on C4 velocity 100
assert.deepEqual(parseBleMidi(P(0x80, 0x80, 0x90, 60, 100)), [[0x90, 60, 100]]);
// two messages, each with its own timestamp
assert.deepEqual(parseBleMidi(P(0x80, 0x81, 0x90, 60, 100, 0x82, 0x80, 60, 0)), [[0x90, 60, 100], [0x80, 60, 0]]);
// running status: further data bytes reuse the last status, with or without a new timestamp
assert.deepEqual(parseBleMidi(P(0x80, 0x80, 0xb0, 74, 10, 74, 20, 0x85, 74, 30)), [[0xb0, 74, 10], [0xb0, 74, 20], [0xb0, 74, 30]]);
// program change (one data byte), pitch bend, channel pressure
assert.deepEqual(parseBleMidi(P(0x80, 0x80, 0xc2, 5, 0x80, 0xe0, 0, 64, 0x80, 0xd1, 90)), [[0xc2, 5], [0xe0, 0, 64], [0xd1, 90]]);
// real-time clock between messages doesn't break running status
assert.deepEqual(parseBleMidi(P(0x80, 0x80, 0x90, 60, 100, 0x81, 0xf8, 0x82, 62, 100)), [[0x90, 60, 100], [0xf8], [0x90, 62, 100]]);
// system exclusive is skipped, and what follows still decodes
assert.deepEqual(parseBleMidi(P(0x80, 0x80, 0xf0, 0x7e, 0x01, 0x02, 0x81, 0xf7, 0x82, 0x90, 64, 90)), [[0x90, 64, 90]]);
// junk and truncated packets give nothing rather than throwing
assert.deepEqual(parseBleMidi(P(0x00, 0x90, 60)), []);
assert.deepEqual(parseBleMidi(P(0x80, 0x80, 0x90, 60)), []);
assert.deepEqual(parseBleMidi(P(0x80)), []);
console.log("Bluetooth MIDI tests passed");
