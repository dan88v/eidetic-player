import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  backspace,
  clearInput,
  replaceSelection,
} from "../src/keyboard-editing";
import {
  ipv4Rows,
  numericRows,
  symbolRows,
  textRows,
} from "../src/keyboard-layouts";
import {
  isEligibleKeyboardInput,
  shouldOpenAutomatically,
} from "../src/keyboard-policy";
import type { KeyboardInput } from "../src/keyboard-types";

class FakeInput extends EventTarget {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  maxLength: number;

  constructor(
    value: string,
    start = value.length,
    end = start,
    maxLength = -1,
  ) {
    super();
    this.value = value;
    this.selectionStart = start;
    this.selectionEnd = end;
    this.maxLength = maxLength;
  }

  setRangeText(text: string, start: number, end: number): void {
    this.value = `${this.value.slice(0, start)}${text}${this.value.slice(end)}`;
    this.selectionStart = start + text.length;
    this.selectionEnd = this.selectionStart;
  }
}

const input = (
  value: string,
  start?: number,
  end?: number,
  maxlength?: number,
) => new FakeInput(value, start, end, maxlength) as unknown as KeyboardInput;

const labels = (rows: typeof textRows): string[] =>
  rows.flatMap((row) => row.map((key) => key.value ?? key.label));

void test("editing inserts at the caret, replaces selections and honors maxlength", () => {
  const middle = input("abcd", 2, 2);
  assert.equal(replaceSelection(middle, "X"), true);
  assert.equal(middle.value, "abXcd");
  assert.equal(middle.selectionStart, 3);

  const selected = input("abcd", 1, 3);
  replaceSelection(selected, "YZ");
  assert.equal(selected.value, "aYZd");

  const bounded = input("abcd", 2, 2, 5);
  replaceSelection(bounded, "XYZ");
  assert.equal(bounded.value, "abXcd");
  assert.equal(replaceSelection(bounded, "Q"), false);
});

void test("backspace and Clear edit the authoritative value and emit input", () => {
  const field = input("abcd", 2, 2);
  let events = 0;
  field.addEventListener("input", () => events++);
  assert.equal(backspace(field), true);
  assert.equal(field.value, "acd");
  field.selectionStart = 0;
  field.selectionEnd = 2;
  assert.equal(backspace(field), true);
  assert.equal(field.value, "d");
  assert.equal(clearInput(field), true);
  assert.equal(field.value, "");
  assert.equal(events, 3);
  assert.equal(backspace(field), false);
  assert.equal(clearInput(field), false);
});

void test("text, symbols, numeric and IPv4 layouts expose the complete keys", () => {
  assert.deepEqual(labels(textRows).slice(0, 10), [
    "q",
    "w",
    "e",
    "r",
    "t",
    "y",
    "u",
    "i",
    "o",
    "p",
  ]);
  assert.deepEqual(labels(textRows[3] ? [textRows[3]] : []), [
    "123",
    ",",
    "Space",
    ".",
    "Done",
    "Hide",
  ]);
  assert.equal(textRows[2]?.[0]?.grow, 1.5);
  assert.equal(textRows[2].at(-1)?.grow, 1.5);
  assert.equal(
    textRows[3]?.reduce((total, key) => total + (key.grow ?? 1), 0),
    10,
  );
  for (const character of [
    "-",
    "/",
    ":",
    ";",
    "(",
    ")",
    "\u20ac",
    "&",
    "@",
    '"',
    ".",
    ",",
    "?",
    "!",
    "'",
    "+",
  ])
    assert.ok(labels(symbolRows).includes(character));
  for (const row of symbolRows)
    assert.equal(
      row.reduce((total, key) => total + (key.grow ?? 1), 0),
      10,
    );
  assert.deepEqual(
    labels(numericRows)
      .filter((value) => /^\d$/u.test(value))
      .sort(),
    ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"],
  );
  assert.ok(labels(ipv4Rows).includes("."));
  assert.equal(labels(numericRows).includes("."), false);
});

void test("Auto and Always respect pointer and native keyboard policy", () => {
  assert.equal(shouldOpenAutomatically("touch", "auto", false), true);
  assert.equal(shouldOpenAutomatically("pen", "auto", false), true);
  assert.equal(shouldOpenAutomatically("mouse", "auto", false), false);
  assert.equal(shouldOpenAutomatically("", "auto", false), false);
  assert.equal(shouldOpenAutomatically("mouse", "always", false), true);
  assert.equal(shouldOpenAutomatically("", "always", false), true);
  assert.equal(shouldOpenAutomatically("touch", "off", false), false);
  assert.equal(shouldOpenAutomatically("touch", "always", true), false);
});

void test("only editable non-password fields are eligible", () => {
  const field = (overrides: Record<string, unknown> = {}): KeyboardInput =>
    ({
      disabled: false,
      readOnly: false,
      type: "text",
      ...overrides,
    }) as unknown as KeyboardInput;
  assert.equal(isEligibleKeyboardInput(field()), true);
  assert.equal(isEligibleKeyboardInput(field({ disabled: true })), false);
  assert.equal(isEligibleKeyboardInput(field({ readOnly: true })), false);
  assert.equal(isEligibleKeyboardInput(field({ type: "hidden" })), false);
  assert.equal(isEligibleKeyboardInput(field({ type: "password" })), false);
  assert.equal(
    isEligibleKeyboardInput(field({ type: "password" }), "password"),
    true,
  );
});

void test("controller owns one mount, centralized listeners and complete teardown", () => {
  const controller = readFileSync(
    new URL("../src/keyboard-controller.ts", import.meta.url),
    "utf8",
  );
  assert.match(controller, /const instances = new WeakMap<Document/);
  assert.match(controller, /already mounted/);
  assert.match(controller, /document\.addEventListener\("selectionchange"/);
  assert.match(controller, /document\.removeEventListener\("selectionchange"/);
  assert.match(controller, /instances\.delete\(document\)/);
  assert.match(controller, /lastShiftTap[\s\S]*<= 400/);
  assert.match(controller, /capsLock = true/);
  assert.match(controller, /on-screen-keyboard__hide-icon/);
  assert.match(controller, /--osk-key-span/);
  assert.match(controller, /event\.stopImmediatePropagation\(\)/);
  assert.doesNotMatch(
    controller,
    /setInterval|requestAnimationFrame|MutationObserver/,
  );
});

void test("package CSS is scoped, responsive and reduced-motion safe", () => {
  const css = readFileSync(
    new URL("../src/on-screen-keyboard.css", import.meta.url),
    "utf8",
  );
  assert.match(css, /\.on-screen-keyboard\s*\{/);
  assert.match(css, /env\(safe-area-inset-bottom/);
  assert.match(css, /@media \(max-height: 40rem\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(
    css,
    /^\s*(?:button|input|svg|\.icon|\.screen|\.mini-player)\b/gmu,
  );
});
