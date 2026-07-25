import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import test from "node:test";
import {
  discoverMpv,
  isValidMpvVersionLine,
  resolveMpvCandidates,
} from "../src/player/mpv-discovery.js";

async function createMockMpvBinary(
  directory: string,
  name: string,
  line: string,
): Promise<string> {
  const executable =
    process.platform === "win32"
      ? join(directory, `${name}.bat`)
      : join(directory, name);
  await writeFile(
    executable,
    process.platform === "win32"
      ? `@echo ${line}\r\n`
      : `#!/usr/bin/env sh\nprintf '%s\n' "${line}"\n`,
    "utf8",
  );
  await chmod(executable, 0o755);
  return executable;
}

void test("resolveMpvCandidates keeps platform-specific order and fallback", () => {
  assert.deepEqual(
    resolveMpvCandidates("linux", { EIDETIC_MPV_PATH: "/custom/mpv-path" }).map(
      (candidate) => candidate.type,
    ),
    ["configured", "linux-system", "path"],
  );
  assert.deepEqual(
    resolveMpvCandidates("win32", {
      EIDETIC_MPV_PATH: "C:\\\\Program Files\\\\mpv\\\\mpv.exe",
    }).map((candidate) => candidate.type),
    ["configured", "path"],
  );
});

void test("resolveMpvCandidates deduplicates configured from linux-system", () => {
  assert.deepEqual(
    resolveMpvCandidates("linux", {
      EIDETIC_MPV_PATH: "/usr/bin/mpv",
    }).map((candidate) => candidate.executable),
    ["/usr/bin/mpv", "mpv"],
  );
});

void test(
  "discoverMpv uses configured executable before fallback candidates",
  { skip: process.platform === "win32" },
  async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), "eidetic-mpv-discovery-"));
    try {
      const configured = await createMockMpvBinary(
        fixtureRoot,
        "configured-mpv",
        "mpv 0.37.0",
      );
      await createMockMpvBinary(
        fixtureRoot,
        "mpv",
        "mpv should not be used on this assertion",
      );
      const result = await discoverMpv({
        EIDETIC_MPV_PATH: configured,
        PATH: `${fixtureRoot}${delimiter}${process.env.PATH ?? ""}`,
        PATHEXT: process.env.PATHEXT,
      });
      if (result === null) {
        throw new Error(
          "discoverMpv should return configured executable result",
        );
      }
      assert.equal(result.executable, configured);
      assert.equal(result.version, "mpv 0.37.0");
      assert.equal(result.diagnostics.length, 1);
      const firstDiagnostic = result.diagnostics[0];
      if (!firstDiagnostic) {
        throw new Error("expected first discovery diagnostic");
      }
      assert.equal(firstDiagnostic.status, "success");
      assert.equal(firstDiagnostic.candidate, "configured MPV path");
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  },
);

void test(
  "discoverMpv falls back to PATH when configured is not usable",
  { skip: process.platform === "win32" },
  async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), "eidetic-mpv-fallback-"));
    try {
      await createMockMpvBinary(fixtureRoot, "mpv", "mpv 1.0.0");
      const result = await discoverMpv(
        {
          EIDETIC_MPV_PATH: "/does/not/exist",
          PATH: `${fixtureRoot}${delimiter}${process.env.PATH ?? ""}`,
          PATHEXT: process.env.PATHEXT,
        },
        "win32",
      );
      if (result === null) {
        throw new Error("discoverMpv should fall back to PATH candidate");
      }
      assert.equal(result.executable, "mpv");
      assert.equal(result.version, "mpv 1.0.0");
      assert.equal(result.diagnostics.length, 2);
      const firstDiagnostic = result.diagnostics[0];
      const secondDiagnostic = result.diagnostics[1];
      if (!firstDiagnostic || !secondDiagnostic) {
        throw new Error("expected fallback diagnostics for PATH resolution");
      }
      assert.equal(firstDiagnostic.status, "not-found");
      assert.equal(secondDiagnostic.status, "success");
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  },
);

void test(
  "discoverMpv tries Linux-system candidate before PATH",
  { skip: process.platform === "win32" },
  async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), "eidetic-mpv-system-"));
    try {
      await createMockMpvBinary(fixtureRoot, "mpv", "mpv 1.1.0");
      const result = await discoverMpv(
        {
          EIDETIC_MPV_PATH: "/not-a-real-mpv-path",
          PATH: `${fixtureRoot}${delimiter}${process.env.PATH ?? ""}`,
          PATHEXT: process.env.PATHEXT,
        },
        "linux",
      );
      if (result === null) {
        throw new Error(
          "discoverMpv should return at least one diagnostic candidate",
        );
      }
      const configuredDiagnostic = result.diagnostics[0];
      const systemDiagnostic = result.diagnostics[1];
      const pathDiagnostic = result.diagnostics[2];
      if (!configuredDiagnostic || !systemDiagnostic) {
        throw new Error(
          "expected discovery diagnostics for linux system candidate",
        );
      }
      assert.equal(configuredDiagnostic.type, "configured");
      assert.equal(configuredDiagnostic.status, "not-found");
      assert.equal(systemDiagnostic.type, "linux-system");
      if (systemDiagnostic.status === "success") {
        assert.equal(result.executable, "/usr/bin/mpv");
        assert.equal(result.diagnostics.length, 2);
        return;
      }
      if (!pathDiagnostic) {
        throw new Error("expected fallback PATH diagnostic");
      }
      assert.equal(result.diagnostics.length, 3);
      assert.equal(pathDiagnostic.type, "path");
      assert.equal(pathDiagnostic.candidate, "mpv");
      assert.equal(pathDiagnostic.status, "success");
      assert.equal(result.executable, "mpv");
      assert.equal(result.version, "mpv 1.1.0");
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  },
);

void test(
  "discoverMpv reports invalid version and continues fallback",
  { skip: process.platform === "win32" },
  async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), "eidetic-mpv-invalid-"));
    try {
      const configured = await createMockMpvBinary(
        fixtureRoot,
        "configured-mpv",
        "not-mpv",
      );
      await createMockMpvBinary(fixtureRoot, "mpv", "mpv 2.1.0");
      const result = await discoverMpv(
        {
          EIDETIC_MPV_PATH: configured,
          PATH: `${fixtureRoot}${delimiter}${process.env.PATH ?? ""}`,
          PATHEXT: process.env.PATHEXT,
        },
        "win32",
      );
      if (result === null) {
        throw new Error(
          "discoverMpv should continue after invalid configured output",
        );
      }
      assert.equal(result.version, "mpv 2.1.0");
      assert.equal(result.diagnostics.length, 2);
      const configuredDiagnostic = result.diagnostics[0];
      const fallbackDiagnostic = result.diagnostics[1];
      if (!configuredDiagnostic || !fallbackDiagnostic) {
        throw new Error(
          "expected diagnostics for invalid output and PATH fallback",
        );
      }
      assert.equal(configuredDiagnostic.status, "invalid-version");
      assert.equal(fallbackDiagnostic.status, "success");
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  },
);

void test("discoverMpv returns null when every candidate fails", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "eidetic-mpv-none-"));
  try {
    const result = await discoverMpv(
      {
        EIDETIC_MPV_PATH: "/does/not/exist",
        PATH: "",
      },
      "win32",
    );
    assert.equal(result, null);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

void test(
  "discoverMpv diagnostics do not leak configured executable path",
  { skip: process.platform === "win32" },
  async () => {
    const logs: string[] = [];
    const previousLog = console.log;
    console.log = (...values: unknown[]) => {
      logs.push(values.join(" "));
    };
    const fixtureRoot = await mkdtemp(join(tmpdir(), "eidetic-mpv-leak-"));
    try {
      const fallback = await createMockMpvBinary(
        fixtureRoot,
        "mpv",
        "mpv 2.0.0",
      );
      const candidatePath = "/this/path/will/fail";
      const result = await discoverMpv(
        {
          EIDETIC_MPV_PATH: candidatePath,
          PATH: `${fixtureRoot}${delimiter}${process.env.PATH ?? ""}`,
          PATHEXT: process.env.PATHEXT,
        },
        "win32",
      );
      if (result === null) {
        throw new Error("discoverMpv should return fallback executable result");
      }
      assert.equal(result.executable, "mpv");
      const configuredDiagnostic = result.diagnostics[0];
      const pathDiagnostic = result.diagnostics[1];
      if (!configuredDiagnostic || !pathDiagnostic) {
        throw new Error(
          "expected diagnostics for configured and PATH candidates",
        );
      }
      assert.equal(configuredDiagnostic.candidate, "configured MPV path");
      assert.equal(pathDiagnostic.candidate, "mpv");
      assert.equal(configuredDiagnostic.status, "not-found");
      assert.equal(pathDiagnostic.status, "success");
      const diagnosticsText = JSON.stringify(result.diagnostics);
      assert.equal(diagnosticsText.includes(candidatePath), false);
      const serializedLogs = logs.join("\n");
      assert.equal(serializedLogs.includes(candidatePath), false);
      assert.equal(serializedLogs.includes(fixtureRoot), false);
      assert.equal(serializedLogs.includes(fallback), false);
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
      console.log = previousLog;
    }
  },
);

void test("isValidMpvVersionLine accepts real MPV banners", () => {
  assert.equal(isValidMpvVersionLine("mpv 0.37.0"), true);
  assert.equal(isValidMpvVersionLine("mpv v0.40.0"), true);
  assert.equal(isValidMpvVersionLine("mpv 0.40.0 Copyright ..."), true);
});

void test("isValidMpvVersionLine rejects non-banner output", () => {
  assert.equal(isValidMpvVersionLine("not-mpv"), false);
  assert.equal(isValidMpvVersionLine("fake-mpv 1.0.0"), false);
  assert.equal(isValidMpvVersionLine("this is mpv 1.0.0"), false);
  assert.equal(isValidMpvVersionLine("mpv"), false);
  assert.equal(isValidMpvVersionLine("mpv unknown"), false);
  assert.equal(isValidMpvVersionLine("ffmpeg version mpv"), false);
  assert.equal(isValidMpvVersionLine(""), false);
  assert.equal(isValidMpvVersionLine("   "), false);
});
