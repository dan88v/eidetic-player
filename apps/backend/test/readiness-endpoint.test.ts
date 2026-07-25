import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReadinessResponse,
  type BootstrapReadiness,
} from "../src/readiness.js";

function response(status: BootstrapReadiness, errorCode: string | null = null) {
  return buildReadinessResponse({
    bootstrapStatus: status,
    playerStatus: "loading",
    mpvAvailable: false,
    bootstrapErrorCode: errorCode,
    playerErrorCode: null,
  });
}

void test("readiness returns safe starting payload", () => {
  const payload = response("starting");
  assert.equal(payload.status, "starting");
  assert.equal(payload.playerStatus, "loading");
  assert.equal(payload.mpvAvailable, false);
  assert.equal("errorCode" in payload, false);
});

void test("readiness returns ready payload after successful bootstrap", () => {
  const payload = response("ready");
  assert.equal(payload.status, "ready");
  assert.equal(payload.mpvAvailable, false);
  assert.equal(payload.errorCode, null);
});

void test("readiness returns degraded payload when bootstrap error is known", () => {
  const payload = buildReadinessResponse({
    bootstrapStatus: "degraded",
    playerStatus: "unavailable",
    mpvAvailable: false,
    bootstrapErrorCode: "MPV_NOT_FOUND",
    playerErrorCode: "UNUSED",
  });
  assert.equal(payload.status, "degraded");
  assert.equal(payload.errorCode, "MPV_NOT_FOUND");
  assert.equal(payload.playerStatus, "unavailable");
});

void test("readiness degrades on player error when bootstrap code is missing", () => {
  const payload = buildReadinessResponse({
    bootstrapStatus: "degraded",
    playerStatus: "error",
    mpvAvailable: false,
    bootstrapErrorCode: null,
    playerErrorCode: "MPV_UNAVAILABLE",
  });
  assert.equal(payload.status, "degraded");
  assert.equal(payload.errorCode, "MPV_UNAVAILABLE");
});
