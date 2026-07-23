import { backspace, clearInput, replaceSelection } from "./keyboard-editing";
import {
  ipv4Rows,
  numericRows,
  symbolRows,
  textRows,
  type KeyboardKey,
  type KeyboardRows,
} from "./keyboard-layouts";
import {
  isEligibleKeyboardInput,
  shouldOpenAutomatically,
} from "./keyboard-policy";
import type {
  KeyboardInput,
  KeyboardAutomaticMode,
  KeyboardProfile,
  OnScreenKeyboard,
  OnScreenKeyboardOptions,
} from "./keyboard-types";

const instances = new WeakMap<Document, OnScreenKeyboard>();

export function createOnScreenKeyboard(
  options: OnScreenKeyboardOptions,
): OnScreenKeyboard {
  const document = options.document ?? globalThis.document;
  if (instances.has(document))
    throw new Error("An on-screen keyboard is already mounted");
  const profiles = new WeakMap<KeyboardInput, KeyboardProfile>();
  const root = document.createElement("section");
  root.className = "on-screen-keyboard";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", options.labels.keyboard);
  root.setAttribute("aria-hidden", "true");
  root.dataset.open = "false";
  root.dataset.animations = String(options.animationsEnabled ?? true);
  root.innerHTML = `<div class="on-screen-keyboard__keys"></div>`;
  const keys = root.querySelector<HTMLElement>(".on-screen-keyboard__keys");
  if (!keys) throw new Error("The on-screen keyboard could not be created");

  let automaticMode: KeyboardAutomaticMode = options.automaticMode ?? "auto";
  const preferNativeKeyboard = options.preferNativeKeyboard ?? false;
  let activeInput: KeyboardInput | null = null;
  let pointerType = "";
  let symbols = false;
  let shift = false;
  let capsLock = false;
  let lastShiftTap = 0;
  let destroyed = false;

  const activeProfile = (): KeyboardProfile | null =>
    activeInput ? (profiles.get(activeInput) ?? null) : null;

  const keyLabel = (key: KeyboardKey): string => {
    switch (key.action) {
      case "shift":
        return capsLock ? options.labels.capsLock : options.labels.shift;
      case "backspace":
        return options.labels.backspace;
      case "clear":
        return options.labels.clear;
      case "space":
        return options.labels.space;
      case "enter":
        return activeProfile()?.enterAction === "search"
          ? options.labels.search
          : options.labels.done;
      case "hide":
        return options.labels.hide;
      case "symbols":
        return options.labels.symbols;
      case "letters":
        return options.labels.letters;
      default:
        return key.label;
    }
  };

  const rowsForProfile = (): KeyboardRows => {
    const profile = activeProfile()?.name;
    if (profile === "numeric") return numericRows;
    if (profile === "ipv4") return ipv4Rows;
    return symbols ? symbolRows : textRows;
  };

  const renderKeys = (): void => {
    const profile = activeProfile();
    keys.replaceChildren();
    keys.dataset.profile = profile?.name ?? "text";
    keys.dataset.layer =
      profile?.name === "text" || profile?.name === "password"
        ? symbols
          ? "symbols"
          : "letters"
        : (profile?.name ?? "text");
    for (const rowKeys of rowsForProfile()) {
      const row = document.createElement("div");
      row.className = "on-screen-keyboard__row";
      for (const key of rowKeys) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "on-screen-keyboard__key";
        button.dataset.action = key.action ?? "insert";
        if (key.value !== undefined) button.dataset.value = key.value;
        if (key.grow)
          button.style.setProperty("--osk-key-grow", String(key.grow));
        button.style.setProperty(
          "--osk-key-span",
          String(Math.round((key.grow ?? 1) * 2)),
        );
        const label = keyLabel(key);
        button.textContent =
          key.action === "enter"
            ? label
            : key.value &&
                (profile?.name === "text" || profile?.name === "password") &&
                !symbols
              ? capsLock !== shift
                ? key.value.toUpperCase()
                : key.value
              : key.label;
        if (key.action === "hide") {
          const svg = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "svg",
          );
          svg.classList.add("on-screen-keyboard__hide-icon");
          svg.setAttribute("viewBox", "0 0 24 24");
          svg.setAttribute("aria-hidden", "true");
          svg.innerHTML =
            '<rect x="3" y="3" width="18" height="12" rx="2"/><path d="M7 7h.01M10 7h.01M13 7h.01M16 7h.01M7 11h10M8 19l4 3 4-3"/>';
          button.replaceChildren(svg);
        }
        button.setAttribute("aria-label", label);
        if (key.action === "shift") {
          button.setAttribute("aria-pressed", String(shift || capsLock));
          button.dataset.active = String(shift || capsLock);
        }
        if (key.action === "enter") button.dataset.primary = "true";
        row.append(button);
      }
      keys.append(row);
    }
  };

  const focusInput = (): void => {
    if (!activeInput?.isConnected) {
      api.hide();
      return;
    }
    activeInput.focus({ preventScroll: true });
  };

  const runEnter = (): void => {
    const input = activeInput;
    const profile = activeProfile();
    if (!input || !profile) return;
    if (profile.onEnter) profile.onEnter(input);
    else
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    if (profile.enterAction !== "search") api.hide();
    else focusInput();
  };

  const handleKey = (button: HTMLButtonElement): void => {
    const input = activeInput;
    if (
      !input ||
      !isEligibleKeyboardInput(input, activeProfile()?.name) ||
      !input.isConnected
    ) {
      api.hide();
      return;
    }
    const action = button.dataset.action;
    if (action === "hide") {
      api.hide();
      return;
    }
    if (action === "enter") {
      runEnter();
      return;
    }
    if (action === "shift") {
      const now = Date.now();
      if (lastShiftTap > 0 && now - lastShiftTap <= 400) {
        capsLock = true;
        shift = false;
        lastShiftTap = 0;
      } else {
        shift = !shift;
        capsLock = false;
        lastShiftTap = now;
      }
      renderKeys();
      focusInput();
      return;
    }
    if (action === "symbols" || action === "letters") {
      symbols = action === "symbols";
      shift = false;
      renderKeys();
      focusInput();
      return;
    }
    if (action === "backspace") backspace(input);
    else if (action === "clear") clearInput(input);
    else if (action === "space") replaceSelection(input, " ");
    else {
      const raw = button.dataset.value ?? "";
      const value =
        (activeProfile()?.name === "text" ||
          activeProfile()?.name === "password") &&
        !symbols &&
        capsLock !== shift
          ? raw.toUpperCase()
          : raw;
      replaceSelection(input, value);
      if (shift && !capsLock) {
        shift = false;
        lastShiftTap = 0;
        renderKeys();
      }
    }
    focusInput();
  };

  const handleRootPointerDown = (event: PointerEvent): void => {
    if ((event.target as Element | null)?.closest("button"))
      event.preventDefault();
  };
  const handleRootClick = (event: MouseEvent): void => {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>(
      ".on-screen-keyboard__key",
    );
    if (button) handleKey(button);
  };
  const handleDocumentPointerDown = (event: PointerEvent): void => {
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement
    )
      pointerType = event.pointerType;
    else if (!root.contains(target as Node)) pointerType = "";
  };
  const handleFocusIn = (event: FocusEvent): void => {
    const target = event.target;
    if (
      root.dataset.open === "true" &&
      target !== activeInput &&
      target instanceof Node &&
      !root.contains(target)
    )
      api.hide();
    if (
      !(
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement
      ) ||
      !profiles.has(target) ||
      !isEligibleKeyboardInput(target, profiles.get(target)?.name)
    )
      return;
    activeInput = target;
    const openAutomatically = shouldOpenAutomatically(
      pointerType,
      automaticMode,
      preferNativeKeyboard,
    );
    pointerType = "";
    if (openAutomatically) api.showFor(target);
  };
  const handleSelectionChange = (): void => {
    if (activeInput && !activeInput.isConnected) api.hide();
  };
  const handleEscape = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || root.dataset.open !== "true") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    api.hide();
  };

  root.addEventListener("pointerdown", handleRootPointerDown);
  root.addEventListener("click", handleRootClick);
  document.addEventListener("pointerdown", handleDocumentPointerDown, true);
  document.addEventListener("focusin", handleFocusIn);
  document.addEventListener("selectionchange", handleSelectionChange);
  document.addEventListener("keydown", handleEscape, true);
  (options.mount ?? document.body).append(root);

  const api: OnScreenKeyboard = {
    element: root,
    attach(input, profile) {
      if (destroyed) return;
      profiles.set(input, profile);
    },
    detach(input) {
      profiles.delete(input);
      if (activeInput === input) api.hide();
    },
    showFor(input) {
      if (
        destroyed ||
        automaticMode === "off" ||
        preferNativeKeyboard ||
        !profiles.has(input) ||
        !isEligibleKeyboardInput(input, profiles.get(input)?.name)
      )
        return;
      activeInput = input;
      pointerType = "";
      symbols = false;
      shift = false;
      capsLock = false;
      lastShiftTap = 0;
      renderKeys();
      root.dataset.open = "true";
      root.setAttribute("aria-hidden", "false");
      options.onVisibilityChange?.(true);
      focusInput();
    },
    hide() {
      if (root.dataset.open === "false") return;
      root.dataset.open = "false";
      root.setAttribute("aria-hidden", "true");
      activeInput = null;
      pointerType = "";
      options.onVisibilityChange?.(false);
    },
    setAutomaticMode(nextMode) {
      automaticMode = nextMode;
      if (automaticMode === "off" || preferNativeKeyboard) api.hide();
    },
    setAnimationsEnabled(nextEnabled) {
      root.dataset.animations = String(nextEnabled);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      api.hide();
      root.removeEventListener("pointerdown", handleRootPointerDown);
      root.removeEventListener("click", handleRootClick);
      document.removeEventListener(
        "pointerdown",
        handleDocumentPointerDown,
        true,
      );
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("selectionchange", handleSelectionChange);
      document.removeEventListener("keydown", handleEscape, true);
      root.remove();
      instances.delete(document);
    },
  };
  instances.set(document, api);
  return api;
}
