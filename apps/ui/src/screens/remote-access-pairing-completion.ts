import type {
  RemoteAccessDevice,
  RemoteAccessState,
} from "../../../../packages/shared/src/remote-access";

export function completedPairingDevice(
  previous: RemoteAccessState | null,
  next: RemoteAccessState,
): RemoteAccessDevice | null {
  if (!previous?.pairing || next.pairing) return null;
  const previousIds = new Set(previous.devices.map((device) => device.id));
  return next.devices.find((device) => !previousIds.has(device.id)) ?? null;
}
