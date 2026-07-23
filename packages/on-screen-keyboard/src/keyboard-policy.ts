import type {
  KeyboardAutomaticMode,
  KeyboardInput,
  KeyboardProfileName,
} from "./keyboard-types";

export function isEligibleKeyboardInput(
  input: KeyboardInput,
  profile?: KeyboardProfileName,
): boolean {
  if (input.disabled || input.readOnly || input.type === "hidden") return false;
  return input.type !== "password" || profile === "password";
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
