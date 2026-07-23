import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  RemovableStorageProvider,
  RemovableVolumeCandidate,
} from "./removable-storage-provider.js";

const runFile = promisify(execFile);

interface LsblkDevice {
  readonly name?: unknown;
  readonly type?: unknown;
  readonly tran?: unknown;
  readonly mountpoint?: unknown;
  readonly label?: unknown;
  readonly uuid?: unknown;
  readonly serial?: unknown;
  readonly wwn?: unknown;
  readonly fstype?: unknown;
  readonly size?: unknown;
  readonly fsavail?: unknown;
  readonly ro?: unknown;
  readonly children?: unknown;
}

function numberValue(value: unknown): number | undefined {
  const result = typeof value === "number" ? value : Number(value);
  return Number.isFinite(result) && result >= 0 ? result : undefined;
}

export class LinuxRemovableStorageProvider implements RemovableStorageProvider {
  readonly platform = "linux" as const;

  async enumerate(): Promise<readonly RemovableVolumeCandidate[]> {
    const { stdout } = await runFile(
      "lsblk",
      [
        "--json",
        "--bytes",
        "--output",
        "NAME,TYPE,TRAN,MOUNTPOINT,LABEL,UUID,SERIAL,WWN,FSTYPE,SIZE,FSAVAIL,RO",
      ],
      { timeout: 5_000, maxBuffer: 1024 * 1024 },
    );
    const parsed = JSON.parse(stdout) as { readonly blockdevices?: unknown };
    const roots = Array.isArray(parsed.blockdevices)
      ? (parsed.blockdevices as LsblkDevice[])
      : [];
    const result: RemovableVolumeCandidate[] = [];
    const visit = (
      device: LsblkDevice,
      inheritedUsb: boolean,
      inheritedIdentity: string,
    ): void => {
      const isUsb = inheritedUsb || device.tran === "usb";
      const physicalIdentity =
        (typeof device.wwn === "string" && device.wwn) ||
        (typeof device.serial === "string" && device.serial) ||
        inheritedIdentity;
      const mountpoint =
        typeof device.mountpoint === "string" ? device.mountpoint : "";
      const type = typeof device.type === "string" ? device.type : "";
      if (
        isUsb &&
        mountpoint &&
        mountpoint !== "/" &&
        (type === "part" || type === "disk")
      ) {
        const uuid = typeof device.uuid === "string" ? device.uuid : "";
        const name = typeof device.name === "string" ? device.name : "";
        const sizeIdentity =
          typeof device.size === "string" || typeof device.size === "number"
            ? String(device.size)
            : "";
        const stableIdentity = uuid
          ? `uuid:${uuid}`
          : physicalIdentity
            ? `device:${physicalIdentity}:volume:${name}`
            : `fallback:${name}:${sizeIdentity}`;
        const label =
          typeof device.label === "string" ? device.label.trim() : "";
        const capacityBytes = numberValue(device.size);
        const availableBytes = numberValue(device.fsavail);
        result.push({
          stableIdentity,
          nativeRoot: mountpoint,
          displayName: label || "USB Storage",
          readable: true,
          readOnly: device.ro === true || device.ro === 1 || device.ro === "1",
          ...(typeof device.fstype === "string" && device.fstype
            ? { filesystemType: device.fstype }
            : {}),
          ...(capacityBytes === undefined ? {} : { capacityBytes }),
          ...(availableBytes === undefined ? {} : { availableBytes }),
        });
      }
      if (Array.isArray(device.children))
        for (const child of device.children as LsblkDevice[])
          visit(child, isUsb, physicalIdentity);
    };
    for (const root of roots) visit(root, false, "");
    return result;
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
