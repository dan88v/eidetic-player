import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  finalPowerActionFixtures,
  isSystemPowerAction,
  systemPowerActions,
} from "../../../packages/shared/src/system.js";
import {
  PowerActionCoordinator,
  PowerActionError,
  validatePowerActionBody,
} from "../src/system/power-action-coordinator.js";

void test("power actions are closed and final fixture order is explicit", () => {
  assert.deepEqual(systemPowerActions, [
    "quit",
    "restart-app",
    "maintenance",
    "reboot",
    "shutdown",
  ]);
  assert.deepEqual(finalPowerActionFixtures.development, ["quit"]);
  assert.deepEqual(finalPowerActionFixtures.standard, [
    "quit",
    "reboot",
    "shutdown",
  ]);
  assert.deepEqual(finalPowerActionFixtures.appliance, [
    "restart-app",
    "maintenance",
    "reboot",
    "shutdown",
  ]);
  assert.equal(isSystemPowerAction("poweroff --force"), false);
});

void test("power body accepts only one closed action field", () => {
  assert.equal(validatePowerActionBody({ action: "quit" }), "quit");
  for (const body of [
    null,
    [],
    {},
    { action: "unknown" },
    { action: "quit", command: "shutdown" },
    { action: "quit", path: "/bin/sh" },
    { action: "quit", args: ["--force"] },
  ])
    assert.throws(
      () => validatePowerActionBody(body),
      (error: unknown) =>
        error instanceof PowerActionError &&
        error.code === "INVALID_POWER_ACTION" &&
        error.statusCode === 400,
    );
});

void test("coordinator flushes before one fixture adapter invocation", async () => {
  const order: string[] = [];
  const coordinator = new PowerActionCoordinator(
    finalPowerActionFixtures.standard,
    () => {
      order.push("flush");
      return Promise.resolve();
    },
    {
      execute(action) {
        order.push(action);
        return Promise.resolve();
      },
    },
  );
  await coordinator.request("reboot");
  assert.deepEqual(order, ["flush", "reboot"]);
  await assert.rejects(
    coordinator.request("shutdown"),
    (error: unknown) =>
      error instanceof PowerActionError && error.code === "ACTION_IN_PROGRESS",
  );
});

void test("unavailable actions and failed flush never invoke the adapter", async () => {
  let calls = 0;
  const unavailable = new PowerActionCoordinator(
    ["quit"],
    () => Promise.resolve(),
    { execute: () => Promise.resolve(void (calls += 1)) },
  );
  await assert.rejects(
    unavailable.request("shutdown"),
    (error: unknown) =>
      error instanceof PowerActionError &&
      error.code === "ACTION_NOT_AVAILABLE" &&
      error.statusCode === 409,
  );
  const failed = new PowerActionCoordinator(
    ["quit"],
    () => Promise.reject(new Error("disk")),
    { execute: () => Promise.resolve(void (calls += 1)) },
  );
  await assert.rejects(
    failed.request("quit"),
    (error: unknown) =>
      error instanceof PowerActionError &&
      error.code === "POWER_PREPARATION_FAILED",
  );
  assert.equal(calls, 0);
});

void test("production exposes no B action and legacy maintenance shares coordinator", () => {
  const backend = readFileSync("apps/backend/src/index.ts", "utf8");
  assert.match(
    backend,
    /installationMode === "appliance" \? \["maintenance"\] : \["quit"\]/u,
  );
  assert.match(
    backend,
    /url\.pathname === "\/api\/system\/power"[\s\S]*url\.pathname === "\/api\/system\/maintenance"/u,
  );
  assert.match(
    backend,
    /validatePowerActionBody\(await readBody\(request\)\)/u,
  );
  assert.doesNotMatch(backend, /execCommand|systemctl|poweroff/u);
});
