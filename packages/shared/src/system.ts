export const systemPowerActions = [
  "quit",
  "restart-app",
  "maintenance",
  "reboot",
  "shutdown",
] as const;

export type SystemPowerAction = (typeof systemPowerActions)[number];

export const finalPowerActionFixtures = {
  development: ["quit"],
  standard: ["quit", "reboot", "shutdown"],
  appliance: ["restart-app", "maintenance", "reboot", "shutdown"],
} as const satisfies Record<
  "development" | "standard" | "appliance",
  readonly SystemPowerAction[]
>;

export function isSystemPowerAction(
  value: unknown,
): value is SystemPowerAction {
  return (
    typeof value === "string" &&
    systemPowerActions.includes(value as SystemPowerAction)
  );
}

export interface SystemCapabilities {
  readonly installationMode: "standard" | "appliance" | "development";
  readonly maintenanceMode: boolean;
  readonly availablePowerActions: readonly SystemPowerAction[];
  readonly fullscreen: boolean;
  readonly hidePointerWhenInactive: boolean;
}

export const buildInfoSources = [
  "ci",
  "git",
  "explicit",
  "development",
  "unknown",
] as const;

export type BuildInfoSource = (typeof buildInfoSources)[number];

export interface BuildInfo {
  readonly schemaVersion: 1;
  readonly commitSha: string | null;
  readonly shortCommitSha: string;
  readonly ref: string;
  readonly packageVersion: string;
  readonly builtAt: string | null;
  readonly source: BuildInfoSource;
  readonly dirty?: boolean;
}

export const developmentBuildInfo: BuildInfo = {
  schemaVersion: 1,
  commitSha: null,
  shortCommitSha: "dev",
  ref: "development",
  packageVersion: "0.1.0",
  builtAt: null,
  source: "development",
};

export const unknownBuildInfo: BuildInfo = {
  schemaVersion: 1,
  commitSha: null,
  shortCommitSha: "unknown",
  ref: "unknown",
  packageVersion: "unknown",
  builtAt: null,
  source: "unknown",
};

export const defaultSystemCapabilities: SystemCapabilities = {
  installationMode: "development",
  maintenanceMode: false,
  availablePowerActions: ["quit"],
  fullscreen: false,
  hidePointerWhenInactive: false,
};
