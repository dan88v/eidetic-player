export { createOnScreenKeyboard } from "./keyboard-controller";
export { backspace, clearInput, replaceSelection } from "./keyboard-editing";
export {
  isEligibleKeyboardInput,
  shouldOpenAutomatically,
} from "./keyboard-policy";
export type {
  KeyboardEnterAction,
  KeyboardInput,
  KeyboardLabels,
  KeyboardProfile,
  KeyboardProfileName,
  OnScreenKeyboard,
  OnScreenKeyboardOptions,
} from "./keyboard-types";
