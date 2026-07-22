import {
  createOnScreenKeyboard,
  type KeyboardInput,
  type KeyboardProfile,
  type KeyboardAutomaticMode,
  type OnScreenKeyboard,
} from "../../../../packages/on-screen-keyboard/src/on-screen-keyboard";
import { t } from "../i18n";

export interface EideticKeyboardAdapter {
  readonly keyboard: OnScreenKeyboard;
  hide(): void;
  setMode(mode: KeyboardAutomaticMode): void;
  setAnimationsEnabled(enabled: boolean): void;
  destroy(): void;
}

function keyboardInput(target: EventTarget | null): KeyboardInput | null {
  if (!(
    target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
  ))
    return null;
  return target.matches("[data-onscreen-keyboard]") ? target : null;
}

function profileFor(input: KeyboardInput): KeyboardProfile | null {
  const name = input.dataset.onscreenKeyboard;
  if (name !== "text" && name !== "numeric" && name !== "ipv4") return null;
  const enterAction =
    input.dataset.onscreenKeyboardEnter === "search" ? "search" : "done";
  return { name, enterAction };
}

export function createEideticKeyboardAdapter(
  mount: HTMLElement,
  options: {
    readonly mode: KeyboardAutomaticMode;
    readonly animationsEnabled: boolean;
  },
): EideticKeyboardAdapter {
  let mode = options.mode;
  const keyboard = createOnScreenKeyboard({
    mount,
    automaticMode: options.mode,
    animationsEnabled: options.animationsEnabled,
    preferNativeKeyboard: false,
    labels: {
      keyboard: t("keyboard.label"),
      shift: t("keyboard.shift"),
      capsLock: t("keyboard.capsLock"),
      backspace: t("keyboard.backspace"),
      clear: t("keyboard.clear"),
      space: t("keyboard.space"),
      search: t("keyboard.search"),
      done: t("keyboard.done"),
      hide: t("keyboard.hide"),
      symbols: t("keyboard.symbols"),
      letters: t("keyboard.letters"),
    },
    onVisibilityChange(visible) {
      mount.dataset.keyboardOpen = String(visible);
    },
  });
  keyboard.element.style.setProperty(
    "--osk-background",
    "var(--color-bg-elevated)",
  );
  keyboard.element.style.setProperty(
    "--osk-key-background",
    "var(--color-surface-raised)",
  );
  keyboard.element.style.setProperty(
    "--osk-key-active",
    "var(--color-surface-pressed)",
  );
  keyboard.element.style.setProperty("--osk-text", "var(--color-text)");
  keyboard.element.style.setProperty(
    "--osk-text-secondary",
    "var(--color-text-secondary)",
  );
  keyboard.element.style.setProperty("--osk-accent", "var(--color-accent)");
  keyboard.element.style.setProperty(
    "--osk-border",
    "var(--color-border-strong)",
  );
  keyboard.element.style.setProperty("--osk-radius", "var(--radius-sm)");
  keyboard.element.style.setProperty("--osk-z-index", "var(--z-keyboard)");
  keyboard.element.style.setProperty(
    "--osk-font-family",
    '"Open Sans Bundled", ui-sans-serif, system-ui, sans-serif',
  );

  const register = (event: Event): void => {
    const input = keyboardInput(event.target);
    if (!input) return;
    const profile = profileFor(input);
    if (!profile) return;
    keyboard.attach(input, profile);
    if (
      mode === "always" ||
      (mode === "auto" &&
        event instanceof PointerEvent &&
        (event.pointerType === "touch" || event.pointerType === "pen"))
    )
      keyboard.showFor(input);
  };
  document.addEventListener("pointerdown", register, true);
  document.addEventListener("focusin", register, true);

  return {
    keyboard,
    hide: () => {
      keyboard.hide();
    },
    setMode(nextMode) {
      mode = nextMode;
      keyboard.setAutomaticMode(nextMode);
    },
    setAnimationsEnabled: (enabled) => {
      keyboard.setAnimationsEnabled(enabled);
    },
    destroy() {
      document.removeEventListener("pointerdown", register, true);
      document.removeEventListener("focusin", register, true);
      keyboard.destroy();
      delete mount.dataset.keyboardOpen;
    },
  };
}
