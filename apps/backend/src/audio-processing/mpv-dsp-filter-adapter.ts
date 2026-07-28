import { EIDETIC_DSP_FILTER_LABEL } from "./dsp-config.js";

export interface MpvDspCommandAdapter {
  isMpvAvailable(): boolean;
  commandMpv(command: readonly unknown[]): Promise<unknown>;
}

export class MpvDspFilterAdapter {
  private operation: Promise<void> = Promise.resolve();
  private requestedGeneration = 0;
  private appliedFilter: string | null = null;

  constructor(private readonly adapter: MpvDspCommandAdapter) {}

  apply(filter: string | null): Promise<void> {
    const generation = ++this.requestedGeneration;
    const result = this.operation.then(() => this.applyNow(filter, generation));
    this.operation = result.catch(() => undefined);
    return result;
  }

  private async applyNow(
    filter: string | null,
    generation: number,
  ): Promise<void> {
    if (generation !== this.requestedGeneration) return;
    if (!this.adapter.isMpvAvailable()) return;
    const previous = this.appliedFilter;
    try {
      await this.adapter
        .commandMpv(["af", "remove", `@${EIDETIC_DSP_FILTER_LABEL}`])
        .catch(() => undefined);
      if (generation !== this.requestedGeneration) return;
      if (filter) await this.adapter.commandMpv(["af", "add", filter]);
      this.appliedFilter = filter;
    } catch (error) {
      await this.adapter
        .commandMpv(["af", "remove", `@${EIDETIC_DSP_FILTER_LABEL}`])
        .catch(() => undefined);
      if (previous)
        await this.adapter
          .commandMpv(["af", "add", previous])
          .catch(() => undefined);
      this.appliedFilter = previous;
      throw error;
    }
  }
}
