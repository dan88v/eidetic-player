const POINTER_HIDE_MILLISECONDS = 2_500;
const MOUSE_CONFIRMATION_MILLISECONDS = 1_200;
const MOUSE_CONFIRMATION_DISTANCE = 12;
const MOUSE_CONFIRMATION_SAMPLES = 3;
const TOUCH_COMPATIBILITY_SUPPRESSION_MILLISECONDS = 2_500;

interface PointerInput {
  readonly pointerType: string;
  readonly movementX: number;
  readonly movementY: number;
  readonly buttons?: number;
  readonly sourceCapabilities?: {
    readonly firesTouchEvents?: boolean;
  } | null;
}

export type PointerVisibilityDecision = "hide" | "show" | "unchanged";

function isTouchInput(event: PointerInput): boolean {
  return (
    event.pointerType === "touch" ||
    event.pointerType === "pen" ||
    event.sourceCapabilities?.firesTouchEvents === true
  );
}

export class PointerModalityTracker {
  private lastMouseMoveAt = Number.NEGATIVE_INFINITY;
  private mouseMoveSamples = 0;
  private mouseMoveDistance = 0;
  private mouseConfirmed = false;
  private suppressMouseUntil = Number.NEGATIVE_INFINITY;

  moved(event: PointerInput, now: number): PointerVisibilityDecision {
    if (isTouchInput(event)) return this.touched(now);
    if (event.pointerType === "mouse" && now < this.suppressMouseUntil)
      return "hide";
    if (
      event.pointerType !== "mouse" ||
      (event.movementX === 0 && event.movementY === 0)
    )
      return "unchanged";
    if ((event.buttons ?? 0) !== 0) {
      const decision = this.mouseConfirmed ? "show" : "hide";
      if (!this.mouseConfirmed) this.reset();
      return decision;
    }
    if (now - this.lastMouseMoveAt > MOUSE_CONFIRMATION_MILLISECONDS)
      this.reset();
    this.lastMouseMoveAt = now;
    this.mouseMoveSamples += 1;
    this.mouseMoveDistance += Math.hypot(event.movementX, event.movementY);
    if (
      this.mouseMoveSamples >= MOUSE_CONFIRMATION_SAMPLES &&
      this.mouseMoveDistance >= MOUSE_CONFIRMATION_DISTANCE
    )
      this.mouseConfirmed = true;
    return this.mouseConfirmed ? "show" : "unchanged";
  }

  pressed(event: PointerInput, now: number): PointerVisibilityDecision {
    if (isTouchInput(event)) return this.touched(now);
    if (event.pointerType === "mouse" && now < this.suppressMouseUntil)
      return "hide";
    if (event.pointerType === "mouse" && this.mouseConfirmed) return "show";
    this.reset();
    return "hide";
  }

  touched(now: number): PointerVisibilityDecision {
    this.reset();
    this.suppressMouseUntil =
      now + TOUCH_COMPATIBILITY_SUPPRESSION_MILLISECONDS;
    return "hide";
  }

  reset(): void {
    this.lastMouseMoveAt = Number.NEGATIVE_INFINITY;
    this.mouseMoveSamples = 0;
    this.mouseMoveDistance = 0;
    this.mouseConfirmed = false;
  }
}

export interface PointerVisibilityController {
  destroy(): void;
}

export function createPointerVisibilityController(
  root: HTMLElement,
  hidePointerWhenInactive: boolean,
): PointerVisibilityController {
  const tracker = new PointerModalityTracker();
  let pointerTimer = 0;

  const hide = (): void => {
    window.clearTimeout(pointerTimer);
    pointerTimer = 0;
    tracker.reset();
    if (hidePointerWhenInactive) root.classList.add("app-root--pointer-hidden");
  };
  const show = (): void => {
    if (!hidePointerWhenInactive) return;
    root.classList.remove("app-root--pointer-hidden");
    window.clearTimeout(pointerTimer);
    pointerTimer = window.setTimeout(hide, POINTER_HIDE_MILLISECONDS);
  };
  const apply = (decision: PointerVisibilityDecision): void => {
    if (decision === "show") show();
    else if (decision === "hide") hide();
  };
  const onPointerMove = (event: PointerEvent): void => {
    apply(tracker.moved(event, performance.now()));
  };
  const onPointerDown = (event: PointerEvent): void => {
    apply(tracker.pressed(event, performance.now()));
  };
  const onTouchStart = (): void => {
    apply(tracker.touched(performance.now()));
  };
  const suppressContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    apply(tracker.touched(performance.now()));
  };

  if (hidePointerWhenInactive) {
    root.addEventListener("contextmenu", suppressContextMenu);
    root.classList.add("app-root--pointer-hidden");
    document.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("pointerdown", onPointerDown, { passive: true });
    document.addEventListener("touchstart", onTouchStart, { passive: true });
  }

  return {
    destroy() {
      window.clearTimeout(pointerTimer);
      if (hidePointerWhenInactive) {
        root.removeEventListener("contextmenu", suppressContextMenu);
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerdown", onPointerDown);
        document.removeEventListener("touchstart", onTouchStart);
        root.classList.remove("app-root--pointer-hidden");
      }
    },
  };
}
