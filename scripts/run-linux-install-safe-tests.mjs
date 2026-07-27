#!/usr/bin/env node
import { spawn } from "node:child_process";
import process from "node:process";

// This is deliberately an explicit allowlist, not a glob. Each entry protects
// a deployment risk and unrelated application tests must not be added here.
export const installSafeTests = Object.freeze([
  {
    path: "apps/backend/test/linux-installation.test.ts",
    risk: "installer, update, transaction, launcher, MPV and SMB helper contracts",
  },
  {
    path: "apps/backend/test/neutralino-installer.test.ts",
    risk: "Neutralino build/install option propagation",
  },
  {
    path: "apps/backend/test/linux-platform.test.ts",
    risk: "POSIX paths, private runtime and filesystem semantics",
  },
  {
    path: "apps/backend/test/readiness-endpoint.test.ts",
    risk: "backend readiness contract used by the launcher",
  },
  {
    path: "apps/backend/test/mpv-discovery.test.ts",
    risk: "MPV discovery required for installed startup",
  },
  {
    path: "apps/backend/test/network-deployment.test.ts",
    risk: "NetworkManager deployment and privileged boundary",
  },
  {
    path: "scripts/linux-verification.test.ts",
    risk: "executable modes, release artifact and verification-profile mutations",
  },
  {
    path: "scripts/runtime-progress.test.mjs",
    risk: "runtime progress protocol and canonical build orchestration",
  },
]);

function run(command, arguments_) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, arguments_, {
      stdio: "inherit",
      shell: false,
      env: process.env,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal)
        reject(new Error(`install-safe test process ended with ${signal}`));
      else resolvePromise(code ?? 1);
    });
  });
}

const tsxCli = "node_modules/tsx/dist/cli.mjs";
const code = await run(process.execPath, [
  tsxCli,
  "--test",
  ...installSafeTests.map((entry) => entry.path),
]);
if (code !== 0) process.exit(code);

if (process.platform === "linux") {
  const stagingCode = await run("bash", ["deploy/linux/test-staging.sh"]);
  if (stagingCode !== 0) process.exit(stagingCode);
} else {
  console.log(
    "[test:install:linux] INFO isolated shell staging runs on Linux CI/device; cross-platform deployment contracts passed",
  );
}
