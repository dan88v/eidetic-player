import assert from "node:assert/strict";
import test from "node:test";
import type {
  RemoteAccessDevice,
  RemoteAccessState,
} from "../../../packages/shared/src/remote-access";
import { completedPairingDevice } from "../src/screens/remote-access-pairing-completion";

const device: RemoteAccessDevice = {
  id: "remote-device-00000000000000000000000000000001",
  name: "Phone",
  createdAt: "2026-07-31T00:00:00.000Z",
  lastSeenAt: "2026-07-31T00:00:00.000Z",
  expiresAt: "2026-10-29T00:00:00.000Z",
};

function state(
  pairing: RemoteAccessState["pairing"],
  devices: readonly RemoteAccessDevice[],
): RemoteAccessState {
  return {
    available: true,
    enabled: true,
    status: "listening",
    reasonCode: null,
    addresses: ["http://10.0.0.109:8080"],
    hostnameAddress: null,
    pairing,
    devices,
    securityNotice: "",
    readOnly: false,
    revision: 1,
  };
}

void test("completed pairing identifies the newly connected device", () => {
  const pairing = {
    code: "123456",
    displayCode: "123 456",
    expiresAt: "2026-07-31T00:05:00.000Z",
    attemptsRemaining: 5,
  };
  assert.equal(
    completedPairingDevice(state(pairing, []), state(null, [device])),
    device,
  );
  assert.equal(
    completedPairingDevice(state(null, []), state(null, [device])),
    null,
  );
});
