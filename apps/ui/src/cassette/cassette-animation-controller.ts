import type { CassetteSnapshot } from "./cassette-snapshot";
import {
  CASSETTE_FULL_RADIUS,
  deriveAngularVelocity,
  deriveReelGeometry,
  integrateAngle,
} from "./cassette-physics";

export interface CassetteAnimationElements {
  readonly sourceTape: SVGGraphicsElement;
  readonly destinationTape: SVGGraphicsElement;
  readonly sourceReel: SVGGraphicsElement;
  readonly destinationReel: SVGGraphicsElement;
  readonly centerTape: SVGGraphicsElement;
}

const FRAME_INTERVAL_MS = 1_000 / 30;
const PROGRESS_SETTLE_EPSILON = 0.0005;
const MOTION_SETTLE_EPSILON = 0.005;
const CENTER_TAPE_PATTERN_WIDTH = 12;
const CENTER_TAPE_SPEED = 30;

export function advanceCassetteMotionScale(
  current: number,
  playing: boolean,
  deltaSeconds: number,
): number {
  const target = playing ? 1 : 0;
  const boundedDelta = Math.max(0, Math.min(0.1, deltaSeconds));
  const blend = Math.min(1, boundedDelta / (playing ? 0.12 : 0.2));
  const next = current + (target - current) * blend;
  return Math.abs(target - next) < MOTION_SETTLE_EPSILON ? target : next;
}

export class CassetteAnimationController {
  private frameId = 0;
  private lastTimestamp = 0;
  private progress = 0;
  private targetProgress = 0;
  private sourceAngle = 0;
  private destinationAngle = 0;
  private sourceVelocity = 0;
  private destinationVelocity = 0;
  private motionScale = 0;
  private centerTapeOffset = 0;
  private playing = false;
  private visible = !document.hidden;
  private animationsEnabled: boolean;
  private destroyed = false;

  constructor(
    private readonly root: HTMLElement,
    private elements: CassetteAnimationElements,
    animationsEnabled: boolean,
    private readonly onError: (error: unknown) => boolean,
  ) {
    this.animationsEnabled = animationsEnabled;
  }

  update(snapshot: CassetteSnapshot): void {
    this.targetProgress = snapshot.progress;
    this.playing =
      !snapshot.queueEmpty && snapshot.status === "playing" && !snapshot.paused;
    this.root.dataset.tapeConfidence = snapshot.confidence;
    this.root.dataset.transportState = snapshot.queueEmpty
      ? "empty"
      : snapshot.seeking
        ? "seeking"
        : this.playing
          ? "playing"
          : snapshot.status === "paused" || snapshot.paused
            ? "paused"
            : "stopped";
    this.root.dataset.centerTapeMoving = String(this.playing);
    if (!this.animationsEnabled) {
      this.progress = this.targetProgress;
      this.motionScale = 0;
      this.render();
      this.cancel();
      return;
    }
    this.ensureFrame();
  }

  setAnimationsEnabled(enabled: boolean): void {
    this.animationsEnabled = enabled;
    if (!enabled) {
      this.progress = this.targetProgress;
      this.motionScale = 0;
      this.render();
      this.cancel();
    } else this.ensureFrame();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.lastTimestamp = 0;
    if (visible) this.ensureFrame();
    else this.cancel();
  }

  destroy(): void {
    this.destroyed = true;
    this.cancel();
  }

  setElements(elements: CassetteAnimationElements): void {
    this.elements = elements;
    this.render();
  }

  private ensureFrame(): void {
    if (
      this.frameId ||
      this.destroyed ||
      !this.visible ||
      !this.animationsEnabled
    )
      return;
    this.frameId = requestAnimationFrame(this.tick);
  }

  private readonly tick = (timestamp: number): void => {
    this.frameId = 0;
    if (!this.visible || this.destroyed || !this.animationsEnabled) return;
    try {
      this.runFrame(timestamp);
    } catch (error) {
      console.error("[cassette] animation frame failed", error);
      this.cancel();
      if (this.onError(error)) this.ensureFrame();
      else this.destroyed = true;
    }
  };

  private runFrame(timestamp: number): void {
    if (
      this.lastTimestamp &&
      timestamp - this.lastTimestamp < FRAME_INTERVAL_MS
    ) {
      this.ensureFrame();
      return;
    }
    const deltaSeconds = this.lastTimestamp
      ? Math.min(0.1, (timestamp - this.lastTimestamp) / 1_000)
      : 0;
    this.lastTimestamp = timestamp;
    const progressBlend = Math.min(1, deltaSeconds / 0.4);
    this.progress += (this.targetProgress - this.progress) * progressBlend;
    if (Math.abs(this.targetProgress - this.progress) < PROGRESS_SETTLE_EPSILON)
      this.progress = this.targetProgress;
    this.motionScale = advanceCassetteMotionScale(
      this.motionScale,
      this.playing,
      deltaSeconds,
    );
    const geometry = deriveReelGeometry(this.progress);
    if (this.playing) {
      const velocity = deriveAngularVelocity(245, geometry);
      this.sourceVelocity = velocity.source;
      this.destinationVelocity = velocity.destination;
      this.centerTapeOffset =
        (this.centerTapeOffset + CENTER_TAPE_SPEED * deltaSeconds) %
        CENTER_TAPE_PATTERN_WIDTH;
    }
    if (this.motionScale > 0) {
      this.sourceAngle = integrateAngle(
        this.sourceAngle,
        this.sourceVelocity * this.motionScale,
        deltaSeconds,
      );
      this.destinationAngle = integrateAngle(
        this.destinationAngle,
        this.destinationVelocity * this.motionScale,
        deltaSeconds,
      );
    }
    this.render();
    if (
      this.playing ||
      this.progress !== this.targetProgress ||
      this.motionScale > 0
    )
      this.ensureFrame();
    else this.lastTimestamp = 0;
  }

  private render(): void {
    const geometry = deriveReelGeometry(this.progress);
    this.elements.sourceTape.style.transform = `scale(${String(geometry.sourceRadius / CASSETTE_FULL_RADIUS)})`;
    this.elements.destinationTape.style.transform = `scale(${String(geometry.destinationRadius / CASSETTE_FULL_RADIUS)})`;
    this.elements.sourceReel.style.transform = `rotate(${String(this.sourceAngle)}rad)`;
    this.elements.destinationReel.style.transform = `rotate(${String(this.destinationAngle)}rad)`;
    this.elements.centerTape.style.transform = `translateX(-${String(this.centerTapeOffset)}px)`;
  }

  private cancel(): void {
    if (this.frameId) cancelAnimationFrame(this.frameId);
    this.frameId = 0;
    this.lastTimestamp = 0;
  }
}
