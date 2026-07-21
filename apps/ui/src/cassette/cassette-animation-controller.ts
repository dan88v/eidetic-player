import type { CassetteSnapshot } from "./cassette-snapshot";
import {
  deriveAngularVelocity,
  deriveReelGeometry,
  integrateAngle,
} from "./cassette-physics";

export interface CassetteAnimationElements {
  readonly sourceTape: SVGGraphicsElement;
  readonly destinationTape: SVGGraphicsElement;
  readonly sourceReel: SVGGraphicsElement;
  readonly destinationReel: SVGGraphicsElement;
  readonly capstan: SVGGraphicsElement;
  readonly mechanism: SVGGraphicsElement;
  readonly tapePath: SVGGraphicsElement;
  readonly root: HTMLElement;
}

const FRAME_INTERVAL_MS = 1_000 / 30;
const PROGRESS_SETTLE_EPSILON = 0.0005;

export class CassetteAnimationController {
  private frameId = 0;
  private lastTimestamp = 0;
  private progress = 0;
  private targetProgress = 0;
  private sourceAngle = 0;
  private destinationAngle = 0;
  private capstanAngle = 0;
  private mechanism = 0;
  private targetMechanism = 0;
  private playing = false;
  private visible = !document.hidden;
  private animationsEnabled: boolean;
  private destroyed = false;

  constructor(
    private readonly elements: CassetteAnimationElements,
    animationsEnabled: boolean,
    private readonly onError: () => void,
  ) {
    this.animationsEnabled = animationsEnabled;
  }

  update(snapshot: CassetteSnapshot): void {
    this.targetProgress = snapshot.progress;
    this.playing =
      !snapshot.queueEmpty && snapshot.status === "playing" && !snapshot.paused;
    this.targetMechanism = snapshot.queueEmpty
      ? 0
      : snapshot.status === "paused" || snapshot.paused
        ? 0.62
        : snapshot.status === "playing"
          ? 1
          : 0;
    this.elements.root.dataset.tapeConfidence = snapshot.confidence;
    this.elements.root.dataset.transportState = snapshot.queueEmpty
      ? "empty"
      : snapshot.seeking
        ? "seeking"
        : this.playing
          ? "playing"
          : snapshot.status === "paused" || snapshot.paused
            ? "paused"
            : "stopped";
    if (!this.animationsEnabled) {
      this.progress = this.targetProgress;
      this.mechanism = this.targetMechanism;
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
      this.mechanism = this.targetMechanism;
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
      this.destroy();
      this.onError();
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
    const mechanismBlend = Math.min(1, deltaSeconds / 0.22);
    this.progress += (this.targetProgress - this.progress) * progressBlend;
    this.mechanism += (this.targetMechanism - this.mechanism) * mechanismBlend;
    if (Math.abs(this.targetProgress - this.progress) < PROGRESS_SETTLE_EPSILON)
      this.progress = this.targetProgress;
    if (Math.abs(this.targetMechanism - this.mechanism) < 0.005)
      this.mechanism = this.targetMechanism;
    if (this.playing) {
      const geometry = deriveReelGeometry(this.progress);
      const velocity = deriveAngularVelocity(245, geometry);
      this.sourceAngle = integrateAngle(
        this.sourceAngle,
        velocity.source,
        deltaSeconds,
      );
      this.destinationAngle = integrateAngle(
        this.destinationAngle,
        velocity.destination,
        deltaSeconds,
      );
      this.capstanAngle = integrateAngle(this.capstanAngle, 5.2, deltaSeconds);
    }
    this.render();
    if (
      this.playing ||
      this.progress !== this.targetProgress ||
      this.mechanism !== this.targetMechanism
    )
      this.ensureFrame();
    else this.lastTimestamp = 0;
  }

  private render(): void {
    const geometry = deriveReelGeometry(this.progress);
    this.elements.sourceTape.style.transform = `scale(${String(geometry.sourceRadius / 72)})`;
    this.elements.destinationTape.style.transform = `scale(${String(geometry.destinationRadius / 72)})`;
    this.elements.sourceReel.style.transform = `rotate(${String(this.sourceAngle)}rad)`;
    this.elements.destinationReel.style.transform = `rotate(${String(this.destinationAngle)}rad)`;
    this.elements.capstan.style.transform = `rotate(${String(this.capstanAngle)}rad)`;
    this.elements.mechanism.style.transform = `translateY(${String((1 - this.mechanism) * -13)}px)`;
    this.elements.tapePath.style.opacity = String(0.55 + this.mechanism * 0.45);
  }

  private cancel(): void {
    if (this.frameId) cancelAnimationFrame(this.frameId);
    this.frameId = 0;
    this.lastTimestamp = 0;
  }
}
