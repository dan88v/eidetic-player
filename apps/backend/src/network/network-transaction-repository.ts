import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, posix, win32 } from "node:path";
import type { Ipv4Configuration } from "../../../../packages/shared/src/network.js";
import { resolveAppDirectories } from "../platform/app-directories.js";
import type { AdapterIpv4RollbackState } from "./network-adapter.js";

export interface PendingNetworkTransaction {
  readonly version: 1;
  readonly transactionId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly adapterId: string;
  readonly configuration: Ipv4Configuration;
  readonly rollback: AdapterIpv4RollbackState;
}

export type PendingTransactionRead =
  | { readonly status: "none" }
  | {
      readonly status: "valid";
      readonly transaction: PendingNetworkTransaction;
    }
  | { readonly status: "invalid" };

export function pendingNetworkTransactionPath(
  platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
  home?: string,
): string {
  const platformPath = platform === "win32" ? win32 : posix;
  return platformPath.join(
    resolveAppDirectories(platform, environment, home).config,
    "network-configuration-pending.json",
  );
}

function isConfiguration(value: unknown): value is Ipv4Configuration {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    (record.method === "dhcp" || record.method === "manual") &&
    ["address", "subnetMask", "gateway", "dns1", "dns2"].every(
      (key) => typeof record[key] === "string",
    )
  );
}

function isPending(value: unknown): value is PendingNetworkTransaction {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const rollback = record.rollback as Record<string, unknown> | undefined;
  return (
    record.version === 1 &&
    typeof record.transactionId === "string" &&
    typeof record.createdAt === "string" &&
    typeof record.expiresAt === "string" &&
    typeof record.adapterId === "string" &&
    isConfiguration(record.configuration) &&
    rollback?.version === 1 &&
    typeof rollback.adapterId === "string" &&
    typeof rollback.nativeAdapterId === "string" &&
    isConfiguration(rollback.configuration)
  );
}

export class NetworkTransactionRepository {
  constructor(readonly path = pendingNetworkTransactionPath()) {}

  async read(): Promise<PendingTransactionRead> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.path, "utf8"));
      return isPending(parsed)
        ? { status: "valid", transaction: parsed }
        : { status: "invalid" };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { status: "none" };
      return { status: "invalid" };
    }
  }

  async write(transaction: PendingNetworkTransaction): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${String(process.pid)}-${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(transaction, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, this.path);
    await chmod(this.path, 0o600).catch(() => undefined);
  }

  async remove(): Promise<void> {
    await rm(this.path, { force: true });
  }
}
