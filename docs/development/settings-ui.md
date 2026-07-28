# Settings UI contract

Read this document before every change to the Settings panel. `Interface` is
the canonical Settings surface; Audio, Network, System, and future sections
must reuse its information architecture and visual language.

## Page structure

- The app top bar owns the page title.
- A Settings subpage starts with the canonical compact Back/description row.
- Related settings live in one bordered `.settings-panel`.
- Use an uppercase section label only to separate distinct groups inside the
  same page. Do not create decorative cards or duplicate page headings.
- A row keeps the established fixed touch height, horizontal padding,
  typography, divider, focus ring, and chevron geometry.
- Responsive layouts may scroll vertically but must not shrink touch targets or
  create horizontal overflow.

## Choosing the correct control

- Boolean or two-state values use the shared segmented pill control inline:
  `On / Off`, `On / Bypass`, or another explicit pair.
- Three or more choices use a navigation row with the current value below the
  label and a chevron. The dedicated selection page shows one checkmark at the
  right of the selected row.
- A navigation row is for navigation only. Do not use a left border to
  represent selection.
- Sliders are reserved for continuous values. They require a visible neutral
  or center state, a large touch thumb, keyboard operation, and a human label
  rather than an implementation-unit readout when the unit is not useful.
- A setting that is bypassed but still editable remains enabled and receives a
  subdued treatment. The controlling `On / Bypass` field already communicates
  that state, so affected child rows do not repeat `Bypassed` pills. Disabling
  controls is reserved for actions that are genuinely unavailable.

## State, pills, checks, and messages

- A checkmark means selected preference.
- A compact pill inside a row means runtime state such as `In use`,
  `Activating`, or `Unavailable`; it is not repeated merely because an ancestor
  processing section is bypassed.
- Persistent status prose does not sit above a selection list.
- Success and error messages use the single application toast host.
- Selection feedback is immediate: show the new check as soon as the user
  selects it, then use a pill for activation progress until authoritative state
  confirms it. Roll back on failure and show a toast.
- Never use a border, color alone, or hover state as the only state indicator.

## Dialogs

- Confirmations reuse the canonical source-dialog surface: fixed backdrop,
  centered dark panel, title, concise description, Cancel and primary action.
- Dialogs trap focus, close with Escape or backdrop before submission, restore
  focus, and stay above the mini-player and on-screen keyboard.
- Do not create an unstyled native `<dialog>` or a one-off modal class in a
  Settings screen.

## Audio-specific hierarchy

The Audio root owns all frequently used controls:

1. Output Device
2. Software Volume and, when effective, Maximum Software Volume
3. Channels and Balance
4. Sound Processing
5. Parametric EQ and Parametric EQ Bands
6. Gain Compensation and Headroom
7. Advanced diagnostics

For a new or reset profile, Sound Processing and Parametric EQ both default to
`Bypass`. A persisted explicit choice remains authoritative.

Output Device groups canonical physical devices first and separates raw MPV
routes under an Advanced section. Selected devices/routes use a right-side
check; runtime activation uses a pill.

Parametric EQ Bands is the intentional exception to ordinary Settings rows. It
uses one sticky response graph, six large band selectors, and touch-sized
frequency, gain, and Q controls. It must remain Canvas 2D, redraw only on input
or resize, and must not add an animation loop, analyzer, or audio process.
The response curve has a restrained accent fill down to the neutral axis.
Touch-dragging a graph point changes only its frequency and gain and commits
once on release; Q remains in its dedicated slider. The graph Canvas is
excluded from the shared page-scroll fallback and uses `touch-action: none`; a
band drag must never hand capture to the Settings scroller, move the page, or
restore the pre-gesture value. The graph header exposes
the authoritative automatic compensation, manual preamp, Off, or inactive
state as plain text rather than a status pill.
The Audio root also exposes `Gain Compensation — On / Off`: On selects
automatic headroom, while Off selects Headroom Off. The adjacent Headroom page
continues to provide Auto, Manual, and Off. Fixed output may reject Off when
the active EQ would otherwise produce positive output gain.
Bands 1 and 6 default respectively to low-shelf and high-shelf filters and
expose a `Shelving / Bell` segmented field. Bands 2–5 remain bell filters.

When Software Volume is Fixed, every main-player volume trigger is hidden,
including Default and Cassette modes. Queue and the surrounding transport
geometry remain stable.

## Required validation

- Compare the changed page directly with Interface in the real
  Neutralino/WebView2 application launched by `npm.cmd run dev`.
- Inspect `1280 × 800` and every responsive size named by the step.
- Exercise touch-sized controls with real pointer input, confirmation focus,
  Back navigation, scrolling, toast feedback, bypass styling, and rollback.
- Confirm no white flash, layout shift, scroll jump, duplicate observer/timer,
  stale state, or shared top-bar/mini-player regression.
