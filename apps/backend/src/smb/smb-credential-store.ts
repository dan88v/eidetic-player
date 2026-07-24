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
import { resolveAppDirectories } from "../platform/app-directories.js";
import { runBoundedProcess } from "../network/bounded-process.js";
import type { SmbCredential } from "./smb-types.js";
import { SmbError } from "./smb-types.js";

export interface SmbCredentialStore {
  write(connectionId: string, credential: SmbCredential): Promise<string>;
  read(reference: string): Promise<SmbCredential | null>;
  remove(reference: string): Promise<void>;
}

export class MemorySmbCredentialStore implements SmbCredentialStore {
  private readonly credentials = new Map<string, SmbCredential>();

  write(connectionId: string, credential: SmbCredential): Promise<string> {
    const reference = `fixture:${connectionId}`;
    this.credentials.set(reference, { ...credential });
    return Promise.resolve(reference);
  }

  read(reference: string): Promise<SmbCredential | null> {
    return Promise.resolve(this.credentials.get(reference) ?? null);
  }

  remove(reference: string): Promise<void> {
    this.credentials.delete(reference);
    return Promise.resolve();
  }
}

export function smbCredentialDirectory(
  platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
  home?: string,
): string {
  const path = platform === "win32" ? win32 : posix;
  return path.join(
    resolveAppDirectories(platform, environment, home).config,
    "smb-credentials",
  );
}

export class LinuxSmbCredentialStore implements SmbCredentialStore {
  constructor(readonly directory = smbCredentialDirectory("linux")) {}

  async write(
    connectionId: string,
    credential: SmbCredential,
  ): Promise<string> {
    if (!/^smb-[0-9a-f]{32}$/u.test(connectionId))
      throw new SmbError("invalid-request", "Invalid connection.", 400);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    const target = posix.join(this.directory, `${connectionId}.credentials`);
    const temporary = `${target}.${String(process.pid)}-${randomUUID()}.tmp`;
    const content = [
      `username=${credential.username}`,
      `password=${credential.password}`,
      ...(credential.domain ? [`domain=${credential.domain}`] : []),
      "",
    ].join("\n");
    await writeFile(temporary, content, {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(temporary, 0o600);
    await rename(temporary, target);
    await chmod(target, 0o600);
    return target;
  }

  async read(reference: string): Promise<SmbCredential | null> {
    if (dirname(reference) !== this.directory) return null;
    try {
      const values = new Map<string, string>();
      for (const line of (await readFile(reference, "utf8")).split(/\r?\n/u)) {
        const separator = line.indexOf("=");
        if (separator <= 0) continue;
        values.set(line.slice(0, separator), line.slice(separator + 1));
      }
      const username = values.get("username");
      const password = values.get("password");
      if (username === undefined || password === undefined) return null;
      return {
        username,
        password,
        ...(values.has("domain") ? { domain: values.get("domain") ?? "" } : {}),
        filePath: reference,
      };
    } catch {
      return null;
    }
  }

  async remove(reference: string): Promise<void> {
    if (dirname(reference) !== this.directory) return;
    await rm(reference, { force: true });
  }
}

const credentialScript = String.raw`
$ErrorActionPreference = "Stop"
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class EideticCredentials {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct CREDENTIAL {
    public UInt32 Flags; public UInt32 Type; public string TargetName;
    public string Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize; public IntPtr CredentialBlob;
    public UInt32 Persist; public UInt32 AttributeCount; public IntPtr Attributes;
    public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32", EntryPoint="CredWriteW", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredWrite(ref CREDENTIAL credential, UInt32 flags);
  [DllImport("advapi32", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredRead(string target, UInt32 type, UInt32 flags, out IntPtr credential);
  [DllImport("advapi32", EntryPoint="CredDeleteW", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredDelete(string target, UInt32 type, UInt32 flags);
  [DllImport("advapi32", EntryPoint="CredFree")]
  public static extern void CredFree(IntPtr buffer);
}
"@
$type = 1
if ($request.action -eq "write") {
  $bytes = [Text.Encoding]::Unicode.GetBytes([string]$request.password)
  $blob = [Runtime.InteropServices.Marshal]::AllocCoTaskMem($bytes.Length)
  try {
    [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $blob, $bytes.Length)
    $cred = New-Object EideticCredentials+CREDENTIAL
    $cred.Type=$type; $cred.TargetName=[string]$request.target
    $cred.UserName=[string]$request.username; $cred.Persist=2
    $cred.CredentialBlobSize=$bytes.Length; $cred.CredentialBlob=$blob
    if (-not [EideticCredentials]::CredWrite([ref]$cred,0)) { throw "credential write failed" }
  } finally { [Runtime.InteropServices.Marshal]::FreeCoTaskMem($blob) }
  '{"ok":true}'
} elseif ($request.action -eq "read") {
  $pointer=[IntPtr]::Zero
  if (-not [EideticCredentials]::CredRead([string]$request.target,$type,0,[ref]$pointer)) { '{"ok":false}'; exit 0 }
  try {
    $cred=[Runtime.InteropServices.Marshal]::PtrToStructure($pointer,[type][EideticCredentials+CREDENTIAL])
    $password=[Runtime.InteropServices.Marshal]::PtrToStringUni($cred.CredentialBlob,[int]($cred.CredentialBlobSize/2))
    @{ok=$true;username=$cred.UserName;password=$password} | ConvertTo-Json -Compress
  } finally { [EideticCredentials]::CredFree($pointer) }
} elseif ($request.action -eq "delete") {
  [void][EideticCredentials]::CredDelete([string]$request.target,$type,0)
  '{"ok":true}'
} else { throw "invalid action" }
`;

export class WindowsSmbCredentialStore implements SmbCredentialStore {
  private target(connectionId: string): string {
    return `EideticPlayer/SMB/${connectionId}`;
  }

  async write(
    connectionId: string,
    credential: SmbCredential,
  ): Promise<string> {
    const target = this.target(connectionId);
    await this.run({
      action: "write",
      target,
      username: credential.username,
      password: credential.password,
    });
    return target;
  }

  async read(reference: string): Promise<SmbCredential | null> {
    const result = await this.run({ action: "read", target: reference });
    if (result.ok !== true) return null;
    return {
      username: typeof result.username === "string" ? result.username : "",
      password: typeof result.password === "string" ? result.password : "",
    };
  }

  async remove(reference: string): Promise<void> {
    if (!reference.startsWith("EideticPlayer/SMB/")) return;
    await this.run({ action: "delete", target: reference });
  }

  private async run(
    request: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const result = await runBoundedProcess(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        credentialScript,
      ],
      { input: JSON.stringify(request), timeoutMs: 10_000 },
    );
    if (result.exitCode !== 0)
      throw new SmbError(
        "generic-failure",
        "Windows Credential Manager is unavailable.",
      );
    try {
      return JSON.parse(result.stdout.trim()) as Record<string, unknown>;
    } catch {
      throw new SmbError(
        "generic-failure",
        "Windows Credential Manager returned an invalid response.",
      );
    }
  }
}
