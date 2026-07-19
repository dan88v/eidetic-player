import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { resolveAppDirectories } from "../apps/backend/src/platform/app-directories.js";
import { discoverFfmpeg } from "../apps/backend/src/analysis/ffmpeg-discovery.js";
import { discoverMpv } from "../apps/backend/src/player/mpv-discovery.js";

const execFileAsync = promisify(execFile);

async function command(
  command: string,
  arguments_: string[] = [],
): Promise<string | null> {
  try {
    const result = await execFileAsync(command, arguments_, {
      timeout: 5_000,
      maxBuffer: 1024 * 1024,
    });
    return `${result.stdout}${result.stderr}`.trim();
  } catch {
    return null;
  }
}

function report(label: string, value: string | null, required = false): void {
  const state = value ? "PASS" : required ? "FAIL" : "WARN";
  console.log(`[doctor:linux] ${state} ${label}: ${value ?? "not available"}`);
  if (required && !value) process.exitCode = 1;
}

const osRelease = await readFile("/etc/os-release", "utf8").catch(() => "");
const distro = /^PRETTY_NAME=(?:"([^"]+)"|(.+))$/m.exec(osRelease);
report(
  "platform",
  process.platform === "linux" ? process.platform : null,
  true,
);
report("distribution", distro?.[1] ?? distro?.[2] ?? null);
report(
  "environment",
  (await readFile("/proc/version", "utf8").catch(() => ""))
    .toLowerCase()
    .includes("microsoft")
    ? "WSL"
    : "bare metal/VM",
);
report("architecture", process.arch, true);
report("Node", process.version, true);
report(
  "npm",
  (await command("npm", ["--version"]))?.split("\n")[0] ?? null,
  true,
);
const mpv = await discoverMpv();
report("MPV", mpv?.version ?? null, true);
const ffmpeg = await discoverFfmpeg(process.env, mpv?.executable);
report("FFmpeg", ffmpeg?.version ?? null, true);
const gtk =
  (await command("pkg-config", ["--modversion", "gtk+-3.0"])) ??
  (await command("dpkg-query", ["-W", "-f=${Version}", "libgtk-3-0t64"]));
const webkit =
  (await command("pkg-config", ["--modversion", "webkit2gtk-4.1"])) ??
  (await command("dpkg-query", ["-W", "-f=${Version}", "libwebkit2gtk-4.1-0"]));
report("GTK 3 runtime", gtk);
report("WebKitGTK 4.1 runtime", webkit);
report(
  "systemd PID 1",
  (await command("ps", ["-p", "1", "-o", "comm="])) === "systemd"
    ? "running"
    : null,
);
report("DISPLAY", process.env.DISPLAY ?? null);
report("WAYLAND_DISPLAY", process.env.WAYLAND_DISPLAY ?? null);
report(
  "PulseAudio server",
  (await command("pactl", ["info"]))?.match(/^Server Name: (.+)$/m)?.[1] ??
    null,
);
report(
  "Neutralino CLI",
  (
    await command("node", [
      "node_modules/@neutralinojs/neu/bin/neu.js",
      "version",
    ])
  )?.match(/neu CLI: (.+)/)?.[1] ?? null,
  true,
);
const directories = resolveAppDirectories();
report("XDG config", directories.config, true);
report("XDG cache", directories.cache, true);
report("XDG data", directories.data, true);
report("XDG runtime", directories.runtime, true);
for (const binary of [
  "bin/neutralino-linux_x64",
  "bin/neutralino-linux_arm64",
  "bin/neutralino-linux_armhf",
])
  report(
    binary,
    await access(binary)
      .then(() => binary)
      .catch(() => null),
  );
