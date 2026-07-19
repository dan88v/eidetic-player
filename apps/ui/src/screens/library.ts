import type {
  IndexedLibrarySnapshot,
  LibraryScanProgress,
} from "../../../../packages/shared/src/library";
import type { LibraryApiClient } from "../api/library-api-client";
import type { ComponentView } from "../components/types";
import { t } from "../i18n";

export interface LibraryScreenOptions {
  readonly api: LibraryApiClient;
  readonly openSources: () => void;
  readonly showToast: (
    message: string,
    tone?: "error" | "success" | "neutral",
  ) => void;
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, "0")}`;
}

function statusLabel(status: LibraryScanProgress["status"]): string {
  switch (status) {
    case "queued":
      return t("library.status.queued");
    case "scanning":
      return t("library.status.scanning");
    case "cancelling":
      return t("library.status.cancelling");
    case "completed":
      return t("library.status.completed");
    case "cancelled":
      return t("library.status.cancelled");
    case "interrupted":
      return t("library.status.interrupted");
    case "failed":
      return t("library.status.failed");
    case "source-unavailable":
      return t("library.status.source-unavailable");
    default:
      return t("library.status.idle");
  }
}

export function createLibraryScreen(
  options: LibraryScreenOptions,
): ComponentView {
  const section = document.createElement("section");
  section.className = "screen library-screen";
  section.setAttribute("aria-label", t("screen.library.title"));
  section.innerHTML = `
    <header class="screen-header library-header">
      <p class="screen-header__description">${t("screen.library.description")}</p>
      <button class="primary-action library-header__action" type="button">${t("library.rescan")}</button>
    </header>
    <div class="library-summary" aria-label="${t("library.summary")}">
      <article class="library-counter"><span>${t("library.tracks")}</span><strong data-library-count="tracks">0</strong></article>
      <article class="library-counter"><span>${t("library.albums")}</span><strong data-library-count="albums">0</strong></article>
      <article class="library-counter"><span>${t("library.artists")}</span><strong data-library-count="artists">0</strong></article>
      <article class="library-counter"><span>${t("library.unavailable")}</span><strong data-library-count="unavailable">0</strong></article>
    </div>
    <section class="library-scan-panel" aria-live="polite">
      <div class="library-scan-panel__heading">
        <strong data-library-field="source">${t("library.idle")}</strong>
        <span data-library-field="status">${t("library.idle")}</span>
      </div>
      <progress class="library-progress" aria-label="${t("library.progress")}"></progress>
      <dl class="library-scan-stats">
        <div><dt>${t("library.found")}</dt><dd data-library-stat="found">0</dd></div>
        <div><dt>${t("library.processed")}</dt><dd data-library-stat="processed">0</dd></div>
        <div><dt>${t("library.unchanged")}</dt><dd data-library-stat="unchanged">0</dd></div>
        <div><dt>${t("library.new")}</dt><dd data-library-stat="new">0</dd></div>
        <div><dt>${t("library.modified")}</dt><dd data-library-stat="modified">0</dd></div>
        <div><dt>${t("library.unavailable")}</dt><dd data-library-stat="unavailable">0</dd></div>
        <div><dt>${t("library.errors")}</dt><dd data-library-stat="errors">0</dd></div>
        <div><dt>${t("library.elapsed")}</dt><dd data-library-stat="elapsed">0:00</dd></div>
      </dl>
    </section>
    <div class="library-empty" hidden>
      <p></p>
      <button type="button">${t("library.openSources")}</button>
    </div>
    <p class="library-last-scan"></p>`;
  const action = section.querySelector<HTMLButtonElement>(
    ".library-header__action",
  );
  const progress =
    section.querySelector<HTMLProgressElement>(".library-progress");
  const source = section.querySelector<HTMLElement>(
    '[data-library-field="source"]',
  );
  const status = section.querySelector<HTMLElement>(
    '[data-library-field="status"]',
  );
  const empty = section.querySelector<HTMLElement>(".library-empty");
  const emptyText = empty?.querySelector("p");
  const openSources = empty?.querySelector("button");
  const lastScan = section.querySelector<HTMLElement>(".library-last-scan");
  if (
    !action ||
    !progress ||
    !source ||
    !status ||
    !empty ||
    !emptyText ||
    !openSources ||
    !lastScan
  )
    throw new Error("Library screen is incomplete");

  const countElements = new Map(
    [...section.querySelectorAll<HTMLElement>("[data-library-count]")].map(
      (element) => [element.dataset.libraryCount ?? "", element],
    ),
  );
  const statElements = new Map(
    [...section.querySelectorAll<HTMLElement>("[data-library-stat]")].map(
      (element) => [element.dataset.libraryStat ?? "", element],
    ),
  );
  let destroyed = false;
  let currentScan: LibraryScanProgress | null = null;
  let requestPending = false;
  let lastSnapshot: IndexedLibrarySnapshot | null = null;

  const setText = (
    elements: Map<string, HTMLElement>,
    key: string,
    value: string | number,
  ): void => {
    const element = elements.get(key);
    const text = String(value);
    if (element && element.textContent !== text) element.textContent = text;
  };

  const render = (snapshot: IndexedLibrarySnapshot): void => {
    if (destroyed) return;
    lastSnapshot = snapshot;
    currentScan = snapshot.status.activeScan;
    const summary = snapshot.summary;
    setText(countElements, "tracks", summary.trackCount);
    setText(countElements, "albums", summary.albumCount);
    setText(countElements, "artists", summary.artistCount);
    setText(countElements, "unavailable", summary.unavailableTrackCount);

    const queuedSourceId = snapshot.status.queuedSourceIds[0];
    const queuedSource = queuedSourceId
      ? snapshot.sources.find((item) => item.sourceId === queuedSourceId)
      : undefined;
    const queued = currentScan === null && queuedSourceId !== undefined;
    const scan = queued ? null : (currentScan ?? snapshot.status.latestScan);
    const scanning =
      scan?.status === "scanning" || scan?.status === "cancelling";
    action.textContent = t(scanning ? "library.cancel" : "library.rescan");
    action.disabled = requestPending || summary.sourceCount === 0 || queued;
    action.dataset.action = scanning ? "cancel" : "rescan";
    source.textContent =
      scan?.sourceName ?? queuedSource?.displayName ?? t("library.idle");
    status.textContent = queued
      ? t("library.status.queued")
      : scan
        ? statusLabel(scan.status)
        : t("library.idle");
    section.dataset.scanStatus = queued ? "queued" : (scan?.status ?? "idle");

    if (scan) {
      setText(statElements, "found", scan.filesDiscovered);
      setText(statElements, "processed", scan.filesProcessed);
      setText(statElements, "unchanged", scan.filesUnchanged);
      setText(statElements, "new", scan.filesNew);
      setText(statElements, "modified", scan.filesModified);
      setText(statElements, "unavailable", scan.filesUnavailable);
      setText(statElements, "errors", scan.filesFailed);
      setText(
        statElements,
        "elapsed",
        formatDuration(scan.elapsedMilliseconds),
      );
      if (scan.totalFiles === null) progress.removeAttribute("value");
      else {
        progress.max = Math.max(1, scan.totalFiles);
        progress.value = Math.min(scan.filesProcessed, progress.max);
      }
    } else if (queued) {
      for (const key of [
        "found",
        "processed",
        "unchanged",
        "new",
        "modified",
        "unavailable",
        "errors",
      ])
        setText(statElements, key, 0);
      setText(statElements, "elapsed", "0:00");
      progress.removeAttribute("value");
    } else {
      progress.max = 1;
      progress.value = summary.trackCount > 0 ? 1 : 0;
    }

    const noSources = summary.sourceCount === 0;
    const zeroCompleted =
      !noSources &&
      summary.trackCount === 0 &&
      snapshot.sources.some((item) => item.firstScanCompleted);
    empty.hidden = !noSources && !zeroCompleted;
    emptyText.textContent = noSources
      ? t("library.noSources")
      : t("library.noAudio");
    openSources.hidden = !noSources;
    lastScan.textContent = summary.lastSuccessfulScan
      ? `${t("library.lastScan")} ${new Intl.DateTimeFormat("en", {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(summary.lastSuccessfulScan))}`
      : "";
  };

  const execute = async (): Promise<void> => {
    if (requestPending) return;
    requestPending = true;
    action.disabled = true;
    try {
      render(
        action.dataset.action === "cancel"
          ? await options.api.cancel(
              currentScan ? { scanId: currentScan.scanId } : {},
            )
          : await options.api.scan(),
      );
    } catch (error) {
      options.showToast(
        error instanceof Error ? error.message : t("library.actionFailed"),
        "error",
      );
    } finally {
      requestPending = false;
      if (lastSnapshot) render(lastSnapshot);
    }
  };
  action.addEventListener("click", () => {
    void execute();
  });
  openSources.addEventListener("click", options.openSources);

  const unsubscribe = options.api.subscribe(render, () => {
    // EventSource reconnects automatically; the last committed state remains.
  });
  void options.api
    .snapshot()
    .then(render)
    .catch(() => {
      if (!destroyed) options.showToast(t("library.unavailableState"), "error");
    });

  return {
    element: section,
    destroy() {
      destroyed = true;
      unsubscribe();
    },
  };
}
