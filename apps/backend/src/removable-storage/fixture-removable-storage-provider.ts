import type {
  RemovableStorageProvider,
  RemovableVolumeCandidate,
} from "./removable-storage-provider.js";

export class FixtureRemovableStorageProvider implements RemovableStorageProvider {
  readonly platform = "fixture" as const;
  private volumes: readonly RemovableVolumeCandidate[];
  enumerateCount = 0;
  closed = false;

  constructor(initial: readonly RemovableVolumeCandidate[] = []) {
    this.volumes = initial;
  }

  setVolumes(volumes: readonly RemovableVolumeCandidate[]): void {
    this.volumes = volumes;
  }

  enumerate(): Promise<readonly RemovableVolumeCandidate[]> {
    this.enumerateCount += 1;
    return Promise.resolve(this.volumes);
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}
