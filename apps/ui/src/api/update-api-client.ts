import type { ApiResponse } from "../../../../packages/shared/src/player";
import type { SoftwareUpdateSnapshot } from "../../../../packages/shared/src/update";
import { config } from "../config";
import { PlayerApiError } from "./player-api-client";

const apiBaseUrl = config.development
  ? ""
  : `http://${config.backendHost}:${String(config.backendPort)}`;

const activeUpdateStates = new Set([
  "queued",
  "running",
  "activating",
  "restarting",
  "verifying",
]);

interface UpdateSubscriber {
  readonly onSnapshot: (snapshot: SoftwareUpdateSnapshot) => void;
  readonly onError: () => void;
}

export class UpdateApiClient {
  private readonly subscribers = new Set<UpdateSubscriber>();
  private eventSource: EventSource | null = null;
  private lastSnapshot: SoftwareUpdateSnapshot | null = null;

  state(): Promise<SoftwareUpdateSnapshot> {
    return this.request("/api/system/update/state");
  }

  subscribe(
    onSnapshot: (snapshot: SoftwareUpdateSnapshot) => void,
    onError: () => void,
  ): () => void {
    const subscriber = { onSnapshot, onError };
    this.subscribers.add(subscriber);
    if (this.lastSnapshot && this.isActive(this.lastSnapshot))
      this.ensureEventSource();
    return () => {
      this.subscribers.delete(subscriber);
      if (this.subscribers.size === 0) this.closeEventSource();
    };
  }

  refreshBranches(): Promise<SoftwareUpdateSnapshot> {
    return this.action("/api/system/update/branches/refresh", {});
  }

  selectBranch(branch: string): Promise<SoftwareUpdateSnapshot> {
    return this.action("/api/system/update/branch", { branch }, "PATCH");
  }

  check(): Promise<SoftwareUpdateSnapshot> {
    return this.action("/api/system/update/check", {});
  }

  start(
    planId: string,
    expectedTargetCommitSha: string,
  ): Promise<SoftwareUpdateSnapshot> {
    return this.action("/api/system/update/start", {
      planId,
      expectedTargetCommitSha,
    });
  }

  private action(
    path: string,
    body: object,
    method = "POST",
  ): Promise<SoftwareUpdateSnapshot> {
    return this.request(path, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  private async request(path: string, init: RequestInit = {}) {
    const response = await fetch(`${apiBaseUrl}${path}`, init);
    const payload =
      (await response.json()) as ApiResponse<SoftwareUpdateSnapshot>;
    if (!response.ok || !payload.ok) {
      const error = payload.ok ? null : payload.error;
      throw new PlayerApiError(
        error?.code ?? "UPDATE_REQUEST_FAILED",
        error?.message ?? "Software Update could not complete the request.",
      );
    }
    if (payload.data === undefined)
      throw new PlayerApiError(
        "UPDATE_REQUEST_FAILED",
        "Software Update returned no state.",
      );
    this.acceptSnapshot(payload.data);
    return payload.data;
  }

  private acceptSnapshot(snapshot: SoftwareUpdateSnapshot): void {
    this.lastSnapshot = snapshot;
    for (const subscriber of this.subscribers) subscriber.onSnapshot(snapshot);
    if (this.isActive(snapshot)) this.ensureEventSource();
    else this.closeEventSource();
  }

  private isActive(snapshot: SoftwareUpdateSnapshot): boolean {
    return activeUpdateStates.has(snapshot.job.state);
  }

  private ensureEventSource(): void {
    if (this.eventSource || this.subscribers.size === 0) return;
    const source = new EventSource(`${apiBaseUrl}/api/system/update/events`);
    this.eventSource = source;
    source.onmessage = (event) => {
      try {
        this.acceptSnapshot(
          JSON.parse(String(event.data)) as SoftwareUpdateSnapshot,
        );
      } catch {
        for (const subscriber of this.subscribers) subscriber.onError();
      }
    };
    source.onerror = () => {
      for (const subscriber of this.subscribers) subscriber.onError();
    };
  }

  private closeEventSource(): void {
    this.eventSource?.close();
    this.eventSource = null;
  }
}
