import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import process from "node:process";

const workspace = fileURLToPath(new URL("..", import.meta.url));
const cli = {
  tsx: "node_modules/tsx/dist/cli.mjs",
  vite: "node_modules/vite/bin/vite.js",
  neu: "node_modules/@neutralinojs/neu/bin/neu.js",
};
const children = new Set();
const backendShutdownToken = randomUUID();
let stopping = false;
let cleanupPromise = null;

function run(command, args, name, env = process.env) {
  const child = spawn(command, args, {
    cwd: workspace,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  child.name = name;
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

function terminate(child) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    child.kill("SIGTERM");
  }
}

async function stopBackendGracefully() {
  try {
    await fetch("http://127.0.0.1:4310/api/development/shutdown", {
      method: "POST",
      headers: { "x-eidetic-shutdown-token": backendShutdownToken },
    });
  } catch {
    return;
  }
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    try {
      await fetch("http://127.0.0.1:4310/health");
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function cleanup(exitCode = 0) {
  if (cleanupPromise) return cleanupPromise;
  stopping = true;
  cleanupPromise = (async () => {
    await stopBackendGracefully();
    for (const child of children) terminate(child);
    process.exitCode = exitCode;
  })();
  return cleanupPromise;
}

async function waitFor(url, name, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !stopping) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Service is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`${name} did not become ready within ${String(timeoutMs)}ms`);
}

process.once("SIGINT", () => void cleanup(130));
process.once("SIGTERM", () => void cleanup(143));
process.once("exit", () => {
  for (const child of children) terminate(child);
});

try {
  const config = run(
    process.execPath,
    [cli.tsx, "scripts/generate-neutralino-config.ts", "development"],
    "config",
  );
  const configCode = await new Promise((resolve) =>
    config.once("exit", resolve),
  );
  if (configCode !== 0)
    throw new Error("Neutralino configuration generation failed");

  const backend = run(
    process.execPath,
    [cli.tsx, "watch", "apps/backend/src/index.ts"],
    "backend",
    {
      ...process.env,
      EIDETIC_DEV_SHUTDOWN_TOKEN: backendShutdownToken,
    },
  );
  const frontend = run(
    process.execPath,
    [cli.vite, "--config", "apps/ui/vite.config.ts"],
    "frontend",
  );

  for (const child of [backend, frontend]) {
    child.once("exit", (code) => {
      if (!stopping) {
        console.error(
          `[dev] ${child.name} exited unexpectedly (${String(code)})`,
        );
        cleanup(code ?? 1);
      }
    });
  }

  await Promise.all([
    waitFor("http://127.0.0.1:4310/health", "backend"),
    waitFor("http://127.0.0.1:5173/", "frontend"),
  ]);
  console.log("[dev] backend and frontend are ready; opening Eidetic Player");

  const shell = run(process.execPath, [cli.neu, "run"], "shell");
  const shellCode = await new Promise((resolve) => shell.once("exit", resolve));
  await cleanup(shellCode ?? 0);
} catch (error) {
  console.error("[dev]", error instanceof Error ? error.message : error);
  await cleanup(1);
}
