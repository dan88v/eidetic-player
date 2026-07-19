import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const targets = [
  ["arm64", "bin/neutralino-linux_arm64", "AArch64"],
  ["armhf", "bin/neutralino-linux_armhf", "ARM"],
] as const;
let found = 0;
for (const [name, path, machine] of targets) {
  if (
    !(await access(path)
      .then(() => true)
      .catch(() => false))
  ) {
    console.log(`[verify:arm] WARN ${name}: artifact unavailable`);
    continue;
  }
  found += 1;
  const file = (await execFileAsync("file", [path])).stdout.trim();
  const header = (await execFileAsync("readelf", ["-h", path])).stdout;
  if (
    !file.includes("ELF") ||
    !header.includes(`Machine:                           ${machine}`)
  ) {
    console.error(`[verify:arm] FAIL ${name}: unexpected ELF architecture`);
    process.exitCode = 1;
  } else console.log(`[verify:arm] PASS ${name}: ${file}`);
}
if (found === 0) {
  console.error(
    "[verify:arm] FAIL: no Neutralino ARM artifacts; run neu update",
  );
  process.exitCode = 1;
}
