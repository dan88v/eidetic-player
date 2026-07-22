export type KeyboardKeyAction =
  | "shift"
  | "backspace"
  | "symbols"
  | "letters"
  | "space"
  | "enter"
  | "hide"
  | "clear";

export interface KeyboardKey {
  readonly label: string;
  readonly value?: string;
  readonly action?: KeyboardKeyAction;
  readonly grow?: number;
}

export type KeyboardRows = readonly (readonly KeyboardKey[])[];

const values = (characters: readonly string[]): readonly KeyboardKey[] =>
  characters.map((value) => ({ label: value, value }));

export const textRows: KeyboardRows = [
  values(["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"]),
  values(["a", "s", "d", "f", "g", "h", "j", "k", "l"]),
  [
    { label: "\u21e7", action: "shift", grow: 1.5 },
    ...values(["z", "x", "c", "v", "b", "n", "m"]),
    { label: "\u232b", action: "backspace", grow: 1.5 },
  ],
  [
    { label: "123", action: "symbols" },
    { label: ",", value: "," },
    { label: "Space", action: "space", grow: 4 },
    { label: ".", value: "." },
    { label: "Done", action: "enter", grow: 2 },
    { label: "Hide", action: "hide" },
  ],
];

export const symbolRows: KeyboardRows = [
  values(["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"]),
  values(["-", "/", ":", ";", "(", ")", "\u20ac", "&", "@", '"']),
  [
    { label: "#+=", action: "letters", grow: 2 },
    ...values([".", ",", "?", "!", "'", "+"]),
    { label: "\u232b", action: "backspace", grow: 2 },
  ],
  [
    { label: "ABC", action: "letters" },
    { label: "Space", action: "space", grow: 6 },
    { label: "Done", action: "enter", grow: 2 },
    { label: "Hide", action: "hide" },
  ],
];

export const numericRows: KeyboardRows = [
  values(["1", "2", "3"]),
  values(["4", "5", "6"]),
  values(["7", "8", "9"]),
  [
    { label: "Clear", action: "clear" },
    { label: "0", value: "0" },
    { label: "\u232b", action: "backspace" },
  ],
  [
    { label: "Done", action: "enter", grow: 2 },
    { label: "Hide", action: "hide" },
  ],
];

export const ipv4Rows: KeyboardRows = [
  values(["1", "2", "3"]),
  values(["4", "5", "6"]),
  values(["7", "8", "9"]),
  [
    { label: ".", value: "." },
    { label: "0", value: "0" },
    { label: "\u232b", action: "backspace" },
  ],
  [
    { label: "Clear", action: "clear" },
    { label: "Done", action: "enter" },
    { label: "Hide", action: "hide" },
  ],
];
