import { execFile } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve("deploy/linux/airplay");

export interface AirPlayDeploymentVerification {
  readonly passed: readonly string[];
  readonly failed: readonly string[];
}

function check(
  passed: string[],
  failed: string[],
  label: string,
  condition: boolean,
): void {
  (condition ? passed : failed).push(label);
}

export async function verifyAirPlayDeployment(): Promise<AirPlayDeploymentVerification> {
  const paths = {
    manifest: resolve(root, "sources.json"),
    patch: resolve(
      root,
      "patches/shairport-sync-5.2.1-eidetic-fail-closed.patch",
    ),
    builder: resolve(root, "build-airplay-integration.sh"),
    hook: resolve(root, "eidetic-player-airplay-hook"),
    receiverUnit: resolve(root, "templates/eidetic-player-airplay.service"),
    timingUnit: resolve(root, "templates/eidetic-player-nqptp.service"),
    notices: resolve(root, "THIRD_PARTY_NOTICES.md"),
    ciWorkflow: resolve(".github/workflows/ci.yml"),
  };
  const [
    manifestText,
    patch,
    builder,
    hook,
    receiverUnit,
    timingUnit,
    notices,
    installer,
    uninstaller,
    ciWorkflow,
  ] = await Promise.all([
    readFile(paths.manifest, "utf8"),
    readFile(paths.patch, "utf8"),
    readFile(paths.builder, "utf8"),
    readFile(paths.hook, "utf8"),
    readFile(paths.receiverUnit, "utf8"),
    readFile(paths.timingUnit, "utf8"),
    readFile(paths.notices, "utf8"),
    readFile(resolve("deploy/linux/install-eidetic-player.sh"), "utf8"),
    readFile(resolve("deploy/linux/uninstall-eidetic-player.sh"), "utf8"),
    readFile(paths.ciWorkflow, "utf8"),
  ]);
  const manifest = JSON.parse(manifestText) as {
    schemaVersion?: unknown;
    integrationVersion?: unknown;
    shairportSync?: Record<string, unknown>;
    nqptp?: Record<string, unknown>;
    buildDependencies?: unknown;
  };
  const passed: string[] = [];
  const failed: string[] = [];
  const sha256 = /^[0-9a-f]{64}$/u;
  const commit = /^[0-9a-f]{40}$/u;

  check(
    passed,
    failed,
    "versioned integration manifest",
    manifest.schemaVersion === 1 &&
      manifest.integrationVersion ===
        "shairport-sync-5.2.1-eidetic.2+nqptp-1.2.8",
  );
  for (const [label, source] of [
    ["Shairport Sync", manifest.shairportSync],
    ["NQPTP", manifest.nqptp],
  ] as const) {
    check(
      passed,
      failed,
      `${label} exact official pin`,
      typeof source?.archiveUrl === "string" &&
        source.archiveUrl.startsWith(
          "https://codeload.github.com/mikebrady/",
        ) &&
        source.archiveUrl.includes("/refs/tags/") &&
        !/latest|master|main/u.test(source.archiveUrl) &&
        typeof source.commit === "string" &&
        commit.test(source.commit) &&
        typeof source.sha256 === "string" &&
        sha256.test(source.sha256),
    );
  }
  check(
    passed,
    failed,
    "matching Shairport and NQPTP SMI 10 contract",
    manifest.nqptp?.expectedSharedMemoryVersion === 10 &&
      builder.includes("NQPTP_SHM_STRUCTURES_VERSION") &&
      builder.includes('"smi$nqptp_smi_version"') &&
      builder.includes(
        "Shared Memory Interface Version: smi$nqptp_smi_version.",
      ) &&
      installer.includes('airplay_smi_version="$(python3') &&
      installer.includes('"smi$airplay_smi_version"') &&
      installer.includes(
        "Shared Memory Interface Version: smi$airplay_smi_version.",
      ) &&
      !builder.includes("smi5") &&
      !installer.includes("smi5"),
  );
  check(
    passed,
    failed,
    "fail-closed upstream patch",
    patch.includes("int command_start(void)") &&
      patch.includes("WEXITSTATUS(status) != EXIT_SUCCESS") &&
      patch.includes("playback denied by the pre-play command") &&
      patch.includes("return -1;"),
  );
  check(
    passed,
    failed,
    "unprivileged bounded source builder",
    builder.includes("((EUID != 0))") &&
      builder.includes("--retry 3") &&
      builder.includes("sha256sum --check --strict") &&
      builder.includes("extract_checked") &&
      builder.includes("make -j2") &&
      builder.includes("plistutil") &&
      !builder.includes("chmod 777"),
  );
  check(
    passed,
    failed,
    "AirPlay 2 plist utility build dependency",
    Array.isArray(manifest.buildDependencies) &&
      manifest.buildDependencies.includes("libplist-dev") &&
      manifest.buildDependencies.includes("libplist-utils") &&
      installer.includes("libplist-dev") &&
      installer.includes("libplist-utils") &&
      ciWorkflow.includes("libplist-dev") &&
      ciWorkflow.includes("libplist-utils"),
  );
  check(
    passed,
    failed,
    "runtime advertisement verification dependency",
    installer.includes("avahi-daemon avahi-utils") &&
      manifestText.includes('"libgcrypt20-dev"'),
  );
  check(
    passed,
    failed,
    "minimal fixed hook protocol",
    hook.includes(
      'COMMANDS = {"before": b"BEFORE 1\\n", "after": b"AFTER 1\\n"}',
    ) &&
      hook.includes("socket.AF_UNIX") &&
      hook.includes("settimeout(4.5)") &&
      !/subprocess|os\.system|shell=True/u.test(hook),
  );
  check(
    passed,
    failed,
    "non-root receiver user unit",
    receiverUnit.includes(
      "ExecStart=/opt/eidetic-player/current/airplay/bin/shairport-sync",
    ) &&
      receiverUnit.includes(
        "ConditionPathExists=/opt/eidetic-player/current/airplay/bin/shairport-sync",
      ) &&
      receiverUnit.includes("NoNewPrivileges=yes") &&
      receiverUnit.includes("ProtectSystem=strict") &&
      !/^User=root$/mu.test(receiverUnit) &&
      !/sh -c|bash -c/u.test(receiverUnit),
  );
  check(
    passed,
    failed,
    "least-privilege NQPTP unit",
    timingUnit.includes("DynamicUser=yes") &&
      timingUnit.includes(
        "ConditionPathExists=/opt/eidetic-player/current/airplay/bin/nqptp",
      ) &&
      timingUnit.includes("CapabilityBoundingSet=CAP_NET_BIND_SERVICE") &&
      timingUnit.includes("NoNewPrivileges=yes") &&
      timingUnit.includes("ProtectSystem=strict") &&
      !timingUnit.includes("CAP_NET_ADMIN"),
  );
  check(
    passed,
    failed,
    "installer stages cache, units, hook, and default store",
    installer.includes("airplay_cache_valid") &&
      installer.includes("dist/airplay") &&
      installer.includes("eidetic-player-airplay.service") &&
      installer.includes("eidetic-player-nqptp.service") &&
      installer.includes("eidetic-player-airplay-hook") &&
      installer.includes("airplay.json") &&
      installer.includes('"enabled": True') &&
      installer.includes('airplay_plan="Preserved (Off)"') &&
      installer.includes('airplay_fixture_shairport_sha="$(sha256sum') &&
      installer.includes('airplay_fixture_nqptp_sha="$(sha256sum') &&
      installer.includes('"shairport-sync":"%s","nqptp":"%s"') &&
      !installer.includes('"binaries":{}}') &&
      installer.includes("AirPlay timing did not start after activation") &&
      !installer.includes(
        "systemctl enable --now eidetic-player-nqptp.service ||\n    eidetic_die",
      ),
  );
  check(
    passed,
    failed,
    "uninstaller preserves settings unless purge and removes managed runtime",
    uninstaller.includes("disable --now") &&
      uninstaller.includes("eidetic-player-airplay.service") &&
      uninstaller.includes("eidetic-player-nqptp.service") &&
      uninstaller.includes("/var/cache/eidetic-player/airplay") &&
      uninstaller.includes("if ((purge))"),
  );
  check(
    passed,
    failed,
    "third-party notices and corresponding source contract",
    notices.includes("Shairport Sync 5.2.1") &&
      notices.includes("NQPTP 1.2.8") &&
      builder.includes("sources/shairport-sync-$shairport_version.tar.gz") &&
      builder.includes("licenses/NQPTP-GPL-2.0.txt"),
  );

  for (const [label, path] of Object.entries(paths)) {
    const details = await lstat(path);
    check(
      passed,
      failed,
      `${label} is not a symlink`,
      !details.isSymbolicLink(),
    );
  }
  if (process.platform === "linux") {
    try {
      await execFileAsync("bash", ["-n", paths.builder], { timeout: 5_000 });
      passed.push("bash -n AirPlay builder");
    } catch {
      failed.push("bash -n AirPlay builder");
    }
  }
  return { passed, failed };
}

async function main(): Promise<void> {
  const result = await verifyAirPlayDeployment();
  for (const item of result.passed)
    console.log(`[verify:airplay:deployment] PASS ${item}`);
  for (const item of result.failed)
    console.error(`[verify:airplay:deployment] FAIL ${item}`);
  if (result.failed.length > 0) process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();
