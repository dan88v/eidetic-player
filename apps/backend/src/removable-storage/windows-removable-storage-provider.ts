import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  RemovableStorageProvider,
  RemovableVolumeCandidate,
} from "./removable-storage-provider.js";

const runFile = promisify(execFile);

const ENUMERATE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$systemDrive = [Environment]::GetEnvironmentVariable('SystemDrive')
$result = @()
Get-CimInstance -Namespace 'root/Microsoft/Windows/Storage' -ClassName MSFT_Disk | Where-Object {
  $_.BusType -eq 7 -and -not $_.IsSystem -and -not $_.IsBoot
} | ForEach-Object {
  $disk = $_
  $physical = Get-CimInstance Win32_DiskDrive -ErrorAction SilentlyContinue |
    Where-Object { $_.Index -eq $disk.Number } |
    Select-Object -First 1
  $physicalIdentity = if ($disk.UniqueId) {
    "disk:$($disk.UniqueId.Trim())"
  } elseif ($physical.PNPDeviceID) {
    "pnp:$($physical.PNPDeviceID)"
  } else {
    "disk-number:$($disk.Number):$($disk.FriendlyName)"
  }
  Get-Partition -DiskNumber $disk.Number -ErrorAction SilentlyContinue | Where-Object {
    $_.DriveLetter
  } | ForEach-Object {
    $partition = $_
    $deviceId = "$($partition.DriveLetter):"
    if ($deviceId -ne $systemDrive) {
      $volume = Get-Volume -DriveLetter $partition.DriveLetter -ErrorAction SilentlyContinue
      $logical = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$deviceId'" -ErrorAction SilentlyContinue
      $root = "$deviceId\"
      $readable = $false
      try {
        Get-ChildItem -LiteralPath $root -Force -ErrorAction Stop | Select-Object -First 1 | Out-Null
        $readable = $true
      } catch {
        try {
          Get-Item -LiteralPath $root -ErrorAction Stop | Out-Null
          $readable = $true
        } catch {}
      }
      $stable = if ($logical.VolumeSerialNumber) {
        "volume:$($logical.VolumeSerialNumber)"
      } elseif ($disk.UniqueId) {
        "disk:$($disk.UniqueId.Trim()):partition:$($partition.PartitionNumber)"
      } else {
        "fallback:$($disk.FriendlyName):partition:$($partition.PartitionNumber):size:$($volume.Size)"
      }
      $name = if ($volume.FileSystemLabel) { $volume.FileSystemLabel } else { "USB Storage" }
      $result += [pscustomobject]@{
        stableIdentity = $stable
        physicalIdentity = $physicalIdentity
        nativeRoot = $root
        displayName = $name
        readable = $readable
        readOnly = [bool]($disk.IsReadOnly -or $partition.IsReadOnly)
        mounted = $true
        system = [bool]$disk.IsSystem
        boot = [bool]$disk.IsBoot
        physicalDevice = $physical.PNPDeviceID
        volumeReference = "disk:$($disk.Number):partition:$($partition.PartitionNumber)"
        filesystemType = $volume.FileSystem
        capacityBytes = $volume.Size
        availableBytes = $volume.SizeRemaining
      }
    }
  }
}
@($result) | ConvertTo-Json -Depth 3 -Compress
`;

interface WindowsVolumeJson {
  readonly stableIdentity?: unknown;
  readonly physicalIdentity?: unknown;
  readonly nativeRoot?: unknown;
  readonly displayName?: unknown;
  readonly readable?: unknown;
  readonly readOnly?: unknown;
  readonly filesystemType?: unknown;
  readonly capacityBytes?: unknown;
  readonly availableBytes?: unknown;
  readonly mounted?: unknown;
  readonly system?: unknown;
  readonly boot?: unknown;
  readonly physicalDevice?: unknown;
  readonly volumeReference?: unknown;
}

function optionalNumber(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

export class WindowsRemovableStorageProvider implements RemovableStorageProvider {
  readonly platform = "win32" as const;

  async enumerate(): Promise<readonly RemovableVolumeCandidate[]> {
    const { stdout } = await runFile(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        ENUMERATE_SCRIPT,
      ],
      {
        windowsHide: true,
        // Storage CIM can briefly serialize behind Windows device discovery.
        // One in-flight enumeration is already coalesced by the service, so a
        // less aggressive timeout avoids false disconnect diagnostics without
        // creating overlapping PowerShell processes.
        timeout: 20_000,
        maxBuffer: 1024 * 1024,
      },
    );
    const parsed = JSON.parse(stdout.trim() || "[]") as
      WindowsVolumeJson | WindowsVolumeJson[];
    return (Array.isArray(parsed) ? parsed : [parsed]).flatMap((value) => {
      if (
        typeof value.stableIdentity !== "string" ||
        typeof value.nativeRoot !== "string" ||
        typeof value.displayName !== "string"
      )
        return [];
      const capacityBytes = optionalNumber(value.capacityBytes);
      const availableBytes = optionalNumber(value.availableBytes);
      return [
        {
          stableIdentity: value.stableIdentity,
          ...(typeof value.physicalIdentity === "string"
            ? { physicalIdentity: value.physicalIdentity }
            : {}),
          nativeRoot: value.nativeRoot,
          displayName: value.displayName.trim() || "USB Storage",
          readable: value.readable === true,
          readOnly: value.readOnly === true,
          mounted: value.mounted === true,
          system: value.system === true,
          boot: value.boot === true,
          ...(typeof value.physicalDevice === "string" &&
          value.physicalDevice.length > 0 &&
          typeof value.volumeReference === "string"
            ? {
                operationReference: {
                  physicalDevice: value.physicalDevice,
                  volume: value.volumeReference,
                },
              }
            : {}),
          ...(typeof value.filesystemType === "string" &&
          value.filesystemType.trim()
            ? { filesystemType: value.filesystemType }
            : {}),
          ...(capacityBytes === undefined ? {} : { capacityBytes }),
          ...(availableBytes === undefined ? {} : { availableBytes }),
        },
      ];
    });
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
