import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LocalFilesystemProvider } from "../src/filesystem/local-filesystem-provider.js";
import { PathService } from "../src/filesystem/path-service.js";
import { SmbConnectionRepository } from "../src/smb/smb-connection-repository.js";
import {
  LinuxSmbCredentialStore,
  MemorySmbCredentialStore,
} from "../src/smb/smb-credential-store.js";
import { SmbConnectionService } from "../src/smb/smb-connection-service.js";
import {
  FixtureSmbAdapter,
  type SmbPlatformAdapter,
} from "../src/smb/smb-platform-adapter.js";
import type {
  SmbAdapterConnection,
  SmbCredential,
} from "../src/smb/smb-types.js";
import { SmbError } from "../src/smb/smb-types.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "eidetic-smb-test-"));
  const share = join(root, "share");
  await mkdir(share);
  await writeFile(join(share, "track10.mp3"), "fixture");
  await writeFile(join(share, "track2.mp3"), "fixture");
  const provider = new LocalFilesystemProvider();
  const paths = PathService.forCurrentPlatform(provider);
  const repository = new SmbConnectionRepository(
    join(root, "connections.json"),
  );
  const credentials = new MemorySmbCredentialStore();
  const adapter = new FixtureSmbAdapter(share);
  const service = new SmbConnectionService(
    provider,
    paths,
    repository,
    credentials,
    adapter,
  );
  return { root, share, provider, paths, repository, credentials, service };
}

void test("add persists only non-secret SMB connection data and remove cleans it", async () => {
  const context = await fixture();
  try {
    await context.service.initialize();
    const connection = await context.service.add({
      displayName: "Studio NAS",
      server: "nas.local",
      share: "Music",
      authMode: "account",
      username: "listener",
      password: "never-persist-this",
      domain: "WORKGROUP",
    });
    assert.equal(connection.state, "connected");
    assert.equal(connection.readable, true);
    const text = await readFile(context.repository.configPath, "utf8");
    assert.doesNotMatch(text, /never-persist-this/u);
    assert.doesNotMatch(text, /"password"/u);
    assert.match(text, /credentialReference/u);
    assert.equal(context.service.snapshot().configuredCount, 1);
    await context.service.remove(connection.id);
    assert.equal(context.service.snapshot().configuredCount, 0);
    assert.deepEqual(await context.repository.list(), []);
  } finally {
    await context.service.close();
    await rm(context.root, { recursive: true, force: true });
  }
});

void test("SMB validation rejects duplicate names, duplicate shares, and Guest secrets", async () => {
  const context = await fixture();
  try {
    await context.service.initialize();
    const first = await context.service.add({
      displayName: "  Studio   NAS ",
      server: "NAS.LOCAL",
      share: "Music",
      authMode: "guest",
      username: "ignored",
      password: "ignored",
      domain: "ignored",
    });
    assert.equal(first.displayName, "Studio NAS");
    assert.equal(first.server, "nas.local");
    assert.equal(first.username, undefined);
    assert.equal(first.domain, undefined);
    await assert.rejects(
      context.service.add({
        displayName: "studio nas",
        server: "other.local",
        share: "Audio",
        authMode: "guest",
      }),
      /already uses this name/u,
    );
    await assert.rejects(
      context.service.add({
        displayName: "Second",
        server: "nas.local",
        share: "music",
        authMode: "guest",
      }),
      /already configured/u,
    );
    await assert.rejects(
      context.service.add({
        displayName: "Traversal",
        server: "nas.local/path",
        share: "../music",
        authMode: "guest",
      }),
      /without slashes|share name/u,
    );
  } finally {
    await context.service.close();
    await rm(context.root, { recursive: true, force: true });
  }
});

void test("failed first connection leaves neither record nor credential", async () => {
  const context = await fixture();
  const writes = new Set<string>();
  const store = {
    async write(id: string, credential: SmbCredential) {
      writes.add(id);
      await context.credentials.write(id, credential);
      return `fixture:${id}`;
    },
    read: (reference: string) => context.credentials.read(reference),
    async remove(reference: string) {
      writes.delete(reference.replace("fixture:", ""));
      await context.credentials.remove(reference);
    },
  };
  const failing: SmbPlatformAdapter = {
    connect(): Promise<SmbAdapterConnection> {
      return Promise.reject(new Error("offline"));
    },
    disconnect: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
  const service = new SmbConnectionService(
    context.provider,
    context.paths,
    context.repository,
    store,
    failing,
  );
  try {
    await service.initialize();
    await assert.rejects(
      service.add({
        displayName: "Offline",
        server: "offline.local",
        share: "Music",
        authMode: "account",
        username: "listener",
        password: "temporary",
      }),
      /Unable to connect/u,
    );
    assert.equal(writes.size, 0);
    assert.deepEqual(await context.repository.list(), []);
  } finally {
    await service.close();
    await rm(context.root, { recursive: true, force: true });
  }
});

void test("Linux credential files are private mode 0600 and removable", async () => {
  const root = await mkdtemp(join(tmpdir(), "eidetic-smb-secret-"));
  const store = new LinuxSmbCredentialStore(root);
  try {
    const reference = await store.write(
      "smb-0123456789abcdef0123456789abcdef",
      {
        username: "listener",
        password: "secret",
        domain: "WORKGROUP",
      },
    );
    if (process.platform !== "win32") {
      assert.equal((await stat(reference)).mode & 0o777, 0o600);
      assert.equal((await stat(root)).mode & 0o777, 0o700);
    }
    const credential = await store.read(reference);
    assert.ok(credential);
    assert.equal(credential.password, "secret");
    assert.equal(credential.filePath, reference);
    await store.remove(reference);
    await assert.rejects(stat(reference), /ENOENT/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("adapter source enforces deviceless UNC and conservative CIFS boundaries", async () => {
  const source = await readFile(
    new URL("../src/smb/smb-platform-adapter.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /WNetAddConnection2W/u);
  assert.match(source, /LocalName=\$null/u);
  assert.doesNotMatch(source, /net use \*|\/delete\s+\*/iu);
  assert.match(source, /"ro", "nosuid", "nodev", "noexec"/u);
  assert.match(source, /credentials=\$\{credential\.filePath\}/u);
  assert.doesNotMatch(source, /vers=1\.0/u);
  assert.doesNotMatch(source, /sudo/u);
});

void test("service uses one bounded scheduler and one global SSE hub", async () => {
  const service = await readFile(
    new URL("../src/smb/smb-connection-service.ts", import.meta.url),
    "utf8",
  );
  const hub = await readFile(
    new URL("../src/api/smb-sse-hub.ts", import.meta.url),
    "utf8",
  );
  assert.match(service, /new LimitedConcurrency\(2\)/u);
  assert.match(service, /\[2_000, 5_000, 15_000, 30_000, 60_000\]/u);
  assert.match(service, /private retryTimer: NodeJS\.Timeout \| null/u);
  assert.match(hub, /private readonly clients = new Set<ServerResponse>\(\)/u);
  assert.doesNotMatch(hub, /connectionId/u);
});

void test("bootstrap caps connection concurrency at two", async () => {
  const context = await fixture();
  let active = 0;
  let maximum = 0;
  const adapter: SmbPlatformAdapter = {
    async connect() {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
      return { root: context.share };
    },
    disconnect: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
  const now = new Date().toISOString();
  await context.repository.replace(
    ["a", "b", "c"].map((suffix, index) => ({
      id: `smb-${String(index + 1).padStart(32, "0")}`,
      displayName: `Share ${suffix}`,
      server: `${suffix}.local`,
      share: "Music",
      authMode: "guest" as const,
      createdAt: now,
      updatedAt: now,
    })),
  );
  const service = new SmbConnectionService(
    context.provider,
    context.paths,
    context.repository,
    context.credentials,
    adapter,
  );
  try {
    await service.initialize();
    assert.equal(maximum, 2);
    assert.equal(service.snapshot().connectedCount, 3);
  } finally {
    await service.close();
    await rm(context.root, { recursive: true, force: true });
  }
});

void test("authentication errors do not schedule retries", async () => {
  const context = await fixture();
  const id = "smb-11111111111111111111111111111111";
  const reference = await context.credentials.write(id, {
    username: "listener",
    password: "rejected",
  });
  const now = new Date().toISOString();
  await context.repository.replace([
    {
      id,
      displayName: "Protected",
      server: "protected.local",
      share: "Music",
      authMode: "account",
      username: "listener",
      credentialReference: reference,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  const adapter: SmbPlatformAdapter = {
    connect: () =>
      Promise.reject(
        new SmbError(
          "authentication-required",
          "The SMB credentials were not accepted.",
        ),
      ),
    disconnect: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
  const service = new SmbConnectionService(
    context.provider,
    context.paths,
    context.repository,
    context.credentials,
    adapter,
  );
  try {
    await service.initialize();
    const connection = service.snapshot().connections[0];
    assert.ok(connection);
    assert.equal(connection.state, "authentication-required");
    assert.equal(connection.retryable, false);
    assert.equal(service.diagnostics().pendingRetries, 0);
    assert.equal(service.diagnostics().schedulerActive, false);
  } finally {
    await service.close();
    await rm(context.root, { recursive: true, force: true });
  }
});

void test("network recovery resets transient backoff without autoplay work", async () => {
  const context = await fixture();
  const now = new Date().toISOString();
  await context.repository.replace([
    {
      id: "smb-22222222222222222222222222222222",
      displayName: "Transient",
      server: "transient.local",
      share: "Music",
      authMode: "guest",
      createdAt: now,
      updatedAt: now,
    },
  ]);
  let attempts = 0;
  const adapter: SmbPlatformAdapter = {
    connect: () => {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(
            new SmbError(
              "network-unavailable",
              "The network share is unavailable.",
            ),
          )
        : Promise.resolve({ root: context.share });
    },
    disconnect: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
  const service = new SmbConnectionService(
    context.provider,
    context.paths,
    context.repository,
    context.credentials,
    adapter,
  );
  try {
    await service.initialize();
    assert.equal(service.snapshot().connections[0]?.state, "offline");
    assert.equal(service.diagnostics().pendingRetries, 1);
    await service.networkAvailable();
    assert.equal(service.snapshot().connections[0]?.state, "connected");
    assert.equal(service.diagnostics().pendingRetries, 0);
    assert.equal(service.diagnostics().schedulerActive, false);
    assert.equal(attempts, 2);
  } finally {
    await service.close();
    await rm(context.root, { recursive: true, force: true });
  }
});

void test("SMB public and Queue contracts never contain a native root", async () => {
  const playerTypes = await readFile(
    new URL("../src/player-session/player-session-types.ts", import.meta.url),
    "utf8",
  );
  const player = await readFile(
    new URL("../src/player/player-service.ts", import.meta.url),
    "utf8",
  );
  assert.match(playerTypes, /readonly kind: "smb"/u);
  assert.match(playerTypes, /readonly connectionId: string/u);
  assert.match(playerTypes, /readonly relativePath: string/u);
  const smbOrigin =
    /\{\s*readonly kind: "smb";[\s\S]*?readonly entryId: string;\s*\}/u.exec(
      playerTypes,
    )?.[0] ?? "";
  assert.doesNotMatch(smbOrigin, /nativePath|root|password/u);
  assert.match(
    player,
    /`smb:\/\/\$\{origin\.connectionId\}\/\$\{logicalPath\}`/u,
  );
});
