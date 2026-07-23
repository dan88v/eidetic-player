import type { WifiSecurity } from "../../../../packages/shared/src/network.js";
import type { AdapterNetworkState, NetworkAdapter } from "./network-adapter.js";

export class FixtureNetworkAdapter implements NetworkAdapter {
  constructor(private state: AdapterNetworkState) {}

  readState(): Promise<AdapterNetworkState> {
    return Promise.resolve(this.state);
  }
  scan(adapterId: string): Promise<void> {
    void adapterId;
    return Promise.resolve();
  }
  setRadio(_adapterId: string, enabled: boolean): Promise<void> {
    this.state = {
      ...this.state,
      softwareRadio: enabled ? "on" : "off",
      scanState: enabled ? "idle" : "wifi-off",
    };
    return Promise.resolve();
  }
  connect(
    adapterId: string,
    networkId: string,
    password: string | undefined,
  ): Promise<void> {
    void adapterId;
    void networkId;
    void password;
    return Promise.resolve();
  }
  connectHidden(
    adapterId: string,
    ssid: string,
    security: Exclude<WifiSecurity, "unsupported">,
    password: string | undefined,
  ): Promise<void> {
    void adapterId;
    void ssid;
    void security;
    void password;
    return Promise.resolve();
  }
  disconnect(adapterId: string): Promise<void> {
    void adapterId;
    return Promise.resolve();
  }
  forgetManagedProfile(adapterId: string): Promise<void> {
    void adapterId;
    return Promise.resolve();
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}
