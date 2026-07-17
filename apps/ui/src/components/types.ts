import type { PlayerState } from "../../../../packages/shared/src/player";

export interface ComponentView<T extends HTMLElement = HTMLElement> {
  readonly element: T;
  updatePlayerState?(state: PlayerState): void;
  destroy(): void;
}
