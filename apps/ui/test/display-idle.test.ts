import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultDisplaySnapshot,
  displayTimeoutsAreCompatible,
} from "../../../packages/shared/src/display.js";
import {
  DisplayIdleController,
  nextDisplayIdleDeadline,
} from "../src/display/display-idle-controller.js";
import type { DisplayApiClient } from "../src/api/display-api-client.js";

const preferences = {
  screenDimTimeoutSeconds: 60 as const,
  screenDimLevelPercent: 20 as const,
  screenStandbyTimeoutSeconds: 300 as const,
};

void test("display timeout contract requires standby to follow dim", () => {
  assert.equal(displayTimeoutsAreCompatible(60, 300), true);
  assert.equal(displayTimeoutsAreCompatible(300, 300), false);
  assert.equal(displayTimeoutsAreCompatible(600, 300), false);
  assert.equal(displayTimeoutsAreCompatible(0, 300), true);
  assert.equal(displayTimeoutsAreCompatible(60, 0), true);
});

void test("idle deadline uses one monotonic activity epoch", () => {
  assert.deepEqual(
    nextDisplayIdleDeadline(10_000, 10_000, preferences, "active", true),
    { kind: "dim", at: 70_000 },
  );
  assert.deepEqual(
    nextDisplayIdleDeadline(70_000, 10_000, preferences, "active", true),
    { kind: "dim", at: 70_000 },
  );
  assert.deepEqual(
    nextDisplayIdleDeadline(70_000, 10_000, preferences, "dimmed", true),
    { kind: "standby", at: 310_000 },
  );
});

void test("HDMI inhibition removes standby but preserves dim", () => {
  assert.deepEqual(
    nextDisplayIdleDeadline(
      10_000,
      10_000,
      preferences,
      defaultDisplaySnapshot.state,
      false,
    ),
    { kind: "dim", at: 70_000 },
  );
  assert.equal(
    nextDisplayIdleDeadline(70_000, 10_000, preferences, "dimmed", false),
    null,
  );
});

void test("disabled policies schedule no work", () => {
  assert.equal(
    nextDisplayIdleDeadline(
      0,
      0,
      {
        screenDimTimeoutSeconds: 0,
        screenDimLevelPercent: 20,
        screenStandbyTimeoutSeconds: 0,
      },
      "active",
      true,
    ),
    null,
  );
});

class FakeClassList {
  private readonly values = new Set<string>();
  toggle(name: string, force?: boolean): boolean {
    const enabled = force ?? !this.values.has(name);
    if (enabled) this.values.add(name);
    else this.values.delete(name);
    return enabled;
  }
}

class FakeElement {
  readonly classList = new FakeClassList();
  readonly dataset: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  readonly style = { setProperty: () => undefined };
  className = "";
  hidden = false;
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  remove(): void {
    this.hidden = true;
  }
}

class FakeDocument extends EventTarget {
  createElement(): FakeElement {
    return new FakeElement();
  }
}

function controllerFixture(state: "active" | "dimmed" | "standby"): {
  readonly controller: DisplayIdleController;
  readonly document: FakeDocument;
  readonly wakeCalls: { value: number };
  readonly destroy: () => void;
} {
  const fakeDocument = new FakeDocument();
  const children: FakeElement[] = [];
  const wakeCalls = { value: 0 };
  let now = 1_000;
  let nextTimer = 0;
  const fakeWindow = {
    performance: { now: () => now },
    setTimeout: () => {
      nextTimer += 1;
      return nextTimer;
    },
    clearTimeout: () => undefined,
  };
  const activeSnapshot = {
    ...defaultDisplaySnapshot,
    state: "active" as const,
    standbyAvailable: true,
    standbyMethod: "fixture" as const,
  };
  const api = {
    wake: () => {
      wakeCalls.value += 1;
      now += 1;
      return Promise.resolve(activeSnapshot);
    },
  };
  const controller = new DisplayIdleController({
    root: {
      append: (...elements: FakeElement[]) => children.push(...elements),
    } as unknown as HTMLElement,
    document: fakeDocument as unknown as Document,
    window: fakeWindow as unknown as Window,
    api: api as unknown as DisplayApiClient,
    initialSnapshot: { ...activeSnapshot, state },
    preferences: {
      screenDimTimeoutSeconds: 0,
      screenDimLevelPercent: 20,
      screenStandbyTimeoutSeconds: 0,
    },
    animationsEnabled: false,
    onSnapshot: () => undefined,
    onError: (message) => {
      throw new Error(message);
    },
  });
  return {
    controller,
    document: fakeDocument,
    wakeCalls,
    destroy: () => {
      controller.destroy();
    },
  };
}

void test("active pointer input is untouched", () => {
  const fixture = controllerFixture("active");
  let underlyingCalls = 0;
  fixture.document.addEventListener("pointerdown", () => {
    underlyingCalls += 1;
  });
  const event = new Event("pointerdown", { cancelable: true });
  fixture.document.dispatchEvent(event);
  assert.equal(event.defaultPrevented, false);
  assert.equal(underlyingCalls, 1);
  assert.equal(fixture.wakeCalls.value, 0);
  fixture.destroy();
});

void test("first dimmed input is consumed and the second is normal", async () => {
  const fixture = controllerFixture("dimmed");
  let underlyingCalls = 0;
  fixture.document.addEventListener("pointerdown", () => {
    underlyingCalls += 1;
  });
  const first = new Event("pointerdown", { cancelable: true });
  fixture.document.dispatchEvent(first);
  assert.equal(first.defaultPrevented, true);
  assert.equal(underlyingCalls, 0);
  const compatibilityClick = new Event("click", { cancelable: true });
  fixture.document.dispatchEvent(compatibilityClick);
  assert.equal(compatibilityClick.defaultPrevented, true);
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  assert.equal(fixture.wakeCalls.value, 1);
  const second = new Event("pointerdown", { cancelable: true });
  fixture.document.dispatchEvent(second);
  assert.equal(second.defaultPrevented, false);
  assert.equal(underlyingCalls, 1);
  fixture.destroy();
});

void test("click-only touch fallback wakes without activating the control", async () => {
  const fixture = controllerFixture("dimmed");
  let underlyingCalls = 0;
  fixture.document.addEventListener("click", () => {
    underlyingCalls += 1;
  });
  const first = new Event("click", { cancelable: true });
  fixture.document.dispatchEvent(first);
  assert.equal(first.defaultPrevented, true);
  assert.equal(underlyingCalls, 0);
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  assert.equal(fixture.wakeCalls.value, 1);
  const second = new Event("click", { cancelable: true });
  fixture.document.dispatchEvent(second);
  assert.equal(second.defaultPrevented, false);
  assert.equal(underlyingCalls, 1);
  fixture.destroy();
});

void test("standby key and wheel wake events are consumed", async () => {
  for (const eventName of ["keydown", "wheel"]) {
    const fixture = controllerFixture("standby");
    let underlyingCalls = 0;
    fixture.document.addEventListener(eventName, () => {
      underlyingCalls += 1;
    });
    const event = new Event(eventName, { cancelable: true });
    fixture.document.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    assert.equal(underlyingCalls, 0);
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    assert.equal(fixture.wakeCalls.value, 1);
    fixture.destroy();
  }
});

void test("HDMI standby deadline declares inhibition and release restores dimmed", () => {
  const fixture = controllerFixture("dimmed");
  fixture.controller.setHdmiAudioActive(true);
  (
    fixture.controller as unknown as {
      transition(kind: "standby"): void;
    }
  ).transition("standby");
  assert.equal(fixture.controller.getSnapshot().state, "inhibited");
  assert.equal(
    fixture.controller.getSnapshot().standbyInhibitedReason,
    "hdmi-audio-active",
  );
  fixture.controller.setHdmiAudioActive(false);
  assert.equal(fixture.controller.getSnapshot().state, "dimmed");
  assert.equal(fixture.controller.getSnapshot().standbyInhibitedReason, null);
  fixture.destroy();
});
