export interface CanvasSize {
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
}

export function prepareCanvas(canvas: HTMLCanvasElement): CanvasSize | null {
  const bounds = canvas.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return null;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.round(bounds.width);
  const height = Math.round(bounds.height);
  const backingWidth = Math.round(width * pixelRatio);
  const backingHeight = Math.round(height * pixelRatio);
  // Setting either canvas dimension reallocates its backing store. Timeline
  // progress calls this function several times per second, so unconditional
  // assignments steadily retained large software-rendered surfaces in
  // WebKitGTK on Raspberry Pi. Resize only when the effective dimensions
  // actually change.
  if (canvas.width !== backingWidth) canvas.width = backingWidth;
  if (canvas.height !== backingHeight) canvas.height = backingHeight;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);
  return { width, height, pixelRatio };
}
