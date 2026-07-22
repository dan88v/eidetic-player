import type { KeyboardInput } from "./keyboard-types";

function selection(input: KeyboardInput): readonly [number, number] {
  const end = input.value.length;
  return [input.selectionStart ?? end, input.selectionEnd ?? end];
}

function emitInput(
  input: KeyboardInput,
  inputType: string,
  data: string | null,
): void {
  const event =
    typeof InputEvent === "function"
      ? new InputEvent("input", { bubbles: true, inputType, data })
      : new Event("input", { bubbles: true });
  input.dispatchEvent(event);
}

export function replaceSelection(input: KeyboardInput, text: string): boolean {
  const [start, end] = selection(input);
  const selectedLength = end - start;
  const maxlength = input.maxLength;
  const available =
    maxlength < 0
      ? text.length
      : Math.max(0, maxlength - (input.value.length - selectedLength));
  const insertion = Array.from(text).slice(0, available).join("");
  if (insertion === "" && text !== "") return false;
  input.setRangeText(insertion, start, end, "end");
  emitInput(input, "insertText", insertion);
  return true;
}

export function backspace(input: KeyboardInput): boolean {
  const [selectionStart, end] = selection(input);
  let start = selectionStart;
  if (start === end) {
    if (start === 0) return false;
    start -= 1;
  }
  input.setRangeText("", start, end, "end");
  emitInput(input, "deleteContentBackward", null);
  return true;
}

export function clearInput(input: KeyboardInput): boolean {
  if (input.value === "") return false;
  input.setRangeText("", 0, input.value.length, "end");
  emitInput(input, "deleteContent", null);
  return true;
}
