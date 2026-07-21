export const CASSETTE_VIEWBOX_WIDTH = 1_070;
export const CASSETTE_VIEWBOX_HEIGHT = 710;

// The tape packs share the lateral reel axes, but are revealed only by the
// central window. The empty pack just enters the window, while the full pack
// remains inside the cassette's lateral bounds.
export const CASSETTE_CORE_RADIUS = 112;
export const CASSETTE_FULL_RADIUS = 270;

// Lower ivory writing panel. The inset keeps handwriting clear of the label's
// sloped outer edges and bottom shell border while using both ruled rows.
export const CASSETTE_METADATA_LABEL_AREA = Object.freeze({
  x: 150,
  y: 567,
  width: 770,
  height: 82,
  padding: 8,
});

export const CASSETTE_LEFT_REEL = Object.freeze({
  centerX: 290,
  centerY: 388,
  role: "destination" as const,
});

export const CASSETTE_RIGHT_REEL = Object.freeze({
  centerX: 776,
  centerY: 388,
  role: "source" as const,
});

export const CASSETTE_CENTER_WINDOW_POINTS = Object.freeze([
  [397, 318],
  [408, 319],
  [668, 319],
  [679, 318],
  [675, 331],
  [670, 349],
  [666, 369],
  [664, 389],
  [666, 409],
  [670, 431],
  [675, 450],
  [679, 463],
  [397, 463],
  [401, 451],
  [406, 432],
  [409, 410],
  [411, 389],
  [409, 367],
  [406, 347],
  [401, 330],
] as const);

export const CASSETTE_CENTER_WINDOW_POINT_LIST =
  CASSETTE_CENTER_WINDOW_POINTS.map(
    ([x, y]) => `${String(x)},${String(y)}`,
  ).join(" ");
