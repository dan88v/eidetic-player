import { access, chmod, mkdir, readdir, rm } from "node:fs/promises";
import { posix, win32 } from "node:path";
import { resolveAppDirectories } from "../platform/app-directories.js";
import { runBoundedProcess } from "../network/bounded-process.js";
import type {
  SmbAdapterConnection,
  SmbConnectionRecord,
  SmbCredential,
} from "./smb-types.js";
import { SmbError } from "./smb-types.js";

export interface SmbPlatformAdapter {
  connect(
    record: SmbConnectionRecord,
    credential: SmbCredential | null,
  ): Promise<SmbAdapterConnection>;
  disconnect(record: SmbConnectionRecord, root?: string): Promise<void>;
  close(): Promise<void>;
}

const windowsConnectionScript = String.raw`
$ErrorActionPreference = "Stop"
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class EideticNetwork {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct NETRESOURCE {
    public UInt32 Scope; public UInt32 Type; public UInt32 DisplayType; public UInt32 Usage;
    public string LocalName; public string RemoteName; public string Comment; public string Provider;
  }
  [DllImport("mpr.dll", EntryPoint="WNetAddConnection2W", CharSet=CharSet.Unicode)]
  public static extern UInt32 Add(ref NETRESOURCE resource, string password, string username, UInt32 flags);
  [DllImport("mpr.dll", EntryPoint="WNetCancelConnection2W", CharSet=CharSet.Unicode)]
  public static extern UInt32 Cancel(string name, UInt32 flags, bool force);
}
"@
if ($request.action -eq "connect") {
  $resource=New-Object EideticNetwork+NETRESOURCE
  $resource.Type=1; $resource.RemoteName=[string]$request.root; $resource.LocalName=$null
  $username=if ($null -eq $request.username) {$null} else {[string]$request.username}
  $password=if ($null -eq $request.password) {$null} else {[string]$request.password}
  $code=[EideticNetwork]::Add([ref]$resource,$password,$username,0)
  @{code=$code} | ConvertTo-Json -Compress
} elseif ($request.action -eq "disconnect") {
  $code=[EideticNetwork]::Cancel([string]$request.root,0,$false)
  @{code=$code} | ConvertTo-Json -Compress
} else { throw "invalid action" }
`;

function windowsError(code: number): SmbError {
  if (code === 5)
    return new SmbError("access-denied", "Access to this share was denied.");
  if (code === 53)
    return new SmbError("host-not-found", "The SMB server was not found.");
  if (code === 67)
    return new SmbError("share-not-found", "The SMB share was not found.");
  if (code === 86 || code === 1326)
    return new SmbError(
      "authentication-required",
      "The SMB credentials were not accepted.",
    );
  if (code === 1219)
    return new SmbError(
      "credential-conflict",
      "This server is already connected with different credentials.",
    );
  if (code === 1200 || code === 1222)
    return new SmbError(
      "network-unavailable",
      "The network share is unavailable.",
    );
  return new SmbError("generic-failure", "Unable to connect to this share.");
}

export class WindowsSmbAdapter implements SmbPlatformAdapter {
  private readonly roots = new Set<string>();

  async connect(
    record: SmbConnectionRecord,
    credential: SmbCredential | null,
  ): Promise<SmbAdapterConnection> {
    const root = `\\\\${record.server}\\${record.share}`;
    const identity =
      record.authMode === "guest"
        ? null
        : [record.domain, credential?.username ?? record.username]
            .filter(Boolean)
            .join("\\");
    const result = await runBoundedProcess(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        windowsConnectionScript,
      ],
      {
        input: JSON.stringify({
          action: "connect",
          root,
          username: identity,
          password: credential?.password ?? null,
        }),
        timeoutMs: 12_000,
      },
    ).catch((error: unknown) => {
      throw new SmbError(
        "timeout",
        error instanceof Error && error.message.includes("timed out")
          ? "The SMB connection timed out."
          : "The Windows SMB helper is unavailable.",
      );
    });
    let payload: { readonly code?: unknown };
    try {
      payload = JSON.parse(result.stdout.trim()) as { readonly code?: unknown };
    } catch {
      throw new SmbError(
        "generic-failure",
        "The Windows SMB helper returned an invalid response.",
      );
    }
    const code = Number(payload.code ?? -1);
    if (result.exitCode !== 0 || (code !== 0 && code !== 85))
      throw windowsError(code);
    this.roots.add(root.toLocaleLowerCase("en"));
    await access(root).catch(() => {
      throw new SmbError(
        "access-denied",
        "The SMB share root is not readable.",
      );
    });
    await readdir(root).catch(() => {
      throw new SmbError(
        "access-denied",
        "The SMB share root is not readable.",
      );
    });
    return { root };
  }

  async disconnect(record: SmbConnectionRecord): Promise<void> {
    const root = `\\\\${record.server}\\${record.share}`;
    const key = root.toLocaleLowerCase("en");
    if (!this.roots.has(key)) return;
    await runBoundedProcess(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        windowsConnectionScript,
      ],
      {
        input: JSON.stringify({ action: "disconnect", root }),
        timeoutMs: 8_000,
      },
    ).catch(() => undefined);
    this.roots.delete(key);
  }

  close(): Promise<void> {
    this.roots.clear();
    return Promise.resolve();
  }
}

export class LinuxSmbAdapter implements SmbPlatformAdapter {
  private readonly mounted = new Map<string, string>();

  constructor(
    readonly runtimeRoot = posix.join(
      resolveAppDirectories("linux").runtime,
      "smb",
    ),
  ) {}

  async connect(
    record: SmbConnectionRecord,
    credential: SmbCredential | null,
  ): Promise<SmbAdapterConnection> {
    const root = posix.join(this.runtimeRoot, record.id);
    await mkdir(root, { recursive: true, mode: 0o700 });
    await chmod(root, 0o700);
    const options = ["ro", "nosuid", "nodev", "noexec"];
    if (record.authMode === "guest") options.push("guest");
    else {
      if (!credential?.filePath) {
        await rm(root, { recursive: false, force: true }).catch(
          () => undefined,
        );
        throw new SmbError(
          "authentication-required",
          "SMB credentials are required.",
        );
      }
      options.push(`credentials=${credential.filePath}`);
    }
    const result = await runBoundedProcess(
      "mount",
      [
        "-t",
        "cifs",
        `//${record.server}/${record.share}`,
        root,
        "-o",
        options.join(","),
      ],
      { timeoutMs: 15_000 },
    ).catch((error: unknown) => {
      if (
        (error as NodeJS.ErrnoException).code === "ENOENT" ||
        (error instanceof Error && error.message.includes("ENOENT"))
      )
        throw new SmbError("unsupported", "CIFS support is unavailable.");
      throw new SmbError(
        "timeout",
        error instanceof Error && error.message.includes("timed out")
          ? "The SMB mount timed out."
          : "The CIFS mount helper is unavailable.",
      );
    });
    if (result.exitCode !== 0) {
      await rm(root, { recursive: false, force: true }).catch(() => undefined);
      const output = `${result.stdout}\n${result.stderr}`.toLowerCase();
      if (output.includes("permission") || output.includes("not permitted"))
        throw new SmbError(
          "permission-required",
          "Permission is required to mount this share.",
        );
      if (output.includes("not found") || output.includes("unknown filesystem"))
        throw new SmbError("unsupported", "CIFS support is unavailable.");
      throw new SmbError("generic-failure", "Unable to mount this share.");
    }
    await readdir(root).catch(() => {
      throw new SmbError(
        "access-denied",
        "The SMB share root is not readable.",
      );
    });
    this.mounted.set(record.id, root);
    return { root };
  }

  async disconnect(record: SmbConnectionRecord, root?: string): Promise<void> {
    const mountPoint = root ?? this.mounted.get(record.id);
    if (!mountPoint) return;
    await runBoundedProcess("umount", [mountPoint], {
      timeoutMs: 10_000,
    }).catch(() => undefined);
    this.mounted.delete(record.id);
    await rm(mountPoint, { recursive: false, force: true }).catch(
      () => undefined,
    );
  }

  close(): Promise<void> {
    this.mounted.clear();
    return Promise.resolve();
  }
}

export class FixtureSmbAdapter implements SmbPlatformAdapter {
  private readonly connected = new Map<string, string>();

  constructor(
    readonly root = process.env.EIDETIC_SMB_FIXTURE_ROOT ??
      win32.join(resolveAppDirectories("win32").runtime, "smb-fixture"),
  ) {}

  async connect(
    record: SmbConnectionRecord,
    credential: SmbCredential | null,
  ): Promise<SmbAdapterConnection> {
    if (
      record.authMode === "account" &&
      (!credential || credential.password === "invalid")
    )
      throw new SmbError(
        "authentication-required",
        "The SMB credentials were not accepted.",
      );
    await access(this.root).catch(async () => {
      await mkdir(this.root, { recursive: true });
    });
    this.connected.set(record.id, this.root);
    return { root: this.root };
  }

  disconnect(record: SmbConnectionRecord): Promise<void> {
    this.connected.delete(record.id);
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.connected.clear();
    return Promise.resolve();
  }
}

export function createPlatformSmbAdapter(): SmbPlatformAdapter {
  if (process.env.EIDETIC_SMB_FIXTURE === "1") return new FixtureSmbAdapter();
  return process.platform === "win32"
    ? new WindowsSmbAdapter()
    : new LinuxSmbAdapter();
}
