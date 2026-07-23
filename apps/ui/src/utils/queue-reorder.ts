const QUEUE_DRAG_THRESHOLD = 8;
const QUEUE_AUTOSCROLL_EDGE = 64;
const QUEUE_AUTOSCROLL_MAX_STEP = 18;

export function shouldStartQueueDrag(deltaX: number, deltaY: number): boolean {
  return Math.hypot(deltaX, deltaY) >= QUEUE_DRAG_THRESHOLD;
}

export function queueDropIndex(
  midpoints: readonly number[],
  pointerClientY: number,
): number {
  const index = midpoints.findIndex((midpoint) => pointerClientY < midpoint);
  return index < 0 ? midpoints.length : index;
}

export function queueAutoScrollStep(
  pointerClientY: number,
  top: number,
  bottom: number,
): number {
  if (pointerClientY < top + QUEUE_AUTOSCROLL_EDGE) {
    const ratio = Math.min(
      1,
      (top + QUEUE_AUTOSCROLL_EDGE - pointerClientY) / QUEUE_AUTOSCROLL_EDGE,
    );
    return -Math.max(1, Math.round(QUEUE_AUTOSCROLL_MAX_STEP * ratio));
  }
  if (pointerClientY > bottom - QUEUE_AUTOSCROLL_EDGE) {
    const ratio = Math.min(
      1,
      (pointerClientY - (bottom - QUEUE_AUTOSCROLL_EDGE)) /
        QUEUE_AUTOSCROLL_EDGE,
    );
    return Math.max(1, Math.round(QUEUE_AUTOSCROLL_MAX_STEP * ratio));
  }
  return 0;
}
