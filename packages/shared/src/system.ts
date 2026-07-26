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

export const defaultSystemCapabilities: SystemCapabilities = {
  installationMode: "development",
  maintenanceMode: false,
  availablePowerActions: ["quit"],
  fullscreen: false,
  hidePointerWhenInactive: false,
};
