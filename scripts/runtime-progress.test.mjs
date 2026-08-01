import assert from "node:assert/strict";
import test from "node:test";
import {
  applicationBuildSteps,
  linuxPackagingSteps,
  progressConfiguration,
  protocolLine,
  runBuildOrchestrator,
} from "./build-orchestrator.mjs";

void test("build protocol configuration is closed, numeric and open-FD validated", () => {
  let validated;
  const configuration = progressConfiguration(
    {
      EIDETIC_PROGRESS_FD: "7",
      EIDETIC_RUNTIME_PROGRESS_OFFSET: "4",
      EIDETIC_RUNTIME_PROGRESS_TOTAL: "13",
    },
    8,
    (descriptor) => {
      validated = descriptor;
    },
  );
  assert.deepEqual(configuration, { descriptor: 7, offset: 4, total: 13 });
  assert.equal(validated, 7);
  assert.equal(progressConfiguration({}, 8), null);
  for (const environment of [
    { EIDETIC_PROGRESS_FD: "7" },
    {
      EIDETIC_PROGRESS_FD: "text",
      EIDETIC_RUNTIME_PROGRESS_OFFSET: "4",
      EIDETIC_RUNTIME_PROGRESS_TOTAL: "13",
    },
    {
      EIDETIC_PROGRESS_FD: "2",
      EIDETIC_RUNTIME_PROGRESS_OFFSET: "4",
      EIDETIC_RUNTIME_PROGRESS_TOTAL: "13",
    },
    {
      EIDETIC_PROGRESS_FD: "7",
      EIDETIC_RUNTIME_PROGRESS_OFFSET: "9",
      EIDETIC_RUNTIME_PROGRESS_TOTAL: "13",
    },
  ])
    assert.throws(() => progressConfiguration(environment, 8, () => undefined));
});

void test("protocol lines contain only fixed fields and terminal duration", () => {
  assert.equal(
    protocolLine("start", "build-ui", 8, 13),
    "EIDETIC_PROGRESS_V1\truntime\tstart\tbuild-ui\t8\t13\n",
  );
  assert.equal(
    protocolLine("done", "build-ui", 8, 13, 1534),
    "EIDETIC_PROGRESS_V1\truntime\tdone\tbuild-ui\t8\t13\t1534\n",
  );
  assert.equal(
    protocolLine("skipped", "build-ui", 8, 13, 0),
    "EIDETIC_PROGRESS_V1\truntime\tskipped\tbuild-ui\t8\t13\t0\n",
  );
  assert.throws(() => protocolLine("cached", "build-ui", 8, 13, 1));
  assert.throws(() => protocolLine("done", "../../command", 8, 13, 1));
  assert.throws(() => protocolLine("done", "build-ui", 14, 13, 1));
  assert.throws(() => protocolLine("failed", "build-ui", 8, 13, -1));
});

void test("application build runs every canonical command once in order", async () => {
  const commands = [];
  let clock = 0n;
  const status = await runBuildOrchestrator("app", {
    environment: {},
    runner: (command, arguments_) => {
      commands.push([command, ...arguments_]);
      return Promise.resolve(0);
    },
    nowNanoseconds: () => {
      clock += 1_000_000n;
      return clock;
    },
  });
  assert.equal(status, 0);
  assert.deepEqual(
    commands,
    applicationBuildSteps.map((step) => [step.command, ...step.arguments]),
  );
});

void test("Linux build reuses app build then packages Neutralino exactly once", async () => {
  const commands = [];
  const status = await runBuildOrchestrator("linux", {
    environment: {},
    runner: (command, arguments_) => {
      commands.push([command, ...arguments_]);
      return Promise.resolve(0);
    },
  });
  assert.equal(status, 0);
  assert.deepEqual(commands, [
    ["npm", "run", "build"],
    ...linuxPackagingSteps.map((step) => [step.command, ...step.arguments]),
  ]);
});

void test("Neutralino synchronization retries twice before succeeding", async () => {
  const commands = [];
  const delays = [];
  let syncAttempts = 0;
  const status = await runBuildOrchestrator("linux", {
    environment: {},
    runner: (command, arguments_) => {
      commands.push([command, ...arguments_]);
      if (arguments_[1] === "neutralino:sync") {
        syncAttempts += 1;
        return Promise.resolve(syncAttempts < 3 ? 1 : 0);
      }
      return Promise.resolve(0);
    },
    wait: (milliseconds) => {
      delays.push(milliseconds);
      return Promise.resolve();
    },
  });
  assert.equal(status, 0);
  assert.equal(syncAttempts, 3);
  assert.deepEqual(delays, [5_000, 10_000]);
  assert.deepEqual(commands.at(-1), ["npm", "run", "neutralino:build"]);
});

void test("orchestrator stops at the exact failed command and preserves status", async () => {
  const commands = [];
  const status = await runBuildOrchestrator("app", {
    environment: {},
    runner: (command, arguments_) => {
      commands.push([command, ...arguments_]);
      return Promise.resolve(commands.length === 3 ? 37 : 0);
    },
  });
  assert.equal(status, 37);
  assert.equal(commands.length, 3);
});
