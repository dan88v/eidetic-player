export const RELIABLE_TOUCH_SCROLL_DRAG_THRESHOLD = 16;
const MAX_VELOCITY = 2.5;
const STOP_VELOCITY = 0.02;
const CLICK_SUPPRESSION_MS = 100;
const IGNORE_SELECTOR = [
  "input",
  "textarea",
  "select",
  '[contenteditable="true"]',
  ".timeline__slider",
  ".mini-player__timeline",
  ".volume-slider",
  ".queue-item__handle",
  ".playlist-track__handle",
  ".parametric-eq-graph__canvas",
].join(",");

export interface ReliableTouchScroller {
  destroy(): void;
}

interface ActivePointer {
  readonly id: number;
  readonly startX: number;
  readonly startY: number;
  readonly startScrollTop: number;
  lastY: number;
  lastTime: number;
  velocity: number;
  dragging: boolean;
}

export function touchScrollTarget(
  startScrollTop: number,
  startPointerY: number,
  currentPointerY: number,
): number {
  return startScrollTop + startPointerY - currentPointerY;
}

export function touchScrollVelocity(
  previousPointerY: number,
  currentPointerY: number,
  elapsedMilliseconds: number,
): number {
  if (!Number.isFinite(elapsedMilliseconds) || elapsedMilliseconds <= 0)
    return 0;
  return (previousPointerY - currentPointerY) / elapsedMilliseconds;
}

export function touchScrollDragStarted(
  deltaX: number,
  deltaY: number,
): boolean {
  return Math.hypot(deltaX, deltaY) >= RELIABLE_TOUCH_SCROLL_DRAG_THRESHOLD;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function createReliableTouchScroller(
  element: HTMLElement,
  enabled = true,
): ReliableTouchScroller {
  if (!enabled) return { destroy: () => undefined };

  let active: ActivePointer | null = null;
  let animationFrame = 0;
  let lastAnimationTime = 0;
  let inertiaVelocity = 0;
  let suppressNextClick = false;
  let clickSuppressionTimer = 0;

  const maximumScrollTop = (): number =>
    Math.max(0, element.scrollHeight - element.clientHeight);

  const cancelInertia = (): void => {
    if (animationFrame) window.cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    lastAnimationTime = 0;
    inertiaVelocity = 0;
  };

  const animateInertia = (time: number): void => {
    if (!animationFrame) return;
    const elapsed = lastAnimationTime
      ? Math.min(32, Math.max(1, time - lastAnimationTime))
      : 16;
    lastAnimationTime = time;
    const before = element.scrollTop;
    element.scrollTop = clamp(
      before + inertiaVelocity * elapsed,
      0,
      maximumScrollTop(),
    );
    inertiaVelocity *= Math.pow(0.92, elapsed / 16);
    if (
      Math.abs(inertiaVelocity) < STOP_VELOCITY ||
      element.scrollTop === before
    ) {
      cancelInertia();
      return;
    }
    animationFrame = window.requestAnimationFrame(animateInertia);
  };

  const startInertia = (velocity: number): void => {
    cancelInertia();
    inertiaVelocity = clamp(velocity, -MAX_VELOCITY, MAX_VELOCITY);
    if (Math.abs(inertiaVelocity) < STOP_VELOCITY) return;
    animationFrame = window.requestAnimationFrame(animateInertia);
  };

  const begin = (event: PointerEvent): void => {
    if (
      active ||
      event.button !== 0 ||
      !event.isPrimary ||
      !(event.target instanceof Element) ||
      event.target.closest(IGNORE_SELECTOR)
    )
      return;
    const nestedOwner = event.target.closest(".touch-scroll-fallback");
    if (nestedOwner && nestedOwner !== element) return;
    cancelInertia();
    if (maximumScrollTop() <= 0) return;
    active = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScrollTop: element.scrollTop,
      lastY: event.clientY,
      lastTime: event.timeStamp,
      velocity: 0,
      dragging: false,
    };
  };

  const move = (event: PointerEvent): void => {
    if (event.pointerId !== active?.id) return;
    const pointer = active;
    const deltaX = event.clientX - pointer.startX;
    const deltaY = event.clientY - pointer.startY;
    if (!pointer.dragging) {
      if (!touchScrollDragStarted(deltaX, deltaY)) return;
      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        active = null;
        return;
      }
      pointer.dragging = true;
      if (!element.hasPointerCapture(pointer.id))
        element.setPointerCapture(pointer.id);
    }
    if (event.cancelable) event.preventDefault();
    const before = element.scrollTop;
    element.scrollTop = clamp(
      touchScrollTarget(pointer.startScrollTop, pointer.startY, event.clientY),
      0,
      maximumScrollTop(),
    );
    const elapsed = Math.max(1, event.timeStamp - pointer.lastTime);
    const instantaneous = touchScrollVelocity(
      pointer.lastY,
      event.clientY,
      elapsed,
    );
    pointer.velocity =
      clamp(pointer.velocity * 0.65 + instantaneous * 0.35, -2.5, 2.5) ||
      (element.scrollTop - before) / elapsed;
    pointer.lastY = event.clientY;
    pointer.lastTime = event.timeStamp;
  };

  const release = (event: PointerEvent, cancelled: boolean): void => {
    if (event.pointerId !== active?.id) return;
    const pointer = active;
    active = null;
    if (element.hasPointerCapture(pointer.id))
      element.releasePointerCapture(pointer.id);
    if (!pointer.dragging || cancelled) return;
    suppressNextClick = true;
    window.clearTimeout(clickSuppressionTimer);
    clickSuppressionTimer = window.setTimeout(() => {
      suppressNextClick = false;
    }, CLICK_SUPPRESSION_MS);
    startInertia(pointer.velocity);
  };

  const end = (event: PointerEvent): void => {
    release(event, false);
  };
  const cancel = (event: PointerEvent): void => {
    release(event, true);
  };
  const suppressClick = (event: MouseEvent): void => {
    if (!suppressNextClick || event.detail === 0) return;
    suppressNextClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  element.classList.add("touch-scroll-fallback");
  element.addEventListener("pointerdown", begin);
  element.addEventListener("pointermove", move, { passive: false });
  element.addEventListener("pointerup", end);
  element.addEventListener("pointercancel", cancel);
  element.addEventListener("click", suppressClick, true);

  return {
    destroy() {
      cancelInertia();
      window.clearTimeout(clickSuppressionTimer);
      if (active && element.hasPointerCapture(active.id))
        element.releasePointerCapture(active.id);
      active = null;
      element.classList.remove("touch-scroll-fallback");
      element.removeEventListener("pointerdown", begin);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", end);
      element.removeEventListener("pointercancel", cancel);
      element.removeEventListener("click", suppressClick, true);
    },
  };
}
