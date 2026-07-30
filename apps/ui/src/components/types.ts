import type { PlayerState } from "../../../../packages/shared/src/player";
import type { IndexedLibrarySnapshot } from "../../../../packages/shared/src/library";
import type { RemovableDeviceListResponse } from "../../../../packages/shared/src/library";
import type { NetworkSnapshot } from "../../../../packages/shared/src/network";
import type { SmbSnapshot } from "../../../../packages/shared/src/smb";
import type { AudioOutputState } from "../../../../packages/shared/src/audio-output";
import type { SoftwareUpdateSnapshot } from "../../../../packages/shared/src/update";
import type { DisplaySnapshot } from "../../../../packages/shared/src/display";

export interface ComponentView<T extends HTMLElement = HTMLElement> {
  readonly element: T;
  updatePlayerState?(state: PlayerState): void;
  updateSeekPreview?(positionSeconds: number | null): void;
  updateLibrarySnapshot?(snapshot: IndexedLibrarySnapshot): void;
  updateRemovableDevices?(snapshot: RemovableDeviceListResponse): void;
  updateNetworkSnapshot?(snapshot: NetworkSnapshot): void;
  updateSmbSnapshot?(snapshot: SmbSnapshot): void;
  updateAudioOutputState?(snapshot: AudioOutputState): void;
  updateSoftwareUpdateState?(snapshot: SoftwareUpdateSnapshot): void;
  updateDisplayState?(snapshot: DisplaySnapshot): void;
  requestLeave?(leave: () => void): boolean;
  destroy(): void;
}
