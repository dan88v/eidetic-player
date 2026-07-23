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
const DEVICE_ENVIRONMENT_KEY = "EIDETIC_REMOVABLE_DEVICE_ID_BASE64";

const SAFE_REMOVE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$EncodedDeviceInstanceId = [Environment]::GetEnvironmentVariable(
  'EIDETIC_REMOVABLE_DEVICE_ID_BASE64',
  'Process'
)
if ([string]::IsNullOrWhiteSpace($EncodedDeviceInstanceId)) {
  throw 'Missing device reference.'
}
$DeviceInstanceId = [Text.Encoding]::UTF8.GetString(
  [Convert]::FromBase64String($EncodedDeviceInstanceId)
)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class EideticCfgMgr32 {
  [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode)]
  public static extern uint CM_Locate_DevNodeW(out uint deviceNode, string deviceId, uint flags);
  [DllImport("cfgmgr32.dll")]
  public static extern uint CM_Get_Parent(out uint parentNode, uint deviceNode, uint flags);
  [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode)]
  public static extern uint CM_Request_Device_EjectW(
    uint deviceNode,
    out uint vetoType,
    StringBuilder vetoName,
    int vetoNameLength,
    uint flags
  );
}
'@
$node = [uint32]0
$located = [EideticCfgMgr32]::CM_Locate_DevNodeW([ref]$node, $DeviceInstanceId, 0)
if ($located -ne 0) {
  [pscustomobject]@{ result = [uint32]$located; vetoType = 0; vetoName = '' } |
    ConvertTo-Json -Compress
  exit 0
}
$parentNode = [uint32]0
$parentResult = [EideticCfgMgr32]::CM_Get_Parent([ref]$parentNode, $node, 0)
if ($parentResult -ne 0) {
  [pscustomobject]@{ result = [uint32]$parentResult; vetoType = 0; vetoName = '' } |
    ConvertTo-Json -Compress
  exit 0
}
$vetoType = [uint32]0
$vetoName = [Text.StringBuilder]::new(260)
$result = [EideticCfgMgr32]::CM_Request_Device_EjectW(
  $parentNode,
  [ref]$vetoType,
  $vetoName,
  $vetoName.Capacity,
  0
)
[pscustomobject]@{
  result = [uint32]$result
  vetoType = [uint32]$vetoType
  vetoName = $vetoName.ToString()
} | ConvertTo-Json -Compress
`;

interface WindowsRemovalResult {
  readonly result?: unknown;
  readonly vetoType?: unknown;
}

function operationError(error: unknown): RemovableMediaOperationError {
  if (
    error &&
    typeof error === "object" &&
    (("killed" in error && error.killed === true) ||
      ("code" in error && error.code === "ETIMEDOUT"))
  )
    return new RemovableMediaOperationError(
      "timeout",
      "Safe removal timed out.",
    );
  return new RemovableMediaOperationError(
    "failed",
    "Unable to safely remove USB storage.",
  );
}

export class WindowsRemovableMediaAdapter implements RemovableMediaAdapter {
  readonly platform = "win32" as const;
  private closed = false;
  private readonly controllers = new Set<AbortController>();

  start(): Promise<void> {
    return Promise.resolve();
  }

  capabilities(target: RemovableMediaTarget): RemovableMediaCapabilities {
    if (this.closed || target.system || target.boot || !target.physicalDevice)
      return noRemovableMediaCapabilities;
    return {
      canMount: false,
      canUnmount: target.mounted,
      canEject: true,
      canSafelyRemove: true,
    };
  }

  mount(): Promise<void> {
    return Promise.reject(
      new RemovableMediaOperationError(
        "unsupported",
        "Mount is not supported on Windows.",
      ),
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
    onState("ejecting");
    const controller = new AbortController();
    this.controllers.add(controller);
    const abort = (): void => {
      controller.abort();
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      const { stdout } = await runFile(
        "powershell.exe",
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          SAFE_REMOVE_SCRIPT,
        ],
        {
          env: {
            ...process.env,
            [DEVICE_ENVIRONMENT_KEY]: Buffer.from(
              target.physicalDevice,
              "utf8",
            ).toString("base64"),
          },
          windowsHide: true,
          timeout: 15_000,
          maxBuffer: 64 * 1024,
          signal: controller.signal,
        },
      );
      const result = JSON.parse(stdout.trim() || "{}") as WindowsRemovalResult;
      const code = Number(result.result);
      const veto = Number(result.vetoType);
      if (code === 0) return;
      if (code === 23 || veto > 0) {
        throw new RemovableMediaOperationError(
          "device-busy",
          "Device is busy.",
        );
      }
      if (code === 51)
        throw new RemovableMediaOperationError(
          "authorization-required",
          "Permission required.",
        );
      if (code === 13 || code === 14)
        throw new RemovableMediaOperationError(
          "device-not-found",
          "USB storage is no longer available.",
        );
      throw new RemovableMediaOperationError(
        "failed",
        "Unable to safely remove USB storage.",
      );
    } catch (error) {
      if (error instanceof RemovableMediaOperationError) throw error;
      throw operationError(error);
    } finally {
      signal.removeEventListener("abort", abort);
      this.controllers.delete(controller);
    }
  }

  close(): Promise<void> {
    this.closed = true;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
    return Promise.resolve();
  }
}
