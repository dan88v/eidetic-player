export type KeyboardProfileName = "text" | "numeric" | "ipv4" | "password";
export type KeyboardEnterAction = "search" | "done";
export type KeyboardAutomaticMode = "auto" | "always" | "off";
export type KeyboardInput = HTMLInputElement | HTMLTextAreaElement;

export interface KeyboardProfile {
  readonly name: KeyboardProfileName;
  readonly enterAction?: KeyboardEnterAction;
  readonly onEnter?: (input: KeyboardInput) => void;
}

export interface KeyboardLabels {
  readonly keyboard: string;
  readonly shift: string;
  readonly capsLock: string;
  readonly backspace: string;
  readonly clear: string;
  readonly space: string;
  readonly search: string;
  readonly done: string;
  readonly hide: string;
  readonly symbols: string;
  readonly letters: string;
}

export interface OnScreenKeyboardOptions {
  readonly document?: Document;
  readonly mount?: HTMLElement;
  readonly labels: KeyboardLabels;
  readonly automaticMode?: KeyboardAutomaticMode;
  readonly preferNativeKeyboard?: boolean;
  readonly animationsEnabled?: boolean;
  readonly onVisibilityChange?: (visible: boolean) => void;
}

export interface OnScreenKeyboard {
  readonly element: HTMLElement;
  destroy(): void;
  attach(input: KeyboardInput, profile: KeyboardProfile): void;
  detach(input: KeyboardInput): void;
  showFor(input: KeyboardInput): void;
  hide(): void;
  setAutomaticMode(mode: KeyboardAutomaticMode): void;
  setAnimationsEnabled(enabled: boolean): void;
}
