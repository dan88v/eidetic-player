import type {
  IndexedLibrarySnapshot,
  LibraryScanProgress,
} from "../../../../packages/shared/src/library";
import { t } from "../i18n";

export type ToastTone = "error" | "success" | "neutral";

export interface ToastHost {
  readonly element: HTMLElement;
  show(message: string, tone?: ToastTone): void;
  updateLibrary(snapshot: IndexedLibrarySnapshot): void;
  destroy(): void;
}

const TRANSIENT_DURATION_MS = 4_500;
const TERMINAL_DURATION_MS = 2_500;
export const LIBRARY_TOAST_UPDATE_INTERVAL_MS = 250;
export const LIBRARY_SCAN_TOAST_KEY = "library-scan-progress";

function scanIdentity(scan: LibraryScanProgress): string {
  return `${scan.scanId}:${scan.sourceId}:${String(scan.generation)}`;
}

function terminal(status: LibraryScanProgress["status"]): boolean {
  return [
    "completed",
    "cancelled",
    "interrupted",
    "failed",
    "source-unavailable",
  ].includes(status);
}

export type LibraryToastResolution =
  | { readonly kind: "idle" }
  | { readonly kind: "queued"; readonly sourceName: string | null }
  | { readonly kind: "active"; readonly scan: LibraryScanProgress }
  | { readonly kind: "terminal"; readonly scan: LibraryScanProgress };

export function resolveLibraryToast(
  snapshot: IndexedLibrarySnapshot,
  activeIdentity: string,
  visible: boolean,
): LibraryToastResolution {
  const queued =
    snapshot.status.activeScan === null &&
    snapshot.status.queuedSourceIds.length > 0;
  if (queued) {
    const sourceId = snapshot.status.queuedSourceIds[0];
    return {
      kind: "queued",
      sourceName:
        snapshot.sources.find((item) => item.sourceId === sourceId)
          ?.displayName ?? null,
    };
  }
  if (snapshot.status.activeScan)
    return { kind: "active", scan: snapshot.status.activeScan };
  const latest = snapshot.status.latestScan;
  if (
    latest &&
    terminal(latest.status) &&
    visible &&
    (activeIdentity === "queued" || activeIdentity === scanIdentity(latest))
  )
    return { kind: "terminal", scan: latest };
  return { kind: "idle" };
}

function formatScanCounts(scan: LibraryScanProgress): string {
  const parts = [
    `${String(scan.filesProcessed)} / ${String(scan.filesDiscovered)}`,
  ];
  if (scan.filesNew > 0)
    parts.push(
      `${String(scan.filesNew)} ${t("library.new").toLocaleLowerCase()}`,
    );
  if (scan.filesModified > 0)
    parts.push(
      `${String(scan.filesModified)} ${t("library.modified").toLocaleLowerCase()}`,
    );
  if (scan.filesFailed > 0)
    parts.push(
      `${String(scan.filesFailed)} ${t("library.errors").toLocaleLowerCase()}`,
    );
  return parts.join(" · ");
}

export function createToastHost(): ToastHost {
  const host = document.createElement("div");
  host.className = "app-toast-host";
  host.setAttribute("aria-label", t("toast.notifications"));
  const transientToast = document.createElement("div");
  transientToast.className = "app-toast app-toast--transient";
  transientToast.setAttribute("role", "status");
  transientToast.setAttribute("aria-live", "polite");
  const progressToast = document.createElement("section");
  progressToast.className = "app-toast app-toast--progress";
  progressToast.dataset.key = LIBRARY_SCAN_TOAST_KEY;
  progressToast.setAttribute("role", "region");
  progressToast.setAttribute("aria-label", t("library.progress"));
  progressToast.innerHTML = `
    <div class="app-toast__copy">
      <strong class="app-toast__title" aria-live="polite" aria-atomic="true"></strong>
      <span class="app-toast__message"></span>
    </div>
    <progress class="library-progress app-toast__progress" aria-label="${t("library.progress")}"></progress>`;
  host.append(transientToast, progressToast);
  const title = progressToast.querySelector<HTMLElement>(".app-toast__title");
  const message = progressToast.querySelector<HTMLElement>(
    ".app-toast__message",
  );
  const progress = progressToast.querySelector<HTMLProgressElement>(
    ".app-toast__progress",
  );
  if (!title || !message || !progress)
    throw new Error("Toast host is incomplete");

  let transientTimer = 0;
  let terminalTimer = 0;
  let coalesceTimer = 0;
  let lastTransientMessage = "";
  let lastTransientAt = 0;
  let lastLibraryRenderAt = 0;
  let pendingSnapshot: IndexedLibrarySnapshot | null = null;
  let activeIdentity = "";
  let visible = false;
  let lastProgressMax: number | null = null;
  let lastProgressValue: number | null = null;
  let renderCount = 0;

  const hideProgress = (): void => {
    window.clearTimeout(terminalTimer);
    terminalTimer = 0;
    progressToast.classList.remove("app-toast--visible");
    progressToast.removeAttribute("data-tone");
    visible = false;
    activeIdentity = "";
  };

  const renderLibrary = (snapshot: IndexedLibrarySnapshot): void => {
    pendingSnapshot = null;
    lastLibraryRenderAt = performance.now();
    renderCount += 1;
    progressToast.dataset.renderCount = String(renderCount);
    const resolved = resolveLibraryToast(snapshot, activeIdentity, visible);
    if (resolved.kind === "idle") return;
    window.clearTimeout(terminalTimer);
    terminalTimer = 0;
    progressToast.dataset.tone = "neutral";

    if (resolved.kind === "queued") {
      activeIdentity = "queued";
      title.textContent = t("library.toast.preparing");
      message.textContent = resolved.sourceName ?? t("library.status.queued");
      progress.removeAttribute("value");
      progress.removeAttribute("max");
      progress.setAttribute(
        "aria-valuetext",
        t("library.progressIndeterminate"),
      );
    } else {
      const scan = resolved.scan;
      if (resolved.kind === "active") activeIdentity = scanIdentity(scan);
      const isTerminal = resolved.kind === "terminal";
      title.textContent = t(
        scan.status === "scanning"
          ? "library.toast.scanning"
          : scan.status === "cancelling"
            ? "library.toast.cancelling"
            : scan.status === "completed"
              ? "library.toast.completed"
              : scan.status === "cancelled"
                ? "library.toast.cancelled"
                : "library.toast.failed",
      );
      message.textContent = isTerminal
        ? scan.status === "failed" ||
          scan.status === "source-unavailable" ||
          scan.status === "interrupted"
          ? `${scan.sourceName} · ${t(`library.status.${scan.status}`)}`
          : formatScanCounts(scan)
        : `${scan.sourceName} · ${formatScanCounts(scan)}`;
      if (scan.status !== "cancelling") {
        if (scan.totalFiles !== null && scan.totalFiles > 0) {
          lastProgressMax = scan.totalFiles;
          lastProgressValue = Math.min(scan.filesProcessed, scan.totalFiles);
          progress.max = lastProgressMax;
          progress.value = lastProgressValue;
          progress.removeAttribute("aria-valuetext");
        } else {
          lastProgressMax = null;
          lastProgressValue = null;
          progress.removeAttribute("value");
          progress.removeAttribute("max");
          progress.setAttribute(
            "aria-valuetext",
            t("library.progressIndeterminate"),
          );
        }
      } else if (lastProgressMax !== null && lastProgressValue !== null) {
        progress.max = lastProgressMax;
        progress.value = lastProgressValue;
      } else if (scan.totalFiles !== null && scan.totalFiles > 0) {
        lastProgressMax = scan.totalFiles;
        lastProgressValue = Math.min(scan.filesProcessed, scan.totalFiles);
        progress.max = lastProgressMax;
        progress.value = lastProgressValue;
        progress.removeAttribute("aria-valuetext");
      } else {
        progress.removeAttribute("value");
        progress.removeAttribute("max");
        progress.setAttribute(
          "aria-valuetext",
          t("library.progressIndeterminate"),
        );
      }
      if (isTerminal) {
        const failure = !["completed", "cancelled"].includes(scan.status);
        progressToast.dataset.tone = failure ? "error" : "success";
        if (!failure)
          terminalTimer = window.setTimeout(hideProgress, TERMINAL_DURATION_MS);
      }
    }
    visible = true;
    progressToast.classList.add("app-toast--visible");
  };

  const scheduleLibrary = (snapshot: IndexedLibrarySnapshot): void => {
    const latest = snapshot.status.latestScan;
    const immediate = latest !== null && terminal(latest.status) && visible;
    if (immediate) {
      window.clearTimeout(coalesceTimer);
      coalesceTimer = 0;
      renderLibrary(snapshot);
      return;
    }
    pendingSnapshot = snapshot;
    const elapsed = performance.now() - lastLibraryRenderAt;
    if (!visible || elapsed >= LIBRARY_TOAST_UPDATE_INTERVAL_MS) {
      window.clearTimeout(coalesceTimer);
      coalesceTimer = 0;
      renderLibrary(snapshot);
      return;
    }
    if (coalesceTimer !== 0) return;
    coalesceTimer = window.setTimeout(() => {
      coalesceTimer = 0;
      if (pendingSnapshot) renderLibrary(pendingSnapshot);
    }, LIBRARY_TOAST_UPDATE_INTERVAL_MS - elapsed);
  };

  return {
    element: host,
    show(messageText, tone = "error") {
      const now = performance.now();
      if (messageText === lastTransientMessage && now - lastTransientAt < 800)
        return;
      lastTransientMessage = messageText;
      lastTransientAt = now;
      transientToast.textContent = messageText;
      transientToast.dataset.tone = tone;
      transientToast.classList.add("app-toast--visible");
      window.clearTimeout(transientTimer);
      transientTimer = window.setTimeout(() => {
        transientToast.classList.remove("app-toast--visible");
      }, TRANSIENT_DURATION_MS);
    },
    updateLibrary: scheduleLibrary,
    destroy() {
      window.clearTimeout(transientTimer);
      window.clearTimeout(terminalTimer);
      window.clearTimeout(coalesceTimer);
    },
  };
}
