import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { verifyLinuxRelease } from "./verify-linux-release.js";
import {
  inspectLinuxInstallerContract,
  type LinuxInstallerSources,
} from "./verify-linux-installer-contract.js";

const execFileAsync = promisify(execFile);
const modeVerifier = resolve("scripts/verify-linux-executable-modes.mjs");
const requiredScripts = [
  "doctor-installation.sh",
  "install-eidetic-player.sh",
  "lib/common.sh",
  "network/install-network-integration.sh",
  "network/uninstall-network-integration.sh",
  "restore-system-ui.sh",
  "runtime/eidetic-player",
  "runtime/eidetic-player-display-policy",
  "runtime/eidetic-player-launch",
  "runtime/eidetic-player-maintenance",
  "runtime/eidetic-player-power-helper",
  "runtime/eidetic-player-resume",
  "runtime/eidetic-player-smb-helper",
  "test-case-sensitive-wsl.sh",
  "test-platform-detection.sh",
  "test-rpi-keyboard.sh",
  "test-staging.sh",
  "test-unprivileged-build.sh",
  "uninstall-eidetic-player.sh",
  "update-eidetic-player.sh",
];

async function runModeVerifier(
  repository: string,
  environment = process.env,
  git = "git",
) {
  return execFileAsync(
    process.execPath,
    [modeVerifier, "--repo", repository, "--git", git],
    { env: environment },
  );
}

async function makeModeRepository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "eidetic modes Ü space "));
  for (const relativePath of requiredScripts) {
    const path = resolve(root, "deploy/linux", relativePath);
    await mkdir(dirname(path), { recursive: true });
    const lineEnding = relativePath === "test-staging.sh" ? "\r\n" : "\n";
    await writeFile(
      path,
      `#!/usr/bin/env bash${lineEnding}exit 0${lineEnding}`,
    );
  }
  await mkdir(resolve(root, "deploy/linux"), { recursive: true });
  await writeFile(resolve(root, "deploy/linux/README.md"), "# fixture\n");
  await execFileAsync("git", ["-C", root, "init", "--quiet"]);
  await execFileAsync("git", ["-C", root, "add", "."]);
  for (const relativePath of requiredScripts)
    await execFileAsync("git", [
      "-C",
      root,
      "update-index",
      "--chmod=+x",
      "--",
      `deploy/linux/${relativePath}`,
    ]);
  return root;
}

void test("current Linux deployment Git modes satisfy the executable guard", async () => {
  const result = await runModeVerifier(process.cwd());
  assert.match(result.stdout, /PASS/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /chmod 777/i);
});

void test("mode guard reads 100755/100644 from Git index across path and line-ending edge cases", async () => {
  const root = await makeModeRepository();
  try {
    const unicodeScript = "deploy/linux/runtime/command Ü with spaces";
    await writeFile(resolve(root, unicodeScript), "#!/bin/sh\r\nexit 0\r\n");
    await execFileAsync("git", ["-C", root, "add", "--", unicodeScript]);
    await execFileAsync("git", [
      "-C",
      root,
      "update-index",
      "--chmod=+x",
      "--",
      unicodeScript,
    ]);
    const result = await runModeVerifier(root);
    assert.match(result.stdout, /PASS/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("mode guard rejects a new 100644 script with a safe index repair command", async () => {
  const root = await makeModeRepository();
  try {
    const script = "deploy/linux/new Ü script.sh";
    await writeFile(resolve(root, script), "#!/bin/sh\nexit 0\n");
    await execFileAsync("git", ["-C", root, "add", "--", script]);
    await assert.rejects(
      runModeVerifier(root),
      (error: { stderr?: string }) => {
        assert.match(error.stderr ?? "", /Git mode 100755/);
        assert.match(
          error.stderr ?? "",
          /git update-index --chmod=\+x -- "deploy\/linux\/new Ü script\.sh"/,
        );
        assert.doesNotMatch(error.stderr ?? "", /chmod 777/i);
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("mode guard rejects data accidentally committed as executable", async () => {
  const root = await makeModeRepository();
  try {
    await execFileAsync("git", [
      "-C",
      root,
      "update-index",
      "--chmod=+x",
      "--",
      "deploy/linux/README.md",
    ]);
    await assert.rejects(
      runModeVerifier(root),
      /data file must use Git mode 100644/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("mode guard rejects missing shebangs, unexpected symlinks and a non-executable SMB helper", async () => {
  for (const mutation of ["shebang", "symlink", "smb-mode"] as const) {
    const root = await makeModeRepository();
    try {
      if (mutation === "shebang") {
        const path = resolve(root, "deploy/linux/runtime/eidetic-player");
        await writeFile(path, "exit 0\n");
      } else if (mutation === "symlink") {
        const target = resolve(root, "symlink-target.txt");
        await writeFile(target, "README.md\n");
        const { stdout } = await execFileAsync("git", [
          "-C",
          root,
          "hash-object",
          "-w",
          target,
        ]);
        await execFileAsync("git", [
          "-C",
          root,
          "update-index",
          "--add",
          "--cacheinfo",
          "120000",
          stdout.trim(),
          "deploy/linux/unexpected-link",
        ]);
      } else {
        await execFileAsync("git", [
          "-C",
          root,
          "update-index",
          "--chmod=-x",
          "--",
          "deploy/linux/runtime/eidetic-player-smb-helper",
        ]);
      }
      await assert.rejects(runModeVerifier(root));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

void test(
  "mode guard rejects world-writable deployment files on POSIX",
  { skip: process.platform === "win32" },
  async () => {
    const root = await makeModeRepository();
    try {
      await chmod(
        resolve(root, "deploy/linux/install-eidetic-player.sh"),
        0o777,
      );
      await assert.rejects(runModeVerifier(root), /world-writable/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

void test("mode guard diagnoses missing Git and non-repository staging roots", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "eidetic no git "));
  try {
    await assert.rejects(
      runModeVerifier(root, { ...process.env }, "git-that-does-not-exist"),
      /Git is unavailable/,
    );
    await assert.rejects(runModeVerifier(root), /not a readable Git checkout/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function elfHeader(architecture: "arm64" | "x64"): Buffer {
  const header = Buffer.alloc(64);
  header.set([0x7f, 0x45, 0x4c, 0x46, 2, 1], 0);
  header.writeUInt16LE(architecture === "arm64" ? 0xb7 : 0x3e, 18);
  return header;
}

async function makeBuildFixture(
  architecture: "arm64" | "x64",
): Promise<string> {
  const root = await mkdtemp(
    resolve(tmpdir(), `eidetic build ${architecture} `),
  );
  const files = new Map<string, string | Buffer>([
    ["dist/backend/apps/backend/src/index.js", "export {};\n"],
    ["dist/ui/index.html", "<!doctype html>\n"],
    ["dist/ui/assets/app.css", "body{}\n"],
    ["dist/ui/assets/app.js", "export {};\n"],
    ["dist/eidetic-player/resources.neu", Buffer.from("NEU")],
    ["neutralino.config.json", "{}\n"],
    [
      `dist/eidetic-player/eidetic-player-linux_${architecture}`,
      elfHeader(architecture),
    ],
  ]);
  for (const [relativePath, content] of files) {
    const path = resolve(root, relativePath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
  return root;
}

async function makeStagedFixture(): Promise<{
  opt: string;
  root: string;
  source: string;
}> {
  const opt = await mkdtemp(resolve(tmpdir(), "eidetic staged "));
  const root = resolve(opt, "releases/.incoming-fixture.1234");
  const source = resolve(opt, "source checkout Ü");
  const files = new Map<string, string | Buffer>([
    ["backend/apps/backend/src/index.js", "export {};\n"],
    ["eidetic-player", elfHeader("arm64")],
    ["bin/eidetic-player-launch", "#!/bin/sh\nexit 0\n"],
    ["resources.neu", Buffer.from("NEU")],
    ["neutralino.config.json", "{}\n"],
    ["package.json", '{"type":"module"}\n'],
    ["package-lock.json", '{"lockfileVersion":3}\n'],
    ["node_modules/music-metadata/package.json", '{"name":"music-metadata"}\n'],
  ]);
  for (const [relativePath, content] of files) {
    const path = resolve(root, relativePath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
  await chmod(resolve(root, "eidetic-player"), 0o755);
  await chmod(resolve(root, "bin/eidetic-player-launch"), 0o755);
  return { opt, root, source };
}

void test("release verifier accepts ARM64 and x64 build artifacts", async () => {
  for (const architecture of ["arm64", "x64"] as const) {
    const root = await makeBuildFixture(architecture);
    try {
      const result = await verifyLinuxRelease({
        root,
        architecture,
        phase: "build",
      });
      assert.deepEqual(result.failed, []);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

void test("release verifier CLI reports readable output and coherent exit codes", async () => {
  const root = await makeBuildFixture("x64");
  try {
    const valid = await execFileAsync(process.execPath, [
      "node_modules/tsx/dist/cli.mjs",
      "scripts/verify-linux-release.ts",
      "--root",
      root,
      "--arch",
      "amd64",
      "--phase",
      "build-output",
    ]);
    assert.match(valid.stdout, /\[verify:linux:release] PASS/);
    await rm(resolve(root, "dist/backend/apps/backend/src/index.js"), {
      force: true,
    });
    await assert.rejects(
      execFileAsync(process.execPath, [
        "node_modules/tsx/dist/cli.mjs",
        "scripts/verify-linux-release.ts",
        "--root",
        root,
        "--arch",
        "x64",
        "--phase",
        "build",
        "--json",
      ]),
      (error: { stdout?: string }) => {
        assert.match(error.stdout ?? "", /compiled backend entrypoint/);
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("build verifier rejects missing backend, binary, resources and config", async () => {
  for (const relativePath of [
    "dist/backend/apps/backend/src/index.js",
    "dist/eidetic-player/eidetic-player-linux_arm64",
    "dist/eidetic-player/resources.neu",
    "neutralino.config.json",
  ]) {
    const root = await makeBuildFixture("arm64");
    try {
      await rm(resolve(root, relativePath), { force: true });
      const result = await verifyLinuxRelease({
        root,
        architecture: "arm64",
        phase: "build",
      });
      assert.ok(result.failed.length > 0, relativePath);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

void test("staged verifier accepts a complete release and rejects deployment mutations", async () => {
  const valid = await makeStagedFixture();
  try {
    const result = await verifyLinuxRelease({
      root: valid.root,
      architecture: "arm64",
      phase: "staged",
      sourceRoot: valid.source,
    });
    assert.deepEqual(result.failed, []);
  } finally {
    await rm(valid.opt, { recursive: true, force: true });
  }

  for (const relativePath of [
    "backend/apps/backend/src/index.js",
    "eidetic-player",
    "bin/eidetic-player-launch",
    "resources.neu",
    "neutralino.config.json",
    "package-lock.json",
    "node_modules/music-metadata",
  ]) {
    const fixture = await makeStagedFixture();
    try {
      await rm(resolve(fixture.root, relativePath), {
        recursive: true,
        force: true,
      });
      const result = await verifyLinuxRelease({
        root: fixture.root,
        architecture: "arm64",
        phase: "staged",
      });
      assert.ok(result.failed.length > 0, relativePath);
    } finally {
      await rm(fixture.opt, { recursive: true, force: true });
    }
  }
});

void test("staged verifier rejects source paths and premature current activation", async () => {
  const fixture = await makeStagedFixture();
  try {
    await writeFile(
      resolve(fixture.root, "backend/source-path.json"),
      JSON.stringify({ source: fixture.source }),
    );
    await symlink(
      fixture.root,
      resolve(fixture.opt, "current"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const result = await verifyLinuxRelease({
      root: fixture.root,
      architecture: "arm64",
      phase: "staged",
      sourceRoot: fixture.source,
    });
    assert.ok(
      result.failed.some((item) => item.includes("source-checkout path")),
    );
    assert.ok(result.failed.some((item) => item.includes("not current")));
  } finally {
    await rm(fixture.opt, { recursive: true, force: true });
  }
});

void test(
  "staged verifier rejects a broken symbolic link",
  { skip: process.platform === "win32" },
  async () => {
    const fixture = await makeStagedFixture();
    try {
      await symlink("missing-target", resolve(fixture.root, "broken-link"));
      const result = await verifyLinuxRelease({
        root: fixture.root,
        architecture: "arm64",
        phase: "staged",
      });
      assert.ok(
        result.failed.some((item) => item.includes("broken symbolic link")),
      );
    } finally {
      await rm(fixture.opt, { recursive: true, force: true });
    }
  },
);

void test(
  "staged verifier rejects a non-executable launcher on POSIX",
  { skip: process.platform === "win32" },
  async () => {
    const fixture = await makeStagedFixture();
    try {
      await chmod(resolve(fixture.root, "bin/eidetic-player-launch"), 0o644);
      const result = await verifyLinuxRelease({
        root: fixture.root,
        architecture: "arm64",
        phase: "staged",
      });
      assert.ok(result.failed.includes("bin/eidetic-player-launch mode 0755"));
    } finally {
      await rm(fixture.opt, { recursive: true, force: true });
    }
  },
);

void test("install-safe runner uses an explicit deployment allowlist without UI globs", async () => {
  const source = await readFile(
    "scripts/run-linux-install-safe-tests.mjs",
    "utf8",
  );
  assert.match(source, /linux-installation\.test\.ts/);
  assert.match(source, /neutralino-installer\.test\.ts/);
  assert.match(source, /linux-verification\.test\.ts/);
  assert.doesNotMatch(
    source,
    /apps\/ui\/test|\*\.test|Favorites|History|Playlist|visualizer/i,
  );
});

async function readInstallerSources(): Promise<LinuxInstallerSources> {
  const [installer, update, common, launcher] = await Promise.all([
    readFile("deploy/linux/install-eidetic-player.sh", "utf8"),
    readFile("deploy/linux/update-eidetic-player.sh", "utf8"),
    readFile("deploy/linux/lib/common.sh", "utf8"),
    readFile("deploy/linux/runtime/eidetic-player-launch", "utf8"),
  ]);
  return { installer, update, common, launcher };
}

void test("installer contract verifier accepts the frozen deployment baseline", async () => {
  const result = inspectLinuxInstallerContract(await readInstallerSources());
  assert.deepEqual(result.failed, []);
});

void test("installer contract verifier detects readiness, port, MPV and transaction mutations", async () => {
  const baseline = await readInstallerSources();
  const mutations: [keyof LinuxInstallerSources, string, string][] = [
    ["launcher", "/api/readiness", "/api/health"],
    [
      "installer",
      'backend_port="${BACKEND_PORT:-4310}"',
      'backend_port="${BACKEND_PORT:-4311}"',
    ],
    [
      "installer",
      "EIDETIC_MPV_PATH=/usr/bin/mpv",
      "EIDETIC_MPV_PATH=/missing/mpv",
    ],
    ["installer", "polkitd pkexec", "polkitd"],
    [
      "common",
      'mv -Tf "$opt/previous.new" "$opt/previous"',
      'mv -Tf "$opt/current.new" "$opt/current"',
    ],
    [
      "update",
      "((full_verify)) && args+=(--full-verify)",
      ": # full verification propagation removed",
    ],
  ];
  for (const [key, from, to] of mutations) {
    const mutated = { ...baseline, [key]: baseline[key].replace(from, to) };
    assert.notEqual(mutated[key], baseline[key], `${key}: mutation applied`);
    const result = inspectLinuxInstallerContract(mutated);
    assert.ok(result.failed.length > 0, `${key}: ${from}`);
  }
});

void test("installer default omits the full suite while full verify and dry-run remain explicit", async () => {
  const source = await readFile(
    "deploy/linux/install-eidetic-player.sh",
    "utf8",
  );
  const defaultPhases = /verification_phases=\(([^)]*)\)/.exec(source)?.[1];
  assert.equal(defaultPhases, "ci typecheck verify:linux:installer");
  assert.match(
    source,
    /if \(\(full_verify\)\); then\s+verification_phases\+=\([^)]*test[^)]*\)/,
  );
  assert.ok(
    source.indexOf("if ((dry_run)); then") <
      source.indexOf("verification_phases=(ci typecheck"),
  );
  const update = await readFile(
    "deploy/linux/update-eidetic-player.sh",
    "utf8",
  );
  const rollback = update.slice(
    update.indexOf("if ((rollback)); then"),
    update.indexOf("\nfi", update.indexOf("if ((rollback)); then")),
  );
  assert.doesNotMatch(rollback, /full_verify|npm|install-eidetic-player/);
  assert.match(update, /\(\(full_verify\)\) && args\+=\(--full-verify\)/);
});
