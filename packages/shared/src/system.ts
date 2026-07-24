export interface SystemCapabilities {
  readonly installationMode: "standard" | "appliance" | "development";
  readonly maintenanceMode: boolean;
  readonly fullscreen: boolean;
  readonly hidePointerWhenInactive: boolean;
}

export const defaultSystemCapabilities: SystemCapabilities = {
  installationMode: "development",
  maintenanceMode: false,
  fullscreen: false,
  hidePointerWhenInactive: false,
};
