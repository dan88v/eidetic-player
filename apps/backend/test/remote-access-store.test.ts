import assert from "node:assert/strict";
import { chmod, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import test from "node:test";
import type { RemoteAccessState } from "../../../packages/shared/src/remote-access.js";
import {
  RemoteAccessStore,
  normalizeRemoteDeviceName,
} from "../src/remote-access/remote-access-store.js";
import {
  hashRemoteToken,
  isPrivateOrLinkLocalIpv4,
  RemoteAccessService,
  remoteIpv4,
} from "../src/remote-access/remote-access-service.js";

void test("Remote Access store defaults Off and writes atomically with private permissions", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-remote-store-"));
  const path = join(root, "config", "remote-access.json");
  try {
    const store = new RemoteAccessStore(path);
    const initial = await store.load();
    assert.equal(initial.document.enabled, false);
    assert.deepEqual(initial.document.devices, []);
    await store.save({
      ...initial.document,
      revision: 2,
      enabled: true,
      retainedFutureField: { safe: true },
    });
    const saved = JSON.parse(await readFile(path, "utf8")) as Record<
      string,
      unknown
    >;
    assert.equal(saved.enabled, true);
    assert.deepEqual(saved.retainedFutureField, { safe: true });
    const leftovers = await import("node:fs/promises").then(({ readdir }) =>
      readdir(join(root, "config")),
    );
    assert.deepEqual(leftovers, ["remote-access.json"]);
    if (process.platform !== "win32") {
      assert.equal((await lstat(join(root, "config"))).mode & 0o777, 0o700);
      assert.equal((await lstat(path)).mode & 0o777, 0o600);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("Remote Access store rejects malformed devices, symlinks, and wrong owner modes safely", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-remote-invalid-"));
  const directory = join(root, "config");
  const path = join(directory, "remote-access.json");
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: 1,
        revision: 1,
        enabled: false,
        devices: [{ id: "unsafe", tokenHash: "raw-token" }],
      }),
    );
    await assert.rejects(() => new RemoteAccessStore(path).load());
    if (process.platform === "win32") {
      context.skip("ordinary Windows test accounts cannot create symlinks");
      return;
    }
    await rm(path);
    const target = join(root, "target.json");
    await writeFile(target, "{}");
    await import("node:fs/promises").then(({ symlink }) =>
      symlink(target, path),
    );
    await assert.rejects(
      () => new RemoteAccessStore(path).load(),
      /symbolic links/u,
    );
    await chmod(directory, 0o755);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("future Remote Access schema enters read-only degraded mode", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-remote-future-"));
  const path = join(root, "remote-access.json");
  try {
    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: 99,
        revision: 50,
        enabled: true,
        devices: [],
        future: "preserve on disk",
      }),
    );
    const loaded = await new RemoteAccessStore(path).load();
    assert.equal(loaded.readOnly, true);
    assert.equal(loaded.document.enabled, false);
    assert.match(await readFile(path, "utf8"), /preserve on disk/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("pairing is six-digit, one-time, bounded, and persists only a token hash", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-remote-pair-"));
  const path = join(root, "remote-access.json");
  const store = new RemoteAccessStore(path);
  const service = new RemoteAccessService(true, true, store);
  service.attachLifecycle({
    start: () => Promise.resolve(),
    stop: () => Promise.resolve(),
  });
  try {
    await service.initialize();
    await service.enable();
    const pairingUpdates: RemoteAccessState[] = [];
    const unsubscribe = service.subscribe((state) => {
      pairingUpdates.push(state);
    });
    const pairing = service.createPairingCode();
    assert.match(pairing.code, /^[0-9]{6}$/u);
    assert.match(pairing.displayCode, /^[0-9]{3} [0-9]{3}$/u);
    await assert.rejects(
      () => service.pair("000 000", "Phone", "127.0.0.1"),
      /invalid/u,
    );
    const result = await service.pair(
      pairing.code,
      "  Daniele’s iPhone  ",
      "127.0.0.1",
    );
    assert.equal(result.device.name, "Daniele’s iPhone");
    assert.equal(result.token.length, 43);
    assert.equal(result.csrfToken.length, 43);
    const completedUpdates = pairingUpdates.filter(
      (state) => state.devices.length === 1,
    );
    assert.equal(completedUpdates.length, 1);
    assert.equal(completedUpdates[0]?.pairing, null);
    unsubscribe();
    assert.equal(
      (await service.authenticate(result.token))?.device.id,
      result.device.id,
    );
    await assert.rejects(
      () => service.pair(pairing.code, "Second", "127.0.0.1"),
      /expired/u,
    );
    const stored = await readFile(path, "utf8");
    assert.doesNotMatch(stored, new RegExp(result.token, "u"));
    assert.doesNotMatch(stored, new RegExp(pairing.code, "u"));
    assert.match(stored, new RegExp(hashRemoteToken(result.token), "u"));
    await service.revoke(result.device.id);
    assert.equal(await service.authenticate(result.token), null);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

void test("pairing stops after five attempts per code and IP", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-remote-attempts-"));
  const service = new RemoteAccessService(
    true,
    true,
    new RemoteAccessStore(join(root, "remote-access.json")),
  );
  service.attachLifecycle({
    start: () => Promise.resolve(),
    stop: () => Promise.resolve(),
  });
  try {
    await service.initialize();
    await service.enable();
    service.createPairingCode();
    for (let attempt = 0; attempt < 5; attempt += 1)
      await assert.rejects(
        () => service.pair("999999", "Phone", "127.0.0.1"),
        /invalid|attempts/u,
      );
    await assert.rejects(
      () => service.pair("999999", "Phone", "127.0.0.1"),
      /expired|attempts/u,
    );
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

void test("pairing cancel, disable/re-enable, revoke-all, expiry, and device cap are enforced", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-remote-lifecycle-"));
  const path = join(root, "remote-access.json");
  const service = new RemoteAccessService(
    true,
    true,
    new RemoteAccessStore(path),
  );
  service.attachLifecycle({
    start: () => Promise.resolve(),
    stop: () => Promise.resolve(),
  });
  try {
    await service.initialize();
    await service.enable();
    const cancelled = service.createPairingCode();
    service.cancelPairing();
    await assert.rejects(
      () => service.pair(cancelled.code, "Phone", "127.0.0.1"),
      /expired/u,
    );

    const active = service.createPairingCode();
    const paired = await service.pair(
      active.code,
      "Persistent phone",
      "127.0.0.1",
    );
    const invalidated = service.createPairingCode();
    await service.disable();
    await assert.rejects(
      () => service.pair(invalidated.code, "Other", "127.0.0.1"),
      /expired/u,
    );
    await service.enable();
    assert.equal(
      (await service.authenticate(paired.token))?.device.id,
      paired.device.id,
    );
    await service.revokeAll();
    assert.equal(await service.authenticate(paired.token), null);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }

  const cappedRoot = await mkdtemp(join(tmpdir(), "eidetic-remote-cap-"));
  const cappedPath = join(cappedRoot, "remote-access.json");
  const now = Date.now();
  try {
    await writeFile(
      cappedPath,
      JSON.stringify({
        schemaVersion: 1,
        revision: 1,
        enabled: true,
        devices: Array.from({ length: 8 }, (_, index) => ({
          id: `remote-device-${String(index).padStart(32, "0")}`,
          name: `Device ${String(index + 1)}`,
          tokenHash: "a".repeat(43),
          createdAt: new Date(now).toISOString(),
          lastSeenAt: new Date(now).toISOString(),
          expiresAt: new Date(now + 86_400_000).toISOString(),
        })),
      }),
    );
    const capped = new RemoteAccessService(
      true,
      true,
      new RemoteAccessStore(cappedPath),
    );
    capped.attachLifecycle({
      start: () => Promise.resolve(),
      stop: () => Promise.resolve(),
    });
    await capped.initialize();
    await capped.startStoredPreference();
    assert.throws(() => capped.createPairingCode(), /maximum of eight/u);
    await capped.close();
  } finally {
    await rm(cappedRoot, { recursive: true, force: true });
  }
});

void test("paired session survives a backend service restart with a fresh CSRF token", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-remote-restart-"));
  const path = join(root, "remote-access.json");
  const lifecycle = {
    start: () => Promise.resolve(),
    stop: () => Promise.resolve(),
  };
  const first = new RemoteAccessService(
    true,
    true,
    new RemoteAccessStore(path),
  );
  first.attachLifecycle(lifecycle);
  try {
    await first.initialize();
    await first.enable();
    const pairing = first.createPairingCode();
    const paired = await first.pair(
      pairing.code,
      "Restart browser",
      "127.0.0.1",
    );
    await first.close();

    const restarted = new RemoteAccessService(
      true,
      true,
      new RemoteAccessStore(path),
    );
    restarted.attachLifecycle(lifecycle);
    await restarted.initialize();
    await restarted.startStoredPreference();
    const authenticated = await restarted.authenticate(paired.token);
    assert.ok(authenticated);
    assert.equal(authenticated.device.id, paired.device.id);
    assert.equal(authenticated.csrfToken.length, 43);
    assert.notEqual(authenticated.csrfToken, paired.csrfToken);
    await restarted.close();
  } finally {
    await first.close();
    await rm(root, { recursive: true, force: true });
  }
});

void test("Remote Access validation accepts private/link-local IPv4 only", () => {
  for (const address of [
    "10.0.0.2",
    "172.16.0.1",
    "172.31.255.254",
    "192.168.1.8",
    "169.254.2.3",
  ])
    assert.equal(isPrivateOrLinkLocalIpv4(address), true, address);
  for (const address of [
    "8.8.8.8",
    "172.32.0.1",
    "192.167.1.1",
    "::1",
    "invalid",
  ])
    assert.equal(isPrivateOrLinkLocalIpv4(address), false, address);
  assert.equal(remoteIpv4("::ffff:192.168.1.2", false), "192.168.1.2");
  assert.equal(remoteIpv4("127.0.0.1", false), null);
  assert.equal(remoteIpv4("127.0.0.1", true), "127.0.0.1");
});

void test("device names reject controls and unsafe lengths", () => {
  assert.equal(normalizeRemoteDeviceName("  Téléphone  "), "Téléphone");
  assert.throws(() => normalizeRemoteDeviceName(""));
  assert.throws(() => normalizeRemoteDeviceName("bad\u0000name"));
  assert.throws(() => normalizeRemoteDeviceName("x".repeat(41)));
});
