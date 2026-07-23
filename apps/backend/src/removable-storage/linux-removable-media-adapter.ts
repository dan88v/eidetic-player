import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  noRemovableMediaCapabilities,
  RemovableMediaOperationError,
  type RemovableMediaAdapter,
  type RemovableMediaCapabilities,
  type RemovableMediaTarget,
} from "./removable-media-adapter.js";

const runFile = promisify(execFile);

function mapFailure(error: unknown): RemovableMediaOperationError {
  const record =
    error && typeof error === "object"
      ? (error as { code?: unknown; killed?: unknown; stderr?: unknown })
      : {};
  const detail =
    typeof record.stderr === "string" ? record.stderr.toLowerCase() : "";
  if (record.killed === true || record.code === "ETIMEDOUT")
    return new RemovableMediaOperationError(
      "timeout",
      "USB operation timed out.",
    );
  if (
    detail.includes("not authorized") ||
    detail.includes("authorization") ||
    detail.includes("permission denied")
  )
    return new RemovableMediaOperationError(
      "authorization-required",
      "Permission required.",
    );
  if (detail.includes("busy") || detail.includes("in use"))
    return new RemovableMediaOperationError("device-busy", "Device is busy.");
  if (
    record.code === "ENOENT" ||
    detail.includes("not found") ||
    detail.includes("no such")
  )
    return new RemovableMediaOperationError(
      record.code === "ENOENT" ? "unsupported" : "device-not-found",
      record.code === "ENOENT"
        ? "Safe removal is not supported."
        : "USB storage is no longer available.",
    );
  return new RemovableMediaOperationError(
    "failed",
    "Unable to safely remove USB storage.",
  );
}

export class LinuxRemovableMediaAdapter implements RemovableMediaAdapter {
  readonly platform = "linux" as const;
  private available = false;
  private closed = false;
  private readonly controllers = new Set<AbortController>();

  async start(): Promise<void> {
    try {
      await runFile("udisksctl", ["--version"], {
        timeout: 3_000,
        maxBuffer: 16 * 1024,
      });
      this.available = true;
    } catch {
      this.available = false;
    }
  }

  capabilities(target: RemovableMediaTarget): RemovableMediaCapabilities {
    if (
      this.closed ||
      !this.available ||
      target.system ||
      target.boot ||
      !target.physicalDevice ||
      !target.volume
    )
      return noRemovableMediaCapabilities;
    return {
      canMount: !target.mounted,
      canUnmount: target.mounted,
      canEject: true,
      canSafelyRemove: true,
    };
  }

  async mount(
    target: RemovableMediaTarget,
    signal: AbortSignal,
  ): Promise<void> {
    if (!this.capabilities(target).canMount)
      throw new RemovableMediaOperationError(
        "unsupported",
        "Mount is not supported.",
      );
    await this.run(
      ["mount", "--block-device", target.volume, "--no-user-interaction"],
      signal,
    );
  }

  async safelyRemove(
    targets: readonly RemovableMediaTarget[],
    signal: AbortSignal,
    onState: (state: "unmounting" | "ejecting") => void,
  ): Promise<void> {
    const target = targets[0];
    if (!target || !this.capabilities(target).canSafelyRemove)
      throw new RemovableMediaOperationError(
        "unsupported",
        "Safe removal is not supported.",
      );
    if (
      targets.some(
        (candidate) =>
          candidate.physicalIdentity !== target.physicalIdentity ||
          candidate.system ||
          candidate.boot,
      )
    )
      throw new RemovableMediaOperationError(
        "unsupported",
        "Safe removal is not supported.",
      );
    const mounted = targets
      .filter((candidate) => candidate.mounted)
      .sort((left, right) => left.volume.localeCompare(right.volume));
    if (mounted.length) onState("unmounting");
    for (const volume of mounted)
      await this.run(
        ["unmount", "--block-device", volume.volume, "--no-user-interaction"],
        signal,
      );
    onState("ejecting");
    await this.run(
      [
        "power-off",
        "--block-device",
        target.physicalDevice,
        "--no-user-interaction",
      ],
      signal,
    );
  }

  close(): Promise<void> {
    this.closed = true;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
    return Promise.resolve();
  }

  private async run(
    args: readonly string[],
    signal: AbortSignal,
  ): Promise<void> {
    const controller = new AbortController();
    this.controllers.add(controller);
    const abort = (): void => {
      controller.abort();
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      await runFile("udisksctl", [...args], {
        timeout: 15_000,
        maxBuffer: 64 * 1024,
        signal: controller.signal,
      });
    } catch (error) {
      throw mapFailure(error);
    } finally {
      signal.removeEventListener("abort", abort);
      this.controllers.delete(controller);
    }
  }
}
