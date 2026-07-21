export interface CassetteReelGeometry {
  readonly sourceRadius: number;
  readonly destinationRadius: number;
}

export interface CassetteAngularVelocity {
  readonly source: number;
  readonly destination: number;
}

export const CASSETTE_CORE_RADIUS = 28;
export const CASSETTE_FULL_RADIUS = 72;
export const CASSETTE_MAX_ANGULAR_SPEED = 5.5;

const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

export function deriveReelGeometry(progress: number): CassetteReelGeometry {
  const boundedProgress = clamp01(progress);
  const tapeArea = CASSETTE_FULL_RADIUS ** 2 - CASSETTE_CORE_RADIUS ** 2;
  return {
    sourceRadius: Math.sqrt(
      CASSETTE_CORE_RADIUS ** 2 + (1 - boundedProgress) * tapeArea,
    ),
    destinationRadius: Math.sqrt(
      CASSETTE_CORE_RADIUS ** 2 + boundedProgress * tapeArea,
    ),
  };
}

export function deriveAngularVelocity(
  tapeLinearSpeed: number,
  geometry: CassetteReelGeometry,
): CassetteAngularVelocity {
  const speed = Math.max(
    0,
    Number.isFinite(tapeLinearSpeed) ? tapeLinearSpeed : 0,
  );
  return {
    source: Math.min(CASSETTE_MAX_ANGULAR_SPEED, speed / geometry.sourceRadius),
    destination: Math.min(
      CASSETTE_MAX_ANGULAR_SPEED,
      speed / geometry.destinationRadius,
    ),
  };
}

export function integrateAngle(
  angle: number,
  speed: number,
  deltaSeconds: number,
): number {
  const boundedDelta = Math.max(0, Math.min(0.1, deltaSeconds));
  const turn = Math.PI * 2;
  return (((angle + speed * boundedDelta) % turn) + turn) % turn;
}
