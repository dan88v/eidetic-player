import { spawn } from "node:child_process";

async function smoke(signal: "SIGINT" | "SIGTERM"): Promise<void> {
  const child = spawn(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "apps/backend/src/index.ts"],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        NODE_ENV: "production",
        EIDETIC_ANALYZER_ENABLED: "false",
      },
    },
  );
  const started = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("backend startup timed out"));
    }, 15_000);
    child.stdout.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("[backend] listening")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once("exit", (code) => {
      reject(new Error(`backend exited early (${String(code)})`));
    });
  });
  try {
    await started;
    const response = await fetch("http://127.0.0.1:4310/health");
    if (!response.ok)
      throw new Error(`health returned ${String(response.status)}`);
    child.kill(signal);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`${signal} shutdown timed out`));
      }, 8_000);
      child.once("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`backend shutdown returned ${String(code)}`));
      });
    });
    console.log(`[smoke:linux] PASS: startup, health, ${signal}, cleanup`);
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGKILL");
    }
  }
}

await smoke("SIGTERM");
await smoke("SIGINT");
