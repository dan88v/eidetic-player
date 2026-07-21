import type { PlayerState } from "../../../../packages/shared/src/player";
import { formatRemainingTime, formatTime } from "../components/timeline";
import { t } from "../i18n";
import type { TimelineTimeMode } from "../state/types";
import { createTrackPresentationSnapshot } from "../state/track-transition-coordinator";

export interface CassetteTimeRow {
  readonly element: HTMLElement;
  update(state: PlayerState): void;
  updateSeekPreview(positionSeconds: number | null): void;
}

export interface CassetteTimeDisplay {
  readonly elapsed: string;
  readonly end: string;
  readonly positionSeconds: number;
  readonly validDuration: boolean;
}

export function deriveCassetteTimeDisplay(
  positionSeconds: number,
  durationSeconds: number,
  timeMode: TimelineTimeMode,
  previewPositionSeconds: number | null = null,
): CassetteTimeDisplay {
  const validDuration = Number.isFinite(durationSeconds) && durationSeconds > 0;
  const position = validDuration
    ? Math.max(
        0,
        Math.min(durationSeconds, previewPositionSeconds ?? positionSeconds),
      )
    : 0;
  return {
    elapsed: formatTime(position),
    end:
      timeMode === "remaining"
        ? formatRemainingTime(position, durationSeconds)
        : formatTime(durationSeconds),
    positionSeconds: position,
    validDuration,
  };
}

const setText = (element: HTMLElement, value: string): void => {
  if (element.textContent === value) return;
  if (element.firstChild instanceof Text) element.firstChild.data = value;
  else element.textContent = value;
};

export function createCassetteTimeRow(options: {
  readonly initialPlayerState: PlayerState;
  readonly timeMode: TimelineTimeMode;
  readonly onTimeModeChange: (mode: TimelineTimeMode) => void;
}): CassetteTimeRow {
  let state = options.initialPlayerState;
  let timeMode = options.timeMode;
  let previewPositionSeconds: number | null = null;
  let generation = state.trackTransitionId;
  const element = document.createElement("div");
  element.className = "cassette-player__time-row";
  const elapsed = document.createElement("time");
  elapsed.className = "cassette-player__time cassette-player__time--elapsed";
  elapsed.setAttribute("aria-label", t("timeline.label"));
  const end = document.createElement("button");
  end.className = "cassette-player__time cassette-player__time--end";
  end.type = "button";
  element.append(elapsed, end);

  const render = (): void => {
    const presentation = createTrackPresentationSnapshot(state);
    const display = deriveCassetteTimeDisplay(
      presentation.positionSeconds,
      presentation.durationSeconds,
      timeMode,
      previewPositionSeconds,
    );
    setText(elapsed, display.elapsed);
    elapsed.dateTime = `PT${String(Math.floor(display.positionSeconds))}S`;
    setText(end, display.end);
    end.disabled = !display.validDuration;
    end.setAttribute(
      "aria-label",
      t(timeMode === "total" ? "timeline.showRemaining" : "timeline.showTotal"),
    );
    end.setAttribute("aria-pressed", String(timeMode === "remaining"));
  };

  end.addEventListener("click", () => {
    if (end.disabled) return;
    timeMode = timeMode === "total" ? "remaining" : "total";
    render();
    options.onTimeModeChange(timeMode);
  });
  render();
  return {
    element,
    update(nextState) {
      state = nextState;
      if (nextState.trackTransitionId !== generation) {
        generation = nextState.trackTransitionId;
        previewPositionSeconds = null;
      }
      render();
    },
    updateSeekPreview(positionSeconds) {
      previewPositionSeconds = positionSeconds;
      render();
    },
  };
}
