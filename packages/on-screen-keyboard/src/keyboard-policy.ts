import type { KeyboardInput } from "./keyboard-types";

export function isEligibleKeyboardInput(input: KeyboardInput): boolean {
  if (input.disabled || input.readOnly || input.type === "hidden") return false;
  return input.type !== "password";
}

export function shouldOpenAutomatically(
  pointerType: string,
  enabled: boolean,
  preferNativeKeyboard: boolean,
): boolean {
  return (
    enabled &&
    !preferNativeKeyboard &&
    (pointerType === "touch" || pointerType === "pen")
  );
}
