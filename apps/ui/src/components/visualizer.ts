import type { VisualizerFrame } from "../../../../packages/shared/src/visualizer";
import { t } from "../i18n";
import type { VisualizerMode } from "../state/types";
import { prepareCanvas, type CanvasSize } from "../visualizer/canvas";
import { MeterBallistics } from "../visualizer/meter-ballistics";
import { renderMeter } from "../visualizer/meter-renderer";
import {
  renderSpectrum,
  renderStereoSpectrum,
  SPECTRUM_BAND_COUNT,
} from "../visualizer/spectrum-renderer";
import { VisualizerStreamClient } from "../visualizer/visualizer-stream-client";
import {
  CrestDisplaySmoother,
  crestFactorDb,
  renderTechnical,
} from "../visualizer/technical-renderer";
import {
  readVisualizerSnapshot,
  saveVisualizerSnapshot,
  visualizerSnapshotKey,
} from "../visualizer/visualizer-snapshot-store";
import { nextVisualizerMode } from "../visualizer/visualizer-mode";
import type { ComponentView } from "./types";

const TARGET_FRAME_INTERVAL = 1_000 / 30;
// Player events can drift slightly; a larger jump means the user sought.
const VISUALIZER_SEEK_DISCONTINUITY_SECONDS = 0.4;

function smooth(
  displayed: Float32Array,
  target: Float32Array,
  decay = false,
): boolean {
  let changing = false;
  for (let index = 0; index < displayed.length; index += 1) {
    const current = displayed[index] ?? 0;
    const requested = target[index] ?? 0;
    const factor = requested > current ? 0.68 : decay ? 0.88 : 0.2;
    const next =
      Math.abs(requested - current) < 0.002
        ? requested
        : current + (requested - current) * factor;
    displayed[index] = next;
    if (Math.abs(requested - next) >= 0.002) changing = true;
  }
  return changing;
}

function copy(source: readonly number[], target: Float32Array): void {
  for (let index = 0; index < target.length; index += 1)
    target[index] = source[index] ?? 0;
}

export interface VisualizerView extends ComponentView {
  setTrack(
    playerSessionId: string,
    trackId: string | null,
    generation: number,
  ): void;
  setPlaybackState(
    positionSeconds: number,
    paused: boolean,
    audioBufferSeconds?: number,
  ): void;
}

export function createVisualizer(options: {
  readonly mode: VisualizerMode;
  readonly onModeChange: (mode: VisualizerMode) => void;
}): VisualizerView {
  let mode = options.mode;
  let size: CanvasSize | null = null;
  let animationFrame = 0;
  let lastRenderTime = 0;
  let needsRender = true;
  let hasFrame = false;
  let decaying = false;
  let expectedTrackId: string | null = null;
  let expectedGeneration = -1;
  let expectedPlayerSessionId = "";
  let playbackPositionSeconds = 0;
  let playbackPositionUpdatedAt = performance.now();
  let playbackPaused = true;
  const meter = new MeterBallistics();
  const crestSmoother = new CrestDisplaySmoother();
  let technicalCrestDb: number | null = null;
  let shortTermLufs: number | null = null;
  const monoTarget = new Float32Array(32);
  const monoDisplayed = new Float32Array(32);
  const leftTarget = new Float32Array(16);
  const leftDisplayed = new Float32Array(16);
  const rightTarget = new Float32Array(16);
  const rightDisplayed = new Float32Array(16);
  const stream = new VisualizerStreamClient();
  const element = document.createElement("div");
  element.className = "visualizer";
  element.setAttribute("role", "button");
  element.tabIndex = 0;
  const canvas = document.createElement("canvas");
  canvas.className = "visualizer__canvas";
  canvas.setAttribute("aria-hidden", "true");
  element.append(canvas);

  const stopLoop = (): void => {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    if (import.meta.env.DEV) canvas.dataset.rafActive = "0";
  };

  const draw = (): void => {
    const context = canvas.getContext("2d");
    if (!size || !context || mode === "none") return;
    context.clearRect(0, 0, size.width, size.height);
    if (!hasFrame && mode !== "technical") return;
    if (mode === "meter") {
      const geometry = renderMeter(
        context,
        size,
        meter.displayedDb,
        meter.peakHoldDb,
      );
      if (import.meta.env.DEV) {
        canvas.dataset.meterBarHeight = String(geometry.barHeight);
        canvas.dataset.meterRowGap = String(geometry.rowGap);
        canvas.dataset.meterGraphicBottomOffset = String(
          size.height - geometry.graphicBottom,
        );
      }
    } else if (mode === "spectrumMono") {
      renderSpectrum(context, size, monoDisplayed);
    } else if (mode === "spectrumStereo") {
      renderStereoSpectrum(context, size, leftDisplayed, rightDisplayed);
    } else {
      renderTechnical(context, size, {
        crestDb: technicalCrestDb,
        shortTermLufs,
        meterDb: meter.displayedDb,
        peakHoldDb: meter.peakHoldDb,
      });
    }
    if (import.meta.env.DEV)
      canvas.dataset.draws = String(Number(canvas.dataset.draws ?? "0") + 1);
  };

  const tick = (timestamp: number): void => {
    animationFrame = 0;
    if (mode === "none") return;
    if (timestamp - lastRenderTime < TARGET_FRAME_INTERVAL) {
      animationFrame = requestAnimationFrame(tick);
      return;
    }
    lastRenderTime = timestamp;
    receiveFrameForPosition(timestamp);
    let changing = false;
    if (hasFrame) {
      if (mode === "meter" || mode === "technical")
        changing = meter.update(timestamp);
      else if (mode === "spectrumMono")
        changing = smooth(monoDisplayed, monoTarget, decaying);
      else {
        const leftChanging = smooth(leftDisplayed, leftTarget, decaying);
        const rightChanging = smooth(rightDisplayed, rightTarget, decaying);
        changing = leftChanging || rightChanging;
      }
    }
    if (needsRender || changing) {
      needsRender = false;
      draw();
    }
    if (changing) {
      animationFrame = requestAnimationFrame(tick);
      if (import.meta.env.DEV) canvas.dataset.rafActive = "1";
    } else {
      if (decaying) {
        decaying = false;
        hasFrame = false;
        needsRender = true;
        draw();
      }
      if (import.meta.env.DEV) canvas.dataset.rafActive = "0";
    }
  };

  const startLoop = (): void => {
    if (animationFrame || mode === "none") return;
    animationFrame = requestAnimationFrame(tick);
    if (import.meta.env.DEV) canvas.dataset.rafActive = "1";
  };

  const receiveFrameForPosition = (timestamp: number): void => {
    if (playbackPaused) return;
    const position =
      playbackPositionSeconds +
      Math.max(0, timestamp - playbackPositionUpdatedAt) / 1_000;
    const frame: VisualizerFrame | null = stream.takeForPosition(
      expectedPlayerSessionId,
      expectedTrackId,
      expectedGeneration,
      position,
    );
    if (!frame) return;
    if (
      frame.playerSessionId !== expectedPlayerSessionId ||
      frame.mode !== mode ||
      frame.sampleRate <= 0
    )
      return;
    meter.setPeaks(frame.meter.leftPeak, frame.meter.rightPeak);
    if (mode === "technical") {
      technicalCrestDb = crestSmoother.update(
        crestFactorDb(
          frame.meter.leftPeak,
          frame.meter.leftRms,
          frame.meter.rightPeak,
          frame.meter.rightRms,
        ),
        timestamp,
        document.hidden,
      );
      if (frame.shortTermLufs !== null) shortTermLufs = frame.shortTermLufs;
    }
    copy(frame.monoBands, monoTarget);
    copy(frame.leftBands, leftTarget);
    copy(frame.rightBands, rightTarget);
    hasFrame = true;
    decaying = false;
    needsRender = true;
    startLoop();
    if (import.meta.env.DEV)
      canvas.dataset.framesReceived = String(
        Number(canvas.dataset.framesReceived ?? "0") + 1,
      );
    if (import.meta.env.DEV) {
      canvas.dataset.framePosition = String(frame.positionSeconds);
      canvas.dataset.playerPosition = String(position);
      canvas.dataset.syncOffsetMilliseconds = String(
        Math.round((frame.positionSeconds - position) * 1_000),
      );
      canvas.dataset.bufferedFrames = String(stream.bufferedFrameCount());
    }
  };

  const updateAccessibleState = (): void => {
    const nextMode = nextVisualizerMode(mode);
    element.dataset.mode = mode;
    element.setAttribute("aria-label", `Show ${t(`visualizer.${nextMode}`)}`);
    canvas.dataset.bands =
      mode === "spectrumMono"
        ? String(SPECTRUM_BAND_COUNT)
        : mode === "spectrumStereo"
          ? "16+16"
          : "0";
    if (mode === "none") {
      stream.close();
      stopLoop();
      const context = canvas.getContext("2d");
      if (size && context) context.clearRect(0, 0, size.width, size.height);
    } else {
      stream.open(mode, startLoop);
      needsRender = true;
      startLoop();
    }
  };

  const toggleMode = (): void => {
    mode = nextVisualizerMode(mode);
    meter.reset();
    crestSmoother.reset();
    technicalCrestDb = null;
    shortTermLufs = null;
    hasFrame = false;
    updateAccessibleState();
    options.onModeChange(mode);
  };

  element.addEventListener("click", toggleMode);
  element.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleMode();
  });

  const observer = new ResizeObserver(() => {
    size = prepareCanvas(canvas);
    needsRender = true;
    startLoop();
    if (import.meta.env.DEV)
      canvas.dataset.resizes = String(
        Number(canvas.dataset.resizes ?? "0") + 1,
      );
  });
  observer.observe(canvas);
  updateAccessibleState();
  return {
    element,
    setTrack(playerSessionId, trackId, generation) {
      if (
        playerSessionId === expectedPlayerSessionId &&
        (generation < expectedGeneration ||
          (generation === expectedGeneration && trackId === expectedTrackId))
      )
        return;
      expectedPlayerSessionId = playerSessionId;
      expectedGeneration = generation;
      expectedTrackId = trackId;
      stream.clearFrames();
      const snapshot =
        trackId === null
          ? null
          : readVisualizerSnapshot(
              visualizerSnapshotKey(playerSessionId, trackId, generation, mode),
            );
      if (snapshot) {
        copy(snapshot.meter, meter.displayedDb);
        copy(snapshot.meter, meter.targetDb);
        copy(snapshot.meterPeakHold, meter.peakHoldDb);
        copy(snapshot.mono, monoDisplayed);
        copy(snapshot.mono, monoTarget);
        copy(snapshot.left, leftDisplayed);
        copy(snapshot.left, leftTarget);
        copy(snapshot.right, rightDisplayed);
        copy(snapshot.right, rightTarget);
        technicalCrestDb = snapshot.technicalCrestDb;
        crestSmoother.reset(snapshot.technicalCrestDb, performance.now());
        shortTermLufs = snapshot.shortTermLufs;
        hasFrame = true;
        needsRender = true;
        startLoop();
        return;
      }
      meter.reset();
      crestSmoother.reset();
      technicalCrestDb = null;
      shortTermLufs = null;
      monoTarget.fill(0);
      leftTarget.fill(0);
      rightTarget.fill(0);
      decaying = mode === "technical" ? false : hasFrame;
      if (mode === "technical") hasFrame = false;
      needsRender = true;
      startLoop();
    },
    setPlaybackState(positionSeconds, paused, audioBufferSeconds = 0) {
      const now = performance.now();
      const audiblePositionSeconds = Math.max(
        0,
        positionSeconds - Math.max(0, audioBufferSeconds),
      );
      const estimated =
        playbackPositionSeconds +
        (playbackPaused
          ? 0
          : Math.max(0, now - playbackPositionUpdatedAt) / 1_000);
      const seekDetected =
        Math.abs(audiblePositionSeconds - estimated) >
        VISUALIZER_SEEK_DISCONTINUITY_SECONDS;
      playbackPositionSeconds = audiblePositionSeconds;
      playbackPositionUpdatedAt = now;
      playbackPaused = paused;
      meter.setPaused(paused, now);
      if (seekDetected) {
        stream.clearFrames();
        meter.reset();
        meter.setPaused(paused, now);
        crestSmoother.reset();
        technicalCrestDb = null;
        shortTermLufs = null;
        monoTarget.fill(0);
        leftTarget.fill(0);
        rightTarget.fill(0);
        decaying = mode === "technical" ? false : hasFrame;
        if (mode === "technical") hasFrame = false;
        needsRender = true;
      }
      startLoop();
    },
    destroy() {
      if (expectedTrackId && hasFrame)
        saveVisualizerSnapshot(
          visualizerSnapshotKey(
            expectedPlayerSessionId,
            expectedTrackId,
            expectedGeneration,
            mode,
          ),
          {
            meter: [...meter.displayedDb],
            meterPeakHold: [...meter.peakHoldDb],
            mono: [...monoDisplayed],
            left: [...leftDisplayed],
            right: [...rightDisplayed],
            technicalCrestDb,
            shortTermLufs,
          },
        );
      observer.disconnect();
      stream.close();
      stopLoop();
    },
  };
}
