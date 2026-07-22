import type { KeyboardAutomaticMode, KeyboardInput } from "./keyboard-types";

export function isEligibleKeyboardInput(input: KeyboardInput): boolean {
  if (input.disabled || input.readOnly || input.type === "hidden") return false;
  return input.type !== "password";
}

export function shouldOpenAutomatically(
  pointerType: string,
  mode: KeyboardAutomaticMode,
  preferNativeKeyboard: boolean,
): boolean {
  return (
    !preferNativeKeyboard &&
    (mode === "always" ||
      (mode === "auto" && (pointerType === "touch" || pointerType === "pen")))
  );
}
