export const screenDimTimeoutChoices = [
  0, 60, 120, 300, 600, 900, 1800,
] as const;
export type ScreenDimTimeoutSeconds = (typeof screenDimTimeoutChoices)[number];

export const screenDimLevelChoices = [10, 20, 30, 40, 50] as const;
export type ScreenDimLevelPercent = (typeof screenDimLevelChoices)[number];

export const screenStandbyTimeoutChoices = [
  0, 300, 600, 900, 1800, 3600,
] as const;
export type ScreenStandbyTimeoutSeconds =
  (typeof screenStandbyTimeoutChoices)[number];

export const displayStates = [
  "active",
  "dimmed",
  "standby",
  "inhibited",
  "transitioning",
  "error",
  "unsupported",
] as const;
export type DisplayState = (typeof displayStates)[number];

export type DisplayDimMethod = "hardware-backlight" | "software";
export type DisplayStandbyMethod =
  "wayland-output" | "backlight-off" | "fixture" | "none";

export type DisplayStandbyInhibitedReason = "hdmi-audio-active" | null;
export type DisplayTestKind = "dim" | "standby" | null;
export type DisplayErrorCode =
  "capability-failed" | "dim-failed" | "standby-failed" | "wake-failed" | null;

export interface DisplaySnapshot {
  readonly state: DisplayState;
  readonly dimMethod: DisplayDimMethod;
  readonly standbyMethod: DisplayStandbyMethod;
  readonly standbyAvailable: boolean;
  readonly standbyInhibitedReason: DisplayStandbyInhibitedReason;
  readonly dimLevelPercent: ScreenDimLevelPercent;
  readonly nextTransitionAt: string | null;
  readonly testActive: DisplayTestKind;
  readonly lastErrorCode: DisplayErrorCode;
  readonly revision: number;
}

export const defaultDisplaySnapshot: DisplaySnapshot = {
  state: "active",
  dimMethod: "software",
  standbyMethod: "none",
  standbyAvailable: false,
  standbyInhibitedReason: null,
  dimLevelPercent: 20,
  nextTransitionAt: null,
  testActive: null,
  lastErrorCode: null,
  revision: 0,
};

export function isScreenDimTimeoutSeconds(
  value: unknown,
): value is ScreenDimTimeoutSeconds {
  return screenDimTimeoutChoices.includes(value as ScreenDimTimeoutSeconds);
}

export function isScreenDimLevelPercent(
  value: unknown,
): value is ScreenDimLevelPercent {
  return screenDimLevelChoices.includes(value as ScreenDimLevelPercent);
}

export function isScreenStandbyTimeoutSeconds(
  value: unknown,
): value is ScreenStandbyTimeoutSeconds {
  return screenStandbyTimeoutChoices.includes(
    value as ScreenStandbyTimeoutSeconds,
  );
}

export function displayTimeoutsAreCompatible(
  dimTimeoutSeconds: ScreenDimTimeoutSeconds,
  standbyTimeoutSeconds: ScreenStandbyTimeoutSeconds,
): boolean {
  return (
    dimTimeoutSeconds === 0 ||
    standbyTimeoutSeconds === 0 ||
    standbyTimeoutSeconds > dimTimeoutSeconds
  );
}
