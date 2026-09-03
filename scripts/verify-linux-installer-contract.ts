import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface LinuxInstallerSources {
  readonly installer: string;
  readonly uninstall: string;
  readonly update: string;
  readonly common: string;
  readonly consoleUi: string;
  readonly launcher: string;
}

export interface LinuxInstallerContractResult {
  readonly passed: readonly string[];
  readonly failed: readonly string[];
}

function ordered(source: string, ...markers: readonly string[]): boolean {
  let offset = -1;
  for (const marker of markers) {
    offset = source.indexOf(marker, offset + 1);
    if (offset < 0) return false;
  }
  return true;
}

function check(
  passed: string[],
  failed: string[],
  label: string,
  condition: boolean,
): void {
  (condition ? passed : failed).push(label);
}

export function inspectLinuxInstallerContract(
  sources: LinuxInstallerSources,
): LinuxInstallerContractResult {
  const { installer, uninstall, update, common, consoleUi, launcher } = sources;
  const passed: string[] = [];
  const failed: string[] = [];

  check(
    passed,
    failed,
    "installer backend loopback default",
    installer.includes('backend_host="${BACKEND_HOST:-127.0.0.1}"'),
  );

  check(
    passed,
    failed,
    "guided installer common arguments",
    ["-v | --verbose", "--no-color", "-h | --help", "--version"].every(
      (option) => installer.includes(option),
    ),
  );
  check(
    passed,
    failed,
    "guided uninstaller common arguments",
    ["-v | --verbose", "--no-color", "-h | --help", "--version"].every(
      (option) => uninstall.includes(option),
    ),
  );
  check(
    passed,
    failed,
    "guided no-argument non-TTY fail-safe",
    installer.includes(
      "Guided installation requires an interactive terminal",
    ) &&
      uninstall.includes("Guided uninstall requires an interactive terminal"),
  );
  check(
    passed,
    failed,
    "real installer phase count and progress",
    installer.includes("EIDETIC_CONSOLE_PHASE_TOTAL=$((dry_run ? 2 : 9))") &&
      consoleUi.includes("completed * 100 / total") &&
      !consoleUi.includes("apt_percent"),
  );
  check(
    passed,
    failed,
    "protected console logging and color controls",
    consoleUi.includes("chmod 0600") &&
      consoleUi.includes("EIDETIC_LOG_FALLBACK=1") &&
      consoleUi.includes("! -v NO_COLOR") &&
      consoleUi.includes('"${TERM:-dumb}" != dumb') &&
      consoleUi.includes("${category}-????????-??????-*.log"),
  );
  check(
    passed,
    failed,
    "safe console runner avoids eval and global tracing",
    !/\beval\b/.test(consoleUi) && !/set\s+-x/.test(consoleUi),
  );
  check(
    passed,
    failed,
    "uninstall data and GPIO choices are independent",
    uninstall.includes("Type DELETE to permanently remove application data") &&
      uninstall.includes("--yes-really-purge-data requires --purge-data") &&
      uninstall.includes(
        "Remove the GPIO/I2S DAC configuration added by Eidetic?",
      ),
  );
  check(
    passed,
    failed,
    "update keeps unattended invocation and explicit verbose propagation",
    update.includes("--unattended") &&
      update.includes("((verbose)) && args+=(--verbose)"),
  );
  check(
    passed,
    failed,
    "installer backend port 4310 default",
    installer.includes('backend_port="${BACKEND_PORT:-4310}"'),
  );
  check(
    passed,
    failed,
    "shared installed MPV path",
    installer.includes("EIDETIC_MPV_PATH=/usr/bin/mpv"),
  );
  check(
    passed,
    failed,
    "pkexec package and fixed executable",
    installer.includes("polkitd pkexec") &&
      installer.includes("[[ -x /usr/bin/pkexec ]]"),
  );
  check(
    passed,
    failed,
    "launcher compiled backend entrypoint",
    launcher.includes(
      'backend_entry="$release/backend/apps/backend/src/index.js"',
    ),
  );
  check(
    passed,
    failed,
    "launcher readiness endpoint",
    launcher.includes(
      'readiness_endpoint="http://${backend_host}:${backend_port}/api/readiness"',
    ) && !launcher.includes("/api/health"),
  );
  check(
    passed,
    failed,
    "launcher backend host and port defaults",
    launcher.includes('backend_host="${BACKEND_HOST:-127.0.0.1}"') &&
      launcher.includes('backend_port="${BACKEND_PORT:-4310}"'),
  );

  check(
    passed,
    failed,
    "install-safe default phase list",
    installer.includes(
      "eidetic_runtime_run_step install-dependencies 2 runtime_npm_ci",
    ) &&
      installer.includes(
        "eidetic_runtime_run_step typecheck 3 runtime_npm_run typecheck",
      ) &&
      installer.includes("eidetic_runtime_run_protocol_child"),
  );
  const phaseListStart = installer.indexOf(
    "eidetic_runtime_run_step install-dependencies",
  );
  const fullBlockStart = installer.indexOf(
    "if ((full_verify && runtime_status == 0)); then",
    phaseListStart,
  );
  const fullBlockEnd = installer.indexOf(
    "\n    runtime_build_offset=9",
    fullBlockStart,
  );
  const fullBlock =
    fullBlockStart >= 0 && fullBlockEnd >= 0
      ? installer.slice(fullBlockStart, fullBlockEnd)
      : "";
  check(
    passed,
    failed,
    "full profile adds complete application gates",
    ["format:check", "lint", "test", "test:posix", "test:case-sensitive"].every(
      (phase) => fullBlock.includes(phase),
    ),
  );
  check(
    passed,
    failed,
    "verification precedes build and staging",
    ordered(
      installer,
      "eidetic_runtime_run_step install-dependencies",
      "eidetic_runtime_run_protocol_child",
      "eidetic_runtime_run_step verify-runtime",
      'release_stage="$(mktemp',
    ),
  );
  check(
    passed,
    failed,
    "staged release verification precedes activation",
    ordered(
      installer,
      'release_verifier_args=(--root "$release_stage"',
      "Installation verification failed: Linux release contract",
      'eidetic_activate_release "$release_stage"',
    ),
  );
  check(
    passed,
    failed,
    "power integration is verified before activation",
    ordered(
      installer,
      "runtime/eidetic-player-power-helper",
      "Power integration verification failed",
      'eidetic_activate_release "$release_stage"',
    ),
  );
  check(
    passed,
    failed,
    "production dependency is packaged and verified",
    installer.includes("--omit=dev") &&
      installer.includes("node_modules/music-metadata"),
  );

  check(
    passed,
    failed,
    "full verification is per-operation only",
    installer.includes("--full-verify") &&
      !installer.includes("EIDETIC_FULL_VERIFY="),
  );
  check(
    passed,
    failed,
    "update propagates explicit full verification",
    update.includes("--full-verify") &&
      update.includes("((full_verify)) && args+=(--full-verify)"),
  );
  const rollbackStart = update.indexOf("if ((rollback)); then");
  const rollbackEnd = update.indexOf("\nfi", rollbackStart);
  const rollbackBlock =
    rollbackStart >= 0 && rollbackEnd >= 0
      ? update.slice(rollbackStart, rollbackEnd)
      : "";
  check(
    passed,
    failed,
    "rollback performs no verification or build",
    rollbackBlock.length > 0 &&
      !/full_verify|npm|install-eidetic-player/.test(rollbackBlock),
  );

  const activationStart = common.indexOf("eidetic_activate_release()");
  const activationEnd = common.indexOf("\neidetic_sha256()", activationStart);
  const activation =
    activationStart >= 0 && activationEnd >= 0
      ? common.slice(activationStart, activationEnd)
      : "";
  check(
    passed,
    failed,
    "activation preserves previous before replacing current",
    ordered(
      activation,
      'mv -Tf "$opt/previous.new" "$opt/previous"',
      'mv -Tf "$opt/current.new" "$opt/current"',
    ),
  );

  return { passed, failed };
}

export async function verifyLinuxInstallerContract(
  root = process.cwd(),
): Promise<LinuxInstallerContractResult> {
  const read = (path: string) => readFile(resolve(root, path), "utf8");
  const [installer, uninstall, update, common, consoleUi, launcher] =
    await Promise.all([
      read("deploy/linux/install-eidetic-player-desktop.sh"),
      read("deploy/linux/uninstall-eidetic-player.sh"),
      read("deploy/linux/update-eidetic-player.sh"),
      read("deploy/linux/lib/common.sh"),
      read("deploy/linux/lib/console-ui.sh"),
      read("deploy/linux/runtime/eidetic-player-launch"),
    ]);
  return inspectLinuxInstallerContract({
    installer,
    uninstall,
    update,
    common,
    consoleUi,
    launcher,
  });
}

async function main(): Promise<void> {
  const result = await verifyLinuxInstallerContract();
  for (const item of result.passed)
    console.log(`[verify:linux:installer-contract] PASS ${item}`);
  for (const item of result.failed)
    console.error(`[verify:linux:installer-contract] FAIL ${item}`);
  if (result.failed.length > 0) process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
