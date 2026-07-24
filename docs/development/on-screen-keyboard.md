# Reusable on-screen keyboard

The reusable keyboard lives in `packages/on-screen-keyboard`. It is a small,
framework-free TypeScript and CSS package: it does not import Eidetic state,
styles, persistence, routing, or platform APIs. The Eidetic-specific adapter is
`apps/ui/src/components/eidetic-keyboard-adapter.ts`.

## Integration contract

Eidetic mounts exactly one keyboard with the application shell. Fields opt in
explicitly with `data-onscreen-keyboard="text|numeric|ipv4|password"`; no generic input
selector is used. `data-onscreen-keyboard-enter="search"` keeps the keyboard
open after dispatching one Enter event, while the default `done` action closes
it. The real input remains focused and authoritative; the keyboard does not
render a duplicate value field.

The text profile contains an alphabetic layer and a `123` symbols layer. Both
use the same exact ten-column geometry. The alphabetic rows follow the
touch-keyboard stagger: `ASDFGHJKL` is centred between the first-row keys, and
the third-row Shift/Backspace widths align Z below S and M below K. The symbols
layer places digits above symbols and keeps its function keys symmetrical. The
password profile reuses QWERTY and symbols without rendering a duplicate value
or preview; password fields remain ineligible unless they explicitly choose
that profile. Show/Hide remains owned by the form. The numeric profile exposes
digits only; IPv4 adds the decimal point. Both include
Backspace, Clear where applicable, Done, and Hide.

The adapter maps package tokens to Eidetic theme variables and localized
labels. New products can use the package directly by supplying their own mount,
labels, theme tokens, native-keyboard preference, and visibility callback.

## Opening and lifecycle

`Auto` is the default Eidetic setting. Automatic opening requires all of the
following:

- an explicitly opted-in, editable field (password requires the password profile);
- a touch or pen pointer origin;
- the setting to be `Auto`;
- a host that does not prefer its native software keyboard.

Mouse focus and physical-keyboard focus never open it automatically in Auto.
`Always` opens every eligible opted-in field on focus, including mouse focus on
Windows, while physical-keyboard input remains usable. A host preference for
the native software keyboard still takes priority over both Auto and Always.
`Off` hides the current keyboard immediately and prevents later automatic
opening.
Hide, Done, Escape, focus leaving the active field, field removal, route
rendering, and shell teardown all close it. The single controller owns its
document listeners and removes them on teardown. It adds no timer, backend
request, or persistence of its own. Eidetic's one adapter observes only the
mounted keyboard's size so keyboard-aware dialogs can use its current top edge;
the observer is disconnected with the adapter.

Edits use the real field selection and `setRangeText`, then dispatch one
bubbling `input` event. Backspace, selection replacement, `maxlength`, Shift,
double-tap Caps Lock, symbols, Clear, Search/Done, and focus preservation are
therefore compatible with the field's existing validation and debounce logic.

## Layout and motion

The bottom sheet spans the full viewport width and uses a one-pixel grid rather
than rounded borders around every key. At the primary 1280 x 800 viewport text
keys are 64 px high. The emergency 1024 x 600 layout keeps 56 px keys and does
not introduce horizontal overflow. The sheet is layered above the mini-player,
keeps safe-area padding at the bottom, uses only transform/opacity for its short
transition, and becomes static when Eidetic animations are Off or the operating
system requests reduced motion.

Future fields must opt in through the adapter and choose the narrowest profile.
Do not mount another controller, copy layouts into an application component, or
attach ad hoc document listeners.

The SMB Add/Edit dialog is the reference keyboard-aware dialog. Its fixed
header, explicit Account/Guest segmented control, and fixed footer remain above
the keyboard; only its form body scrolls. The adapter publishes the measured
keyboard height on the app root after layout and resize. At 1024 x 600 the
title, selected authentication mode, focused field, and Cancel/Connect or
Cancel/Save remain visible without placing the dialog above the keyboard.
