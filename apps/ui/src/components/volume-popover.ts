import { icon } from "./icons";
import { t } from "../i18n";

export interface VolumePopover {
  readonly element: HTMLElement;
  readonly backdrop: HTMLElement;
  setOpen(open: boolean): void;
  setReturnFocus(element: HTMLElement): void;
  setState(volume: number, muted: boolean): void;
  containFocus(event: KeyboardEvent): void;
}

export function createVolumePopover(options: {
  readonly onClose: () => void;
  readonly onVolume: (volume: number) => void;
  readonly onMute: (muted: boolean) => void;
}): VolumePopover {
  let volume = 100;
  let muted = false;
  let lastSentAt = 0;
  let returnFocus: HTMLElement | null = null;
  const backdrop = document.createElement("div");
  backdrop.className = "volume-backdrop";
  const element = document.createElement("section");
  element.className = "volume-popover";
  element.id = "volume-popover";
  element.setAttribute("role", "dialog");
  element.setAttribute("aria-label", t("volume.label"));
  element.innerHTML = `
    <strong class="volume-popover__value">100%</strong>
    <div class="volume-slider" role="slider" tabindex="0" aria-label="${t("volume.slider")}" aria-valuemin="0" aria-valuemax="100">
      <div class="volume-slider__rail"><div class="volume-slider__fill"></div><span class="volume-slider__thumb"></span></div>
    </div>
    <button class="volume-popover__mute icon-button" type="button">${icon("volume")}</button>`;
  const value = element.querySelector<HTMLElement>(".volume-popover__value");
  const slider = element.querySelector<HTMLElement>(".volume-slider");
  const fill = element.querySelector<HTMLElement>(".volume-slider__fill");
  const thumb = element.querySelector<HTMLElement>(".volume-slider__thumb");
  const muteButton = element.querySelector<HTMLButtonElement>(
    ".volume-popover__mute",
  );
  if (!value || !slider || !fill || !thumb || !muteButton)
    throw new Error("Volume popover is incomplete");

  const render = (): void => {
    const percent = `${String(Math.round(volume))}%`;
    value.textContent = percent;
    slider.setAttribute("aria-valuenow", String(Math.round(volume)));
    slider.setAttribute("aria-valuetext", percent);
    fill.style.height = percent;
    thumb.style.bottom = `calc(${percent} - 0.625rem)`;
    muteButton.innerHTML = icon(muted ? "volumeMuted" : "volume");
    muteButton.setAttribute(
      "aria-label",
      t(muted ? "volume.unmute" : "volume.mute"),
    );
    muteButton.setAttribute("aria-pressed", String(muted));
  };
  const fromPointer = (event: PointerEvent): number => {
    const bounds = slider.getBoundingClientRect();
    return Math.max(
      0,
      Math.min(100, ((bounds.bottom - event.clientY) / bounds.height) * 100),
    );
  };
  const preview = (next: number, final: boolean): void => {
    volume = next;
    render();
    const now = performance.now();
    if (final || now - lastSentAt >= 100) {
      lastSentAt = now;
      options.onVolume(volume);
    }
  };
  slider.addEventListener("pointerdown", (event) => {
    slider.setPointerCapture(event.pointerId);
    preview(fromPointer(event), false);
  });
  slider.addEventListener("pointermove", (event) => {
    if (slider.hasPointerCapture(event.pointerId))
      preview(fromPointer(event), false);
  });
  slider.addEventListener("pointerup", (event) => {
    if (!slider.hasPointerCapture(event.pointerId)) return;
    preview(fromPointer(event), true);
    slider.releasePointerCapture(event.pointerId);
  });
  slider.addEventListener("keydown", (event) => {
    let next = volume;
    if (event.key === "ArrowUp" || event.key === "ArrowRight") next += 2;
    else if (event.key === "ArrowDown" || event.key === "ArrowLeft") next -= 2;
    else if (event.key === "PageUp") next += 10;
    else if (event.key === "PageDown") next -= 10;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = 100;
    else return;
    event.preventDefault();
    preview(Math.max(0, Math.min(100, next)), true);
  });
  muteButton.addEventListener("click", () => {
    options.onMute(!muted);
  });
  backdrop.addEventListener("pointerup", options.onClose);
  render();
  return {
    element,
    backdrop,
    setReturnFocus(next) {
      returnFocus = next;
    },
    setOpen(open) {
      element.classList.toggle("volume-popover--open", open);
      backdrop.classList.toggle("volume-backdrop--visible", open);
      element.inert = !open;
      element.setAttribute("aria-hidden", String(!open));
      if (open) {
        const anchor = returnFocus?.getBoundingClientRect();
        if (anchor) {
          const viewportInset = 8;
          const left = Math.max(
            viewportInset,
            Math.min(
              window.innerWidth - element.offsetWidth - viewportInset,
              anchor.left + anchor.width / 2 - element.offsetWidth / 2,
            ),
          );
          const top = Math.max(
            viewportInset,
            anchor.top - element.offsetHeight - 8,
          );
          element.style.left = `${String(left)}px`;
          element.style.top = `${String(top)}px`;
        }
        slider.focus();
      } else {
        returnFocus?.setAttribute("aria-expanded", "false");
        returnFocus?.focus();
      }
    },
    setState(nextVolume, nextMuted) {
      volume = nextVolume;
      muted = nextMuted;
      render();
    },
    containFocus(event) {
      if (event.key !== "Tab") return;
      if (event.shiftKey && document.activeElement === slider) {
        event.preventDefault();
        muteButton.focus();
      } else if (!event.shiftKey && document.activeElement === muteButton) {
        event.preventDefault();
        slider.focus();
      }
    },
  };
}
