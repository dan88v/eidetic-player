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
      EIDETIC_RUNTIME_PROGRESS_TOTAL: "12",
    },
    7,
    (descriptor) => {
      validated = descriptor;
    },
  );
  assert.deepEqual(configuration, { descriptor: 7, offset: 4, total: 12 });
  assert.equal(validated, 7);
  assert.equal(progressConfiguration({}, 7), null);
  for (const environment of [
    { EIDETIC_PROGRESS_FD: "7" },
    {
      EIDETIC_PROGRESS_FD: "text",
      EIDETIC_RUNTIME_PROGRESS_OFFSET: "4",
      EIDETIC_RUNTIME_PROGRESS_TOTAL: "12",
    },
    {
      EIDETIC_PROGRESS_FD: "2",
      EIDETIC_RUNTIME_PROGRESS_OFFSET: "4",
      EIDETIC_RUNTIME_PROGRESS_TOTAL: "12",
    },
    {
      EIDETIC_PROGRESS_FD: "7",
      EIDETIC_RUNTIME_PROGRESS_OFFSET: "8",
      EIDETIC_RUNTIME_PROGRESS_TOTAL: "12",
    },
  ])
    assert.throws(() => progressConfiguration(environment, 7, () => undefined));
});

void test("protocol lines contain only fixed fields and terminal duration", () => {
  assert.equal(
    protocolLine("start", "build-ui", 8, 12),
    "EIDETIC_PROGRESS_V1\truntime\tstart\tbuild-ui\t8\t12\n",
  );
  assert.equal(
    protocolLine("done", "build-ui", 8, 12, 1534),
    "EIDETIC_PROGRESS_V1\truntime\tdone\tbuild-ui\t8\t12\t1534\n",
  );
  assert.equal(
    protocolLine("skipped", "build-ui", 8, 12, 0),
    "EIDETIC_PROGRESS_V1\truntime\tskipped\tbuild-ui\t8\t12\t0\n",
  );
  assert.throws(() => protocolLine("cached", "build-ui", 8, 12, 1));
  assert.throws(() => protocolLine("done", "../../command", 8, 12, 1));
  assert.throws(() => protocolLine("done", "build-ui", 13, 12, 1));
  assert.throws(() => protocolLine("failed", "build-ui", 8, 12, -1));
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
