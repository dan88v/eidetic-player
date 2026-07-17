export interface SegmentOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

export interface SegmentedControl<T extends string> {
  readonly element: HTMLElement;
  setValue(value: T): void;
}

export function createSegmentedControl<T extends string>(options: {
  readonly label: string;
  readonly value: T;
  readonly items: readonly SegmentOption<T>[];
  readonly onChange: (value: T) => void;
}): SegmentedControl<T> {
  const element = document.createElement("div");
  element.className = "segmented-control";
  element.setAttribute("role", "radiogroup");
  element.setAttribute("aria-label", options.label);

  for (const item of options.items) {
    const button = document.createElement("button");
    button.className = "segmented-control__option";
    button.type = "button";
    button.dataset.value = item.value;
    button.setAttribute("role", "radio");
    button.textContent = item.label;
    button.addEventListener("click", () => {
      setValue(item.value);
      options.onChange(item.value);
    });
    element.append(button);
  }

  function setValue(value: T): void {
    for (const button of element.querySelectorAll<HTMLButtonElement>(
      "button",
    )) {
      const selected = button.dataset.value === value;
      button.setAttribute("aria-checked", String(selected));
      button.classList.toggle("segmented-control__option--selected", selected);
      button.tabIndex = selected ? 0 : -1;
    }
  }

  element.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const items = [...element.querySelectorAll<HTMLButtonElement>("button")];
    const currentIndex = items.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    if (currentIndex < 0) return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const next =
      items[(currentIndex + direction + items.length) % items.length];
    next?.click();
    next?.focus();
  });

  setValue(options.value);
  return { element, setValue };
}
