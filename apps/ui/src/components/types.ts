import type { PlayerState } from "../../../../packages/shared/src/player";
import type { IndexedLibrarySnapshot } from "../../../../packages/shared/src/library";
import type { RemovableDeviceListResponse } from "../../../../packages/shared/src/library";

export interface ComponentView<T extends HTMLElement = HTMLElement> {
  readonly element: T;
  updatePlayerState?(state: PlayerState): void;
  updateSeekPreview?(positionSeconds: number | null): void;
  updateLibrarySnapshot?(snapshot: IndexedLibrarySnapshot): void;
  updateRemovableDevices?(snapshot: RemovableDeviceListResponse): void;
  destroy(): void;
}
