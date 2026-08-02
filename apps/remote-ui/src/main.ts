import type {
  RemoteBootstrap,
  RemoteEventEnvelope,
  RemotePlayerProgress,
  RemotePlayerState,
} from "../../../packages/shared/src/remote-access";
import type {
  CurrentPlaybackView,
  ExplicitQueueItem,
  PlaybackContextQueueDecision,
} from "../../../packages/shared/src/player";
import {
  playbackSourceDisplayName,
  type PlaybackSourceSnapshot,
} from "../../../packages/shared/src/playback-source";
import { createClientSessionId } from "./client-session-id";
import { LatestRequestCoordinator } from "./latest-request-coordinator";
import {
  formatRemoteTrackCount,
  remotePlaybackContextKindLabel,
  remotePlayerDisplay,
  remotePlayerPresentationChanged,
  RemotePlayerStateCoordinator,
  remotePlayerTrackKey,
  remoteQueuePresentationChanged,
  remoteSameArtistSummary,
} from "./player-presentation";
import "./styles.css";

type Destination = "player" | "library" | "browse" | "queue";
type LibraryView =
  | "albums"
  | "artists"
  | "tracks"
  | "search"
  | "favorites"
  | "recently"
  | "most-played"
  | "playlists";

interface ApiEnvelope<T> {
  readonly ok: boolean;
  readonly data: T;
  readonly error?: { readonly message?: string };
}

interface ApiRequestPolicy {
  readonly deferUnauthorized?: boolean;
}

class RemoteApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "RemoteApiError";
  }
}

interface BrowseEntry {
  readonly id: string;
  readonly name: string;
  readonly type: "directory" | "file";
  readonly relativePath: string;
  readonly current?: boolean;
}

interface BrowseSnapshot {
  readonly source: { readonly id: string; readonly displayName: string };
  readonly current: { readonly relativePath: string };
  readonly parent: { readonly relativePath: string } | null;
  readonly entries: readonly BrowseEntry[];
}

const rootElement = document.querySelector<HTMLElement>("#remote-root");
if (!rootElement) throw new Error("Remote root is missing.");
const root: HTMLElement = rootElement;

let bootstrap: RemoteBootstrap | null = null;
let csrfToken = "";
let destination: Destination = "player";
let libraryView: LibraryView = "albums";
let stream: EventSource | null = null;
let streamRetry: number | null = null;
let retryDelay = 1_000;
let connection: "connected" | "reconnecting" | "offline" = "offline";
let clientSessionId = createClientSessionId();
let clientIntentId = 0;
let destroyed = false;
let browseSourceId = "";
let browseRelativePath = "";
let libraryAbort: AbortController | null = null;
let libraryPageRecords: Record<string, unknown>[] = [];
let librarySearchQuery = "";
let activeSeek: {
  readonly input: HTMLInputElement;
  readonly trackKey: string | null;
} | null = null;
const playerStateCoordinator = new RemotePlayerStateCoordinator();
const bootstrapRequests = new LatestRequestCoordinator();
let remoteEventRevision = 0;

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
}

function button(
  label: string,
  className: string,
  action: () => void,
): HTMLButtonElement {
  const result = element("button", className, label);
  result.type = "button";
  result.addEventListener("click", action);
  return result;
}

type RemoteIconName =
  "next" | "pause" | "play" | "previous" | "repeat" | "shuffle";

const remoteIconPaths: Record<RemoteIconName, string> = {
  next: '<path d="m8 5 8 7-8 7V5Z"/><path d="M18 5v14"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="m8 5 11 7-11 7V5Z"/>',
  previous: '<path d="m16 5-8 7 8 7V5Z"/><path d="M6 5v14"/>',
  repeat:
    '<path d="m17 2 4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
  shuffle:
    '<path d="M4 7h3c4 0 6 10 10 10h3"/><path d="m17 14 3 3-3 3M4 17h3c1.5 0 2.7-1.4 3.8-3M15 7c.7-.6 1.3-1 2.2-1H20"/><path d="m17 3 3 3-3 3"/>',
};

function setRemoteIcon(target: HTMLElement, name: RemoteIconName): void {
  target.innerHTML = `<svg class="remote-control-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${remoteIconPaths[name]}</svg>`;
}

async function api<T>(
  path: string,
  init: RequestInit = {},
  policy: ApiRequestPolicy = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  if (csrfToken && init.method && init.method !== "GET")
    headers.set("x-eidetic-csrf", csrfToken);
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers,
  });
  const envelope = (await response.json()) as ApiEnvelope<T>;
  if (response.status === 401) {
    if (!policy.deferUnauthorized) resetAuthentication();
    throw new RemoteApiError(401, "Pair this browser again.");
  }
  if (!response.ok || !envelope.ok)
    throw new RemoteApiError(
      response.status,
      envelope.error?.message ?? "The remote request failed.",
    );
  return envelope.data;
}

function commandBody(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    ...extra,
    clientSessionId,
    intentId: ++clientIntentId,
    requestedAtMilliseconds: performance.now(),
  });
}

function setConnection(next: typeof connection): void {
  connection = next;
  document
    .querySelector(".remote-connection")
    ?.setAttribute("data-state", next);
  const label = document.querySelector(".remote-connection__label");
  if (label)
    label.textContent =
      next === "connected"
        ? "Connected"
        : next === "reconnecting"
          ? "Reconnecting"
          : "Offline";
  document
    .querySelectorAll<HTMLButtonElement>("[data-requires-connection]")
    .forEach((control) => {
      control.disabled =
        next !== "connected" || control.dataset.commandAvailable === "false";
    });
}

function showMessage(message: string): void {
  const existing = document.querySelector(".remote-toast");
  existing?.remove();
  const toast = element("div", "remote-toast", message);
  toast.setAttribute("role", "status");
  root.append(toast);
  window.setTimeout(() => {
    toast.remove();
  }, 3_500);
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  return `${String(Math.floor(whole / 60))}:${String(whole % 60).padStart(2, "0")}`;
}

function metadataTitle(state: RemotePlayerState): string {
  if (bootstrap?.playbackSource.activeSource !== "local")
    return bootstrap?.playbackSource.metadata?.title ?? "External playback";
  return remotePlayerDisplay(state).title;
}

function artworkFor(state: RemotePlayerState): string | null {
  const source = bootstrap?.playbackSource;
  if (source && source.activeSource !== "local") {
    const id = source.artwork?.id;
    return id ? `/api/artwork/external/${encodeURIComponent(id)}` : null;
  }
  const id = remotePlayerDisplay(state).artwork?.id;
  return id ? `/api/artwork/player/${encodeURIComponent(id)}` : null;
}

function currentDeviceId(): string | null {
  return bootstrap?.device.id ?? null;
}

async function runCommand(path: string, body = {}): Promise<void> {
  if (connection !== "connected" || !bootstrap) return;
  const requestDeviceId = bootstrap.device.id;
  const checkpoint = playerStateCoordinator.beginHttpRequest();
  try {
    const player = await api<RemotePlayerState>(path, {
      method: "POST",
      body: commandBody(body),
    });
    if (currentDeviceId() !== requestDeviceId) return;
    const accepted = playerStateCoordinator.acceptHttp(player, checkpoint);
    if (accepted) receivePlayerState(accepted);
  } catch (error) {
    showMessage(error instanceof Error ? error.message : "Command failed.");
  }
}

async function runAction(path: string, body = {}): Promise<void> {
  if (connection !== "connected") return;
  try {
    await api(path, {
      method: "POST",
      body: JSON.stringify(body),
    });
  } catch (error) {
    showMessage(error instanceof Error ? error.message : "Action failed.");
  }
}

function resetAuthentication(): void {
  closeStream();
  bootstrapRequests.invalidate();
  bootstrap = null;
  csrfToken = "";
  renderPairing();
}

function renderStartup(): void {
  root.className = "remote-pairing-root";
  const page = element("main", "remote-pairing");
  const brand = element("div", "remote-brand");
  brand.append(
    element("span", "remote-brand__mark", "E"),
    element("div", "", "Eidetic Player"),
  );
  page.append(
    brand,
    element("h1", "", "Remote control"),
    element("p", "remote-muted", "Connecting to Eidetic Player…"),
  );
  root.replaceChildren(page);
}

function renderPairing(): void {
  root.className = "remote-pairing-root";
  const page = element("main", "remote-pairing");
  const brand = element("div", "remote-brand");
  brand.append(
    element("span", "remote-brand__mark", "E"),
    element("div", "", "Eidetic Player"),
  );
  const title = element("h1", "", "Pair this device");
  const description = element(
    "p",
    "remote-muted",
    "On the player, open Settings → Network → Remote access and choose Pair new device.",
  );
  const form = element("form", "remote-pairing__form");
  const codeLabel = element("label", "remote-field");
  codeLabel.append(element("span", "", "Six-digit code"));
  const code = element("input");
  code.type = "text";
  code.inputMode = "numeric";
  code.autocomplete = "one-time-code";
  code.pattern = "[0-9 ]{6,7}";
  code.maxLength = 7;
  code.required = true;
  code.placeholder = "123 456";
  code.setAttribute("aria-label", "Six-digit pairing code");
  code.addEventListener("input", () => {
    const digits = code.value.replaceAll(/\D/gu, "").slice(0, 6);
    code.value =
      digits.length > 3 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits;
  });
  codeLabel.append(code);
  const nameLabel = element("label", "remote-field");
  nameLabel.append(element("span", "", "Device name"));
  const name = element("input");
  name.type = "text";
  name.autocomplete = "name";
  name.maxLength = 40;
  name.required = true;
  name.placeholder = "My phone";
  nameLabel.append(name);
  const submit = element("button", "remote-primary", "Pair device");
  submit.type = "submit";
  const status = element("p", "remote-form-status");
  status.setAttribute("role", "alert");
  form.append(codeLabel, nameLabel, submit, status);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit.disabled = true;
    status.textContent = "";
    void api<{ csrfToken: string }>("/api/pair", {
      method: "POST",
      body: JSON.stringify({
        code: code.value,
        deviceName: name.value,
      }),
    })
      .then((result) => {
        csrfToken = result.csrfToken;
        return loadBootstrap();
      })
      .catch((error: unknown) => {
        submit.disabled = false;
        status.textContent =
          error instanceof Error ? error.message : "Pairing failed.";
      });
  });
  const warning = element(
    "p",
    "remote-security-note",
    "Trusted local networks only. Traffic is not encrypted.",
  );
  page.append(brand, title, description, form, warning);
  root.replaceChildren(page);
  queueMicrotask(() => {
    code.focus();
  });
}

async function loadBootstrap(): Promise<void> {
  if (destroyed) return;
  await bootstrapRequests.run(
    () =>
      api<RemoteBootstrap>("/api/bootstrap", {}, { deferUnauthorized: true }),
    {
      success: (next) => {
        const currentBootstrap = bootstrap;
        const previousBuild = currentBootstrap?.buildId;
        const playerSessionChanged =
          currentBootstrap !== null &&
          next.player.playerSessionId !==
            currentBootstrap.player.playerSessionId;
        const stalePlayerSnapshot =
          currentBootstrap !== null &&
          !playerSessionChanged &&
          next.eventRevision < remoteEventRevision;
        bootstrap = stalePlayerSnapshot
          ? {
              ...next,
              player: currentBootstrap.player,
              playbackSource: currentBootstrap.playbackSource,
              audioOutput: currentBootstrap.audioOutput,
            }
          : next;
        if (stalePlayerSnapshot) {
          playerStateCoordinator.reset(bootstrap.player, remoteEventRevision);
        } else {
          playerStateCoordinator.reset(next.player, next.eventRevision);
          remoteEventRevision = next.eventRevision;
        }
        csrfToken = next.csrfToken;
        clientSessionId = createClientSessionId();
        clientIntentId = 0;
        renderShell();
        setConnection("connected");
        openStream();
        if (previousBuild && previousBuild !== next.buildId)
          window.location.reload();
      },
      failure: (error) => {
        if (error instanceof RemoteApiError && error.status === 401) {
          resetAuthentication();
          return;
        }
        if (!bootstrap) renderPairing();
        else scheduleReconnect();
      },
    },
  );
}

function renderShell(): void {
  if (!bootstrap) return;
  root.className = "remote-shell-root";
  const shell = element("div", "remote-shell");
  const header = element("header", "remote-header");
  const brand = element("div", "remote-header__brand", "Eidetic Player");
  const connectionElement = element("div", "remote-connection");
  connectionElement.append(
    element("span", "remote-connection__dot"),
    element("span", "remote-connection__label", "Connected"),
  );
  const wake = button("Wake display", "remote-header__action", () => {
    void runAction("/api/display/wake");
  });
  wake.dataset.requiresConnection = "";
  wake.hidden = !bootstrap.capabilities.wakeDisplay;
  header.append(brand, connectionElement, wake);
  const content = element("main", "remote-content");
  content.id = "remote-content";
  const mini = createMiniPlayer();
  const nav = element("nav", "remote-bottom-nav");
  nav.setAttribute("aria-label", "Main navigation");
  const destinations: readonly [Destination, string, string][] = [
    ["player", "▶", "Player"],
    ["library", "▤", "Library"],
    ["browse", "⌕", "Browse"],
    ["queue", "≡", "Queue"],
  ];
  for (const [id, icon, label] of destinations) {
    const control = button("", "remote-nav-item", () => {
      destination = id;
      renderCurrentSurface();
      updateNavigation();
    });
    control.dataset.destination = id;
    control.setAttribute("aria-label", label);
    control.append(
      element("span", "remote-nav-item__icon", icon),
      element("span", "", label),
    );
    if (id === "queue") {
      const badge = element("span", "remote-nav-item__badge");
      badge.dataset.explicitQueueCount = "";
      badge.hidden = true;
      control.append(badge);
    }
    nav.append(control);
  }
  shell.append(header, content, mini, nav);
  root.replaceChildren(shell);
  updateNavigation();
  renderCurrentSurface();
}

function updateNavigation(): void {
  const explicitCount = bootstrap?.player.explicitQueue.length ?? 0;
  document
    .querySelectorAll<HTMLButtonElement>("[data-destination]")
    .forEach((item) => {
      const active = item.dataset.destination === destination;
      item.classList.toggle("remote-nav-item--active", active);
      if (active) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
      if (item.dataset.destination === "queue")
        item.setAttribute(
          "aria-label",
          explicitCount === 0
            ? "Queue"
            : `Queue, ${formatRemoteTrackCount(explicitCount) ?? ""}`,
        );
    });
  const badge = document.querySelector<HTMLElement>(
    "[data-explicit-queue-count]",
  );
  if (badge) {
    badge.hidden = explicitCount === 0;
    badge.textContent = String(explicitCount);
  }
}

function createMiniPlayer(): HTMLElement {
  const mini = element("section", "remote-mini-player");
  mini.dataset.miniPlayer = "";
  updateMiniPlayer(mini);
  return mini;
}

function updateMiniPlayer(target?: HTMLElement): void {
  if (!bootstrap) return;
  const mini =
    target ?? document.querySelector<HTMLElement>("[data-mini-player]");
  if (!mini) return;
  mini.hidden = destination === "player";
  const state = bootstrap.player;
  const source = bootstrap.playbackSource;
  const external = source.activeSource !== "local";
  const display = remotePlayerDisplay(state);
  mini.replaceChildren();
  const open = button("", "remote-mini-player__open", () => {
    destination = "player";
    updateNavigation();
    renderCurrentSurface();
  });
  const art = element("div", "remote-mini-player__art");
  const artUrl = artworkFor(state);
  if (artUrl) {
    const image = element("img");
    image.src = artUrl;
    image.alt = "";
    image.loading = "lazy";
    art.append(image);
  }
  const copy = element("span", "remote-mini-player__copy");
  copy.append(
    element("strong", "", metadataTitle(state)),
    element(
      "small",
      "",
      external
        ? [
            source.metadata?.artist,
            playbackSourceDisplayName(source.activeSource),
          ]
            .filter(Boolean)
            .join(" · ")
        : (display.artist ?? "Eidetic Player"),
    ),
  );
  open.append(art, copy);
  const paused = external ? source.providerState !== "playing" : state.paused;
  const toggle = button(paused ? "▶" : "Ⅱ", "remote-icon-button", () => {
    void runCommand("/api/player/play-pause");
  });
  toggle.setAttribute("aria-label", paused ? "Play" : "Pause");
  toggle.disabled =
    connection !== "connected" ||
    (external &&
      !(paused ? source.capabilities.play : source.capabilities.pause));
  toggle.dataset.commandAvailable = String(
    !external ||
      (paused ? source.capabilities.play : source.capabilities.pause),
  );
  toggle.dataset.requiresConnection = "";
  mini.append(open, toggle);
}

function renderCurrentSurface(): void {
  const content = document.querySelector<HTMLElement>("#remote-content");
  if (!content || !bootstrap) return;
  libraryAbort?.abort();
  libraryAbort = null;
  if (destination !== "player") activeSeek = null;
  root.dataset.destination = destination;
  content.classList.toggle("remote-content--player", destination === "player");
  if (destination === "player") renderPlayer(content);
  else if (destination === "queue") renderQueue(content);
  else if (destination === "browse") renderBrowse(content);
  else renderLibrary(content);
  updateMiniPlayer();
  updateNavigation();
  setConnection(connection);
}

function pageHeading(title: string, description?: string): HTMLElement {
  const heading = element("div", "remote-page-heading");
  heading.append(element("h1", "", title));
  if (description) heading.append(element("p", "remote-muted", description));
  return heading;
}

function renderPlayer(content: HTMLElement): void {
  if (!bootstrap) return;
  const state = bootstrap.player;
  const source = bootstrap.playbackSource;
  const external = source.activeSource !== "local";
  const display = remotePlayerDisplay(state);
  const page = element("section", "remote-player");
  const artwork = element("div", "remote-player__artwork");
  const artUrl = artworkFor(state);
  if (artUrl) {
    const image = element("img");
    image.src = artUrl;
    image.alt = "";
    artwork.append(image);
  } else {
    artwork.append(element("span", "", "E"));
  }
  const metadata = element("div", "remote-player__metadata");
  metadata.append(
    element("h1", "", metadataTitle(state)),
    element(
      "p",
      "",
      external
        ? (source.metadata?.artist ?? "No artist")
        : (display.artist ?? "No artist"),
    ),
    element(
      "small",
      "",
      external
        ? (source.metadata?.album ?? "No album")
        : (display.album ?? "No album"),
    ),
  );
  if (external)
    metadata.prepend(
      element(
        "span",
        "remote-player__source",
        `Now Playing — ${playbackSourceDisplayName(source.activeSource)}`,
      ),
    );
  const timeline = element("div", "remote-timeline");
  const time = element("div", "remote-timeline__time");
  const activePosition = external
    ? (source.positionSeconds ?? 0)
    : state.positionSeconds;
  const activeDuration = external
    ? (source.durationSeconds ?? source.metadata?.durationSeconds ?? 0)
    : state.durationSeconds;
  const elapsed = element("span", "", formatTime(activePosition));
  elapsed.dataset.playerElapsed = "";
  const duration = element("span", "", formatTime(activeDuration));
  duration.dataset.playerDuration = "";
  time.append(elapsed, duration);
  const seek = element("input");
  seek.type = "range";
  seek.min = "0";
  seek.max = String(Math.max(1, activeDuration));
  seek.step = "1";
  seek.value = String(activePosition);
  seek.disabled =
    connection !== "connected" ||
    (external ? !source.capabilities.seek : !display.hasCurrent);
  seek.setAttribute("aria-label", "Playback position");
  seek.dataset.playerSeek = "";
  let ignoreNextChange: string | null = null;
  const commitSeek = (): void => {
    const value = seek.value;
    activeSeek = null;
    ignoreNextChange = value;
    void runCommand("/api/player/seek", {
      positionSeconds: Number(value),
    });
  };
  seek.addEventListener("pointerdown", (event) => {
    activeSeek = { input: seek, trackKey: remotePlayerTrackKey(state) };
    seek.setPointerCapture(event.pointerId);
  });
  seek.addEventListener("input", () => {
    elapsed.textContent = formatTime(Number(seek.value));
  });
  seek.addEventListener("pointerup", () => {
    if (activeSeek?.input === seek) commitSeek();
  });
  seek.addEventListener("pointercancel", () => {
    if (activeSeek?.input === seek) activeSeek = null;
    updatePlayerProgress(bootstrap?.player ?? state);
  });
  seek.addEventListener("change", () => {
    if (ignoreNextChange === seek.value) {
      ignoreNextChange = null;
      return;
    }
    if (activeSeek?.input === seek) activeSeek = null;
    void runCommand("/api/player/seek", {
      positionSeconds: Number(seek.value),
    });
  });
  timeline.append(seek, time);
  const transport = element("div", "remote-transport");
  const previous = button("", "remote-round-button", () => {
    void runCommand("/api/player/previous");
  });
  setRemoteIcon(previous, "previous");
  previous.setAttribute("aria-label", "Previous");
  previous.disabled =
    connection !== "connected" || (external && !source.capabilities.previous);
  previous.dataset.commandAvailable = String(
    !external || source.capabilities.previous,
  );
  previous.dataset.requiresConnection = "";
  const play = button(
    "",
    "remote-round-button remote-round-button--primary",
    () => {
      void runCommand("/api/player/play-pause");
    },
  );
  const activePaused = external
    ? source.providerState !== "playing"
    : state.paused;
  setRemoteIcon(play, activePaused ? "play" : "pause");
  play.setAttribute("aria-label", activePaused ? "Play" : "Pause");
  play.disabled =
    connection !== "connected" ||
    (external &&
      !(activePaused ? source.capabilities.play : source.capabilities.pause));
  play.dataset.commandAvailable = String(
    !external ||
      (activePaused ? source.capabilities.play : source.capabilities.pause),
  );
  play.dataset.requiresConnection = "";
  const next = button("", "remote-round-button", () => {
    void runCommand("/api/player/next");
  });
  setRemoteIcon(next, "next");
  next.setAttribute("aria-label", "Next");
  const canGoNext = external ? source.capabilities.next : state.canGoNext;
  next.dataset.commandAvailable = String(state.canGoNext);
  if (external)
    next.dataset.commandAvailable = String(source.capabilities.next);
  next.disabled = !canGoNext || connection !== "connected";
  next.dataset.requiresConnection = "";
  const shuffle = button(
    "",
    state.shuffleEnabled
      ? "remote-round-button remote-round-button--mode remote-round-button--active"
      : "remote-round-button remote-round-button--mode",
    () => {
      void runCommand("/api/player/shuffle", {
        enabled: !state.shuffleEnabled,
      });
    },
  );
  setRemoteIcon(shuffle, "shuffle");
  shuffle.setAttribute(
    "aria-label",
    `Shuffle ${state.shuffleEnabled ? "on" : "off"}`,
  );
  shuffle.setAttribute("aria-pressed", String(state.shuffleEnabled));
  const repeat = button(
    "",
    state.repeatMode !== "off"
      ? "remote-round-button remote-round-button--mode remote-round-button--active"
      : "remote-round-button remote-round-button--mode",
    () => {
      const mode =
        state.repeatMode === "off"
          ? "all"
          : state.repeatMode === "all"
            ? "one"
            : "off";
      void runCommand("/api/player/repeat", { mode });
    },
  );
  setRemoteIcon(repeat, "repeat");
  repeat.dataset.repeatMode = state.repeatMode;
  repeat.setAttribute("aria-label", `Repeat ${state.repeatMode}`);
  repeat.setAttribute("aria-pressed", String(state.repeatMode !== "off"));
  shuffle.dataset.requiresConnection = "";
  repeat.dataset.requiresConnection = "";
  shuffle.dataset.commandAvailable = String(!external);
  repeat.dataset.commandAvailable = String(!external);
  shuffle.disabled = external || connection !== "connected";
  repeat.disabled = external || connection !== "connected";
  transport.append(shuffle, previous, play, next, repeat);
  let volumeSection: HTMLElement | null = null;
  const variableLevel = external
    ? source.output.levelMode !== "fixed"
    : bootstrap.outputLevelMode !== "fixed";
  const activeMaximumVolume = external
    ? source.output.maximumSoftwareVolume
    : bootstrap.maximumSoftwareVolume;
  const activeVolume = external ? source.volume : state.volume;
  const activeMuted = external ? source.muted : state.muted;
  if (variableLevel) {
    volumeSection = element("section", "remote-volume");
    const label = element("label");
    label.append(
      element("span", "", `Volume ${String(Math.round(activeVolume))}%`),
    );
    const volume = element("input");
    volume.type = "range";
    volume.min = "0";
    volume.max = String(activeMaximumVolume);
    volume.value = String(activeVolume);
    volume.disabled = external && !source.capabilities.volume;
    volume.setAttribute("aria-label", "Volume");
    volume.addEventListener("change", () => {
      void runCommand("/api/player/volume", {
        volume: Number(volume.value),
      });
    });
    label.append(volume);
    const mute = button(
      activeMuted ? "Unmute" : "Mute",
      "remote-secondary",
      () => {
        void runCommand("/api/player/mute", { muted: !activeMuted });
      },
    );
    mute.disabled = external && !source.capabilities.mute;
    volumeSection.append(label, mute);
  } else if (external) {
    volumeSection = element("section", "remote-volume remote-volume--fixed");
    volumeSection.append(
      element("strong", "", "Fixed output · 100%"),
      element(
        "small",
        "",
        "Volume and mute are controlled by the external source or amplifier.",
      ),
    );
  }
  if (!state.mpvAvailable)
    page.append(
      element(
        "p",
        "remote-error-state",
        "Player unavailable. Library and Browse remain available.",
      ),
    );
  const controls = element("div", "remote-player__controls");
  controls.append(timeline, transport);
  if (volumeSection) controls.append(volumeSection);
  if (external) {
    controls.append(
      element("p", "remote-muted", "DSP: Not applied to external sources"),
      element("p", "remote-muted", `Output: ${source.output.description}`),
      button("Resume local playback", "remote-secondary", () => {
        void runCommand("/api/player/resume-local");
      }),
    );
  }
  page.append(artwork, metadata, controls);
  content.replaceChildren(page);
}

function updatePlayerProgress(state: RemotePlayerState): void {
  const seek = document.querySelector<HTMLInputElement>("[data-player-seek]");
  if (!seek) return;
  const source = bootstrap?.playbackSource;
  const external = source?.activeSource !== "local";
  const position = external
    ? (source?.positionSeconds ?? 0)
    : state.positionSeconds;
  const activeDuration = external
    ? (source?.durationSeconds ?? source?.metadata?.durationSeconds ?? 0)
    : state.durationSeconds;
  seek.max = String(Math.max(1, activeDuration));
  seek.disabled =
    connection !== "connected" ||
    (external
      ? !source?.capabilities.seek
      : !remotePlayerDisplay(state).hasCurrent);
  if (activeSeek?.input !== seek) seek.value = String(position);
  const elapsed = document.querySelector<HTMLElement>("[data-player-elapsed]");
  const duration = document.querySelector<HTMLElement>(
    "[data-player-duration]",
  );
  if (elapsed && activeSeek?.input !== seek)
    elapsed.textContent = formatTime(position);
  if (duration) duration.textContent = formatTime(activeDuration);
}

function renderQueue(content: HTMLElement): void {
  if (!bootstrap) return;
  const state = bootstrap.player;
  const page = element("section", "remote-list-page");
  const explicitCount = state.explicitQueue.length;
  const heading = pageHeading(
    "Queue",
    formatRemoteTrackCount(explicitCount) ?? undefined,
  );
  if (bootstrap.playbackSource.activeSource !== "local")
    heading.append(
      element(
        "p",
        "remote-source-banner",
        `Local playback is paused while ${playbackSourceDisplayName(bootstrap.playbackSource.activeSource)} is active.`,
      ),
    );
  if (explicitCount > 0) {
    heading.append(
      button("Clear", "remote-text-button", () => {
        openConfirmation(
          "Clear Queue?",
          "This removes only songs added to Up Next. Now Playing and the playback context continue.",
          () => runCommand("/api/queue/clear", { confirm: true }),
        );
      }),
    );
  }
  const sections = element("div", "remote-queue-sections");

  const nowPlaying = queueSection("Now Playing");
  const nowPlayingList = element("ul", "remote-queue");
  if (state.currentPlayback)
    nowPlayingList.append(currentPlaybackRow(state.currentPlayback));
  else
    nowPlayingList.append(
      element(
        "li",
        "remote-empty remote-empty--compact",
        "Nothing is playing.",
      ),
    );
  nowPlaying.append(nowPlayingList);
  sections.append(nowPlaying);

  const upNext = queueSection("Up Next");
  const explicitList = element("ol", "remote-queue");
  for (const item of state.explicitQueue)
    explicitList.append(explicitQueueRow(item));
  if (explicitCount === 0)
    explicitList.append(
      element(
        "li",
        "remote-empty remote-empty--compact",
        "No songs added to the queue.",
      ),
    );
  upNext.append(explicitList);
  sections.append(upNext);

  if (state.playbackContext) {
    const contextSection = queueSection("Then continues from");
    const context = state.playbackContext;
    const summary = element("article", "remote-queue-summary");
    summary.append(
      element(
        "small",
        "remote-queue-summary__kind",
        remotePlaybackContextKindLabel(context.kind),
      ),
      element("strong", "", context.title),
    );
    if (context.nextItem)
      summary.append(
        element(
          "span",
          "",
          `Next: ${context.nextItem.displayTitle || context.nextItem.filename}`,
        ),
      );
    summary.append(
      element(
        "small",
        "",
        `${formatRemoteTrackCount(context.remainingCount) ?? "0 tracks"} remaining`,
      ),
      button("Remove", "remote-queue-summary__remove", () => {
        void runCommand("/api/context/clear");
      }),
    );
    contextSection.append(summary);
    sections.append(contextSection);
  }

  const continuationSummary = remoteSameArtistSummary(state);
  if (continuationSummary) {
    const continuationSection = queueSection("Same artist");
    continuationSection.append(
      element(
        "p",
        "remote-queue-summary remote-queue-summary--continuation",
        continuationSummary,
      ),
    );
    sections.append(continuationSection);
  }

  page.append(heading, sections);
  content.replaceChildren(page);
}

function queueSection(title: string): HTMLElement {
  const section = element("section", "remote-queue-section");
  section.append(element("h2", "remote-queue-section__heading", title));
  return section;
}

function currentPlaybackRow(current: CurrentPlaybackView): HTMLElement {
  const row = element("li", "remote-queue-row remote-queue-row--current");
  row.dataset.playbackInstanceId = current.playbackInstanceId;
  const artworkId = current.item.artwork?.id;
  const artwork = queueArtwork(
    artworkId
      ? `/api/artwork/player/${encodeURIComponent(artworkId)}`
      : `/api/artwork/queue/${encodeURIComponent(current.playbackInstanceId)}`,
  );
  const copy = element("div", "remote-queue-row__copy");
  copy.append(
    element("strong", "", current.item.displayTitle || current.item.filename),
    element(
      "small",
      "",
      [
        current.item.artist ?? "Unknown artist",
        formatTime(current.item.durationSeconds ?? 0),
      ].join(" · "),
    ),
  );
  row.append(artwork, copy);
  return row;
}

function queueArtwork(url: string): HTMLElement {
  const artwork = element("div", "remote-queue-row__artwork");
  const image = element("img");
  image.src = url;
  image.alt = "";
  image.loading = "lazy";
  artwork.append(image);
  return artwork;
}

function explicitQueueRow(entry: ExplicitQueueItem): HTMLElement {
  const item = entry.item;
  const row = element("li", "remote-queue-row");
  row.dataset.queueId = entry.explicitQueueEntryId;
  const handle = button("↕", "remote-reorder-handle", () => undefined);
  handle.setAttribute("aria-label", `Reorder ${item.displayTitle}`);
  handle.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const delta = event.key === "ArrowUp" ? -1 : 1;
    void reorderQueue(entry, entry.index + delta);
  });
  let pointerStart: number | null = null;
  let dragTarget = entry.index;
  const clearDragFeedback = (): void => {
    row.classList.remove("remote-queue-row--dragging");
    row.style.removeProperty("transform");
    handle.removeAttribute("aria-grabbed");
    row
      .closest(".remote-queue")
      ?.querySelectorAll(".remote-queue-row--drop-target")
      .forEach((candidate) => {
        candidate.classList.remove("remote-queue-row--drop-target");
      });
  };
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    pointerStart = event.clientY;
    dragTarget = entry.index;
    handle.setPointerCapture(event.pointerId);
    handle.setAttribute("aria-grabbed", "true");
    row.classList.add("remote-queue-row--dragging");
  });
  handle.addEventListener("pointermove", (event) => {
    if (
      pointerStart === null ||
      !handle.hasPointerCapture(event.pointerId) ||
      !bootstrap
    )
      return;
    event.preventDefault();
    const delta = event.clientY - pointerStart;
    row.style.transform = `translateY(${String(delta)}px) scale(1.02)`;
    const rowStep = Math.max(56, row.getBoundingClientRect().height + 8);
    dragTarget = Math.max(
      0,
      Math.min(
        bootstrap.player.explicitQueue.length - 1,
        entry.index + Math.round(delta / rowStep),
      ),
    );
    row
      .closest(".remote-queue")
      ?.querySelectorAll(".remote-queue-row--drop-target")
      .forEach((candidate) => {
        candidate.classList.remove("remote-queue-row--drop-target");
      });
    const targetId =
      bootstrap.player.explicitQueue[dragTarget]?.explicitQueueEntryId;
    if (targetId && targetId !== entry.explicitQueueEntryId)
      Array.from(
        row
          .closest(".remote-queue")
          ?.querySelectorAll<HTMLElement>("[data-queue-id]") ?? [],
      )
        .find((candidate) => candidate.dataset.queueId === targetId)
        ?.classList.add("remote-queue-row--drop-target");
  });
  handle.addEventListener("pointerup", (event) => {
    if (pointerStart === null) return;
    if (handle.hasPointerCapture(event.pointerId))
      handle.releasePointerCapture(event.pointerId);
    const target = dragTarget;
    pointerStart = null;
    clearDragFeedback();
    if (target !== entry.index) void reorderQueue(entry, target);
  });
  handle.addEventListener("pointercancel", (event) => {
    if (handle.hasPointerCapture(event.pointerId))
      handle.releasePointerCapture(event.pointerId);
    pointerStart = null;
    clearDragFeedback();
  });
  const artwork = queueArtwork(
    `/api/artwork/queue/${encodeURIComponent(entry.explicitQueueEntryId)}`,
  );
  const play = button("", "remote-queue-row__play", () => {
    void runCommand("/api/queue/play", {
      index: entry.index,
      queueItemId: entry.explicitQueueEntryId,
    });
  });
  play.append(
    element("strong", "", item.displayTitle),
    element(
      "small",
      "",
      [
        item.artist ?? "Unknown artist",
        formatTime(item.durationSeconds ?? 0),
      ].join(" · "),
    ),
  );
  const remove = button("×", "remote-icon-button", () => {
    void runCommand("/api/queue/remove", {
      queueItemId: entry.explicitQueueEntryId,
    });
  });
  remove.setAttribute("aria-label", `Remove ${item.displayTitle}`);
  handle.dataset.requiresConnection = "";
  play.dataset.requiresConnection = "";
  remove.dataset.requiresConnection = "";
  row.append(handle, artwork, play, remove);
  return row;
}

function compatibilityQueue(
  queue: readonly ExplicitQueueItem[],
): RemotePlayerState["queue"] {
  return queue.map((entry) => ({
    id: entry.explicitQueueEntryId,
    index: entry.index,
    filename: entry.item.filename,
    displayTitle: entry.item.displayTitle,
    durationSeconds: entry.item.durationSeconds,
    artwork: entry.item.artwork,
    isCurrent: false,
    available: entry.item.available,
    ...(entry.item.libraryTrackId
      ? { libraryTrackId: entry.item.libraryTrackId }
      : {}),
  }));
}

async function reorderQueue(
  item: ExplicitQueueItem,
  target: number,
): Promise<void> {
  if (!bootstrap) return;
  const bounded = Math.max(
    0,
    Math.min(bootstrap.player.explicitQueue.length - 1, target),
  );
  if (bounded === item.index) return;
  const requestDeviceId = bootstrap.device.id;
  const previousPlayer = bootstrap.player;
  const optimisticQueue = [...previousPlayer.explicitQueue];
  const currentIndex = optimisticQueue.findIndex(
    (candidate) => candidate.explicitQueueEntryId === item.explicitQueueEntryId,
  );
  if (currentIndex < 0) return;
  const [moved] = optimisticQueue.splice(currentIndex, 1);
  if (!moved) return;
  optimisticQueue.splice(bounded, 0, moved);
  const reindexedQueue = optimisticQueue.map((candidate, index) => ({
    ...candidate,
    index,
  }));
  const optimisticPlayer = playerStateCoordinator.replaceLocal({
    ...previousPlayer,
    explicitQueue: reindexedQueue,
    queue: compatibilityQueue(reindexedQueue),
  });
  if (!optimisticPlayer) return;
  bootstrap = { ...bootstrap, player: optimisticPlayer };
  const checkpoint = playerStateCoordinator.beginHttpRequest();
  renderCurrentSurface();
  try {
    const player = await api<RemotePlayerState>("/api/queue/reorder", {
      method: "POST",
      body: commandBody({
        queueItemId: item.explicitQueueEntryId,
        toIndex: bounded,
        expectedQueueRevision: previousPlayer.queueRevision,
      }),
    });
    if (currentDeviceId() !== requestDeviceId) return;
    const accepted = playerStateCoordinator.acceptHttp(player, checkpoint);
    if (accepted) receivePlayerState(accepted);
  } catch (error) {
    if (currentDeviceId() !== requestDeviceId) return;
    const currentPlayer = bootstrap.player;
    if (
      playerStateCoordinator.isLatestHttpRequest(checkpoint) &&
      currentPlayer.playerSessionId === previousPlayer.playerSessionId &&
      currentPlayer.queueRevision === previousPlayer.queueRevision
    ) {
      const rolledBack = playerStateCoordinator.replaceLocal({
        ...currentPlayer,
        explicitQueue: previousPlayer.explicitQueue,
        queue: previousPlayer.queue,
      });
      if (rolledBack) receivePlayerState(rolledBack);
    }
    showMessage(error instanceof Error ? error.message : "Reorder failed.");
  }
}

function renderLibrary(content: HTMLElement): void {
  const page = element("section", "remote-list-page");
  page.append(pageHeading("Library"));
  const tabs = element("div", "remote-library-tabs");
  const views: readonly [LibraryView, string][] = [
    ["albums", "Albums"],
    ["artists", "Artists"],
    ["tracks", "Tracks"],
    ["search", "Search"],
    ["favorites", "Favorites"],
    ["recently", "Recent"],
    ["most-played", "Most played"],
    ["playlists", "Playlists"],
  ];
  for (const [id, label] of views) {
    const control = button(
      label,
      id === libraryView ? "remote-chip remote-chip--active" : "remote-chip",
      () => {
        libraryView = id;
        renderLibrary(content);
      },
    );
    tabs.append(control);
  }
  const body = element("div", "remote-library-body");
  page.append(tabs, body);
  content.replaceChildren(page);
  if (libraryView === "search") renderSearch(body);
  else void loadLibrary(body);
}

function renderSearch(body: HTMLElement): void {
  const form = element("form", "remote-search");
  const input = element("input");
  input.type = "search";
  input.inputMode = "search";
  input.autocomplete = "off";
  input.minLength = 2;
  input.maxLength = 256;
  input.required = true;
  input.placeholder = "Search albums, artists, tracks";
  input.setAttribute("aria-label", "Search Library");
  const submit = element("button", "remote-primary", "Search");
  submit.type = "submit";
  const results = element("div", "remote-results");
  form.append(input, submit);
  body.append(form, results);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!form.checkValidity()) return;
    librarySearchQuery = input.value.trim().replace(/\s+/gu, " ");
    results.replaceChildren(element("p", "remote-loading", "Searching…"));
    libraryAbort?.abort();
    libraryAbort = new AbortController();
    void api<Record<string, unknown>>(
      `/api/library/search?q=${encodeURIComponent(librarySearchQuery)}&limitPerGroup=8`,
      { signal: libraryAbort.signal },
    )
      .then((data) => {
        renderGroupedResults(results, data);
      })
      .catch((error: unknown) => {
        if ((error as Error).name !== "AbortError")
          results.replaceChildren(
            element(
              "p",
              "remote-error-state",
              error instanceof Error ? error.message : "Search failed.",
            ),
          );
      });
  });
}

async function loadLibrary(
  body: HTMLElement,
  cursor: string | null = null,
): Promise<void> {
  if (cursor === null) {
    libraryPageRecords = [];
    body.replaceChildren(element("p", "remote-loading", "Loading…"));
  }
  const path =
    libraryView === "favorites"
      ? "/api/library/favorites/tracks"
      : libraryView === "recently"
        ? "/api/library/recently-played"
        : libraryView === "most-played"
          ? "/api/library/most-played"
          : `/api/library/${libraryView}`;
  libraryAbort = new AbortController();
  try {
    const query = new URLSearchParams({ limit: "48" });
    if (cursor) query.set("cursor", cursor);
    const data = await api<Record<string, unknown>>(
      `${path}?${query.toString()}`,
      {
        signal: libraryAbort.signal,
      },
    );
    libraryPageRecords.push(...recordsFrom(data));
    renderCollection(
      body,
      libraryPageRecords,
      typeof data.nextCursor === "string" ? data.nextCursor : null,
    );
  } catch (error) {
    if ((error as Error).name !== "AbortError")
      body.replaceChildren(
        element(
          "p",
          "remote-error-state",
          error instanceof Error ? error.message : "Library is unavailable.",
        ),
      );
  }
}

function recordsFrom(data: Record<string, unknown>): Record<string, unknown>[] {
  for (const key of [
    "items",
    "albums",
    "artists",
    "tracks",
    "playlists",
    "events",
  ]) {
    const value = data[key];
    if (Array.isArray(value))
      return value.filter((item): item is Record<string, unknown> =>
        Boolean(item && typeof item === "object" && !Array.isArray(item)),
      );
  }
  return [];
}

function recordLabel(record: Record<string, unknown>): string {
  for (const key of ["title", "name", "displayName", "album", "artist"]) {
    if (typeof record[key] === "string" && record[key]) return record[key];
  }
  return "Library item";
}

function recordDetail(record: Record<string, unknown>): string {
  const trackCount = formatRemoteTrackCount(record.trackCount);
  const values = ["artist", "album", "playCount"]
    .map((key) => record[key])
    .filter(
      (value): value is string | number =>
        typeof value === "string" || typeof value === "number",
    );
  if (trackCount) values.push(trackCount);
  return values.join(" · ");
}

function renderCollection(
  body: HTMLElement,
  records: readonly Record<string, unknown>[],
  nextCursor: string | null,
): void {
  const list = element("div", "remote-library-list");
  for (const record of records) {
    const row = element("article", "remote-library-row");
    const copy = element("div");
    copy.append(
      element("strong", "", recordLabel(record)),
      element("small", "", recordDetail(record)),
    );
    const play = button("Play", "remote-secondary", () => {
      void playLibraryRecord(record, false);
    });
    play.dataset.requiresConnection = "";
    const add = button("Add", "remote-secondary", () => {
      void playLibraryRecord(record, true);
    });
    add.dataset.requiresConnection = "";
    const actions = element("div", "remote-row-actions");
    actions.append(play, add);
    row.append(copy, actions);
    list.append(row);
  }
  if (records.length === 0)
    list.append(element("p", "remote-empty", "Nothing here yet."));
  body.replaceChildren(list);
  if (nextCursor) {
    const more = button(
      "Load more",
      "remote-secondary remote-load-more",
      () => {
        more.disabled = true;
        void loadLibrary(body, nextCursor);
      },
    );
    body.append(more);
  }
}

function renderGroupedResults(
  body: HTMLElement,
  data: Record<string, unknown>,
): void {
  body.replaceChildren();
  for (const key of ["artists", "albums", "tracks"]) {
    const group = data[key];
    if (!group || typeof group !== "object" || Array.isArray(group)) continue;
    const section = element("section", "remote-result-group");
    section.append(
      element("h2", "", key.charAt(0).toUpperCase() + key.slice(1)),
    );
    const list = element("div", "remote-library-list");
    for (const record of recordsFrom(group as Record<string, unknown>)) {
      const row = element("article", "remote-library-row");
      const actions = element("div", "remote-row-actions");
      actions.append(
        button("Play", "remote-secondary", () => {
          void playLibraryRecord(record, false);
        }),
        button("Add", "remote-secondary", () => {
          void playLibraryRecord(record, true);
        }),
      );
      row.append(element("strong", "", recordLabel(record)), actions);
      list.append(row);
    }
    section.append(list);
    body.append(section);
  }
  if (!body.firstChild)
    body.append(element("p", "remote-empty", "No results."));
}

async function playLibraryRecord(
  record: Record<string, unknown>,
  append: boolean,
): Promise<void> {
  const id =
    typeof record.id === "string"
      ? record.id
      : typeof record.trackId === "string"
        ? record.trackId
        : "";
  let path = append ? "/api/library/queue" : "/api/library/play";
  let body: Record<string, unknown>;
  if (id.startsWith("track-")) {
    if (append) {
      path = "/api/library/tracks/queue";
      body = { trackId: id };
    } else if (libraryView === "favorites") {
      path = "/api/library/favorites/tracks/play";
      body = { selectedTrackId: id };
    } else if (libraryView === "recently") {
      const selectedHistoryId =
        typeof record.historyId === "string" ? record.historyId : "";
      if (!selectedHistoryId) {
        showMessage("This history item cannot be played.");
        return;
      }
      path = "/api/library/recently-played/play";
      body = { selectedHistoryId };
    } else if (libraryView === "most-played") {
      path = "/api/library/most-played/play";
      body = { selectedTrackId: id };
    } else if (libraryView === "search") {
      path = "/api/library/search/play";
      body = { query: librarySearchQuery, selectedTrackId: id };
    } else if (libraryView === "tracks") {
      body = { context: "tracks", selectedTrackId: id };
    } else body = { context: "track", id };
  } else if (id.startsWith("album-")) body = { context: "album", id };
  else if (id.startsWith("artist-")) body = { context: "artist", id };
  else if (id.startsWith("playlist-")) {
    path = append
      ? "/api/library/playlists/queue"
      : "/api/library/playlists/play";
    body = { playlistId: id };
  } else {
    showMessage("This item cannot be played.");
    return;
  }
  if (!append) {
    const queueDecision = await decideRemoteContextQueue();
    if (!queueDecision) return;
    body = { ...body, ...queueDecision };
  }
  try {
    await api(path, { method: "POST", body: JSON.stringify(body) });
    if (append) showMessage("Added to Queue.");
    else destination = "player";
    await loadBootstrap();
  } catch (error) {
    showMessage(error instanceof Error ? error.message : "Play failed.");
  }
}

function renderBrowse(content: HTMLElement): void {
  if (!bootstrap) return;
  const page = element("section", "remote-list-page");
  page.append(pageHeading("Browse", "Configured sources only"));
  const body = element("div", "remote-browse-body");
  page.append(body);
  content.replaceChildren(page);
  if (!browseSourceId) {
    const list = element("div", "remote-library-list");
    for (const source of bootstrap.sources) {
      const row = button("", "remote-source-row", () => {
        browseSourceId = source.id;
        browseRelativePath = "";
        renderBrowse(content);
      });
      row.append(
        element("strong", "", source.displayName),
        element(
          "small",
          "",
          source.availability === "available" ? "Available" : "Unavailable",
        ),
      );
      row.disabled = source.availability !== "available";
      list.append(row);
    }
    if (bootstrap.sources.length === 0)
      list.append(element("p", "remote-empty", "No configured sources."));
    body.replaceChildren(list);
    return;
  }
  void loadBrowse(body);
}

async function loadBrowse(body: HTMLElement): Promise<void> {
  body.replaceChildren(element("p", "remote-loading", "Loading…"));
  try {
    const data = await api<BrowseSnapshot>(
      `/api/browse/${encodeURIComponent(browseSourceId)}?relativePath=${encodeURIComponent(browseRelativePath)}`,
    );
    const toolbar = element("div", "remote-browse-toolbar");
    toolbar.append(
      button("Back", "remote-text-button", () => {
        if (data.parent) browseRelativePath = data.parent.relativePath;
        else browseSourceId = "";
        renderCurrentSurface();
      }),
      element("strong", "", data.source.displayName),
    );
    const list = element("div", "remote-library-list");
    for (const entry of data.entries) {
      const row = element("article", "remote-library-row");
      const open = button("", "remote-browse-entry", () => {
        if (entry.type === "directory") {
          browseRelativePath = entry.relativePath;
          renderCurrentSurface();
        }
      });
      open.append(
        element("strong", "", entry.name),
        element("small", "", entry.type === "directory" ? "Folder" : "Track"),
      );
      if (entry.type === "file") open.disabled = true;
      const actions = element("div", "remote-row-actions");
      actions.append(
        button("Play", "remote-secondary", () => {
          void browseEntryAction(entry, "play");
        }),
        button("Add", "remote-secondary", () => {
          void browseEntryAction(entry, "queue");
        }),
      );
      row.append(open, actions);
      list.append(row);
    }
    if (data.entries.length === 0)
      list.append(element("p", "remote-empty", "This folder is empty."));
    body.replaceChildren(toolbar, list);
  } catch (error) {
    body.replaceChildren(
      element(
        "p",
        "remote-error-state",
        error instanceof Error ? error.message : "Browse is unavailable.",
      ),
    );
  }
}

async function browseEntryAction(
  entry: BrowseEntry,
  action: "play" | "queue",
): Promise<void> {
  let body: Record<string, unknown> =
    entry.type === "directory"
      ? { relativePath: entry.relativePath }
      : { entryId: entry.id };
  if (action === "play") {
    const queueDecision = await decideRemoteContextQueue();
    if (!queueDecision) return;
    body = { ...body, ...queueDecision };
  }
  try {
    await api(`/api/browse/${encodeURIComponent(browseSourceId)}/${action}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    showMessage(action === "play" ? "Playing selection." : "Added to Queue.");
    await loadBootstrap();
  } catch (error) {
    showMessage(error instanceof Error ? error.message : "Action failed.");
  }
}

function decideRemoteContextQueue(): Promise<PlaybackContextQueueDecision | null> {
  if (!bootstrap) return Promise.resolve(null);
  const revision = bootstrap.player.queueRevision;
  if (bootstrap.player.explicitQueue.length === 0)
    return Promise.resolve({
      explicitQueuePolicy: "preserve",
      expectedQueueRevision: revision,
    });

  return new Promise((resolve) => {
    const returnFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const backdrop = element(
      "div",
      "remote-dialog-backdrop remote-queue-decision-backdrop",
    );
    const dialog = element("section", "remote-dialog remote-queue-decision");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    const heading = element("h2", "", "Up Next isn't empty");
    const copy = element(
      "p",
      "remote-muted",
      "Clear it before playing this selection?",
    );
    let settled = false;
    const finish = (decision: PlaybackContextQueueDecision | null): void => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKeyDown);
      backdrop.remove();
      resolve(decision);
      returnFocus?.focus();
    };
    const close = button("×", "remote-queue-decision__close", () => {
      finish(null);
    });
    close.setAttribute("aria-label", "Close");
    const keep = button("Keep Up Next", "remote-secondary", () => {
      finish({
        explicitQueuePolicy: "preserve",
        expectedQueueRevision: revision,
      });
    });
    const clear = button("Clear & Play", "remote-primary", () => {
      finish({
        explicitQueuePolicy: "clear",
        expectedQueueRevision: revision,
      });
    });
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        finish(null);
        return;
      }
      if (event.key !== "Tab") return;
      event.stopImmediatePropagation();
      const controls = [close, keep, clear];
      const current = controls.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      if (event.shiftKey && current <= 0) {
        event.preventDefault();
        clear.focus();
      } else if (!event.shiftKey && current === controls.length - 1) {
        event.preventDefault();
        close.focus();
      }
    };
    const actions = element("div", "remote-dialog__actions");
    actions.append(keep, clear);
    dialog.append(close, heading, copy, actions);
    backdrop.append(dialog);
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) finish(null);
    });
    document.addEventListener("keydown", onKeyDown);
    root.append(backdrop);
    queueMicrotask(() => {
      keep.focus();
    });
  });
}

function openConfirmation(
  title: string,
  description: string,
  confirm: () => Promise<void>,
): void {
  const returnFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  const backdrop = element("div", "remote-dialog-backdrop");
  const dialog = element("section", "remote-dialog");
  dialog.setAttribute("role", "alertdialog");
  dialog.setAttribute("aria-modal", "true");
  const heading = element("h2", "", title);
  const copy = element("p", "remote-muted", description);
  const actions = element("div", "remote-dialog__actions");
  const close = (): void => {
    document.removeEventListener("keydown", onKeyDown);
    backdrop.remove();
    returnFocus?.focus();
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = [cancel, accept].filter((control) => !control.disabled);
    if (controls.length === 0) return;
    const first = controls[0];
    const last = controls.at(-1);
    if (
      (event.shiftKey && document.activeElement === first) ||
      (!event.shiftKey && document.activeElement === last)
    ) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
    }
  };
  const cancel = button("Cancel", "remote-secondary", close);
  const accept = button("Clear Queue", "remote-primary", () => {
    cancel.disabled = true;
    accept.disabled = true;
    void confirm().finally(() => {
      close();
    });
  });
  actions.append(cancel, accept);
  dialog.append(heading, copy, actions);
  backdrop.append(dialog);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });
  document.addEventListener("keydown", onKeyDown);
  root.append(backdrop);
  queueMicrotask(() => {
    cancel.focus();
  });
}

function openStream(): void {
  closeStream();
  if (document.visibilityState !== "visible" || !bootstrap) return;
  const openedStream = new EventSource("/api/events", {
    withCredentials: true,
  });
  stream = openedStream;
  openedStream.onopen = () => {
    if (stream !== openedStream) return;
    retryDelay = 1_000;
    setConnection("connected");
  };
  openedStream.onerror = () => {
    if (stream !== openedStream) return;
    closeStream();
    scheduleReconnect();
  };
  for (const type of [
    "snapshot",
    "player",
    "player-progress",
    "playback-source",
    "queue",
    "audio-output",
    "source-availability",
    "library-scan",
    "library-invalidated",
    "connection",
  ]) {
    openedStream.addEventListener(type, (event) => {
      if (stream !== openedStream) return;
      const envelope = JSON.parse(
        (event as MessageEvent<string>).data,
      ) as RemoteEventEnvelope;
      receiveEvent(envelope);
    });
  }
}

function receivePlayerState(next: RemotePlayerState): void {
  if (!bootstrap) return;
  const previous = bootstrap.player;
  bootstrap = {
    ...bootstrap,
    player: next,
  };
  if (previous.queueRevision !== next.queueRevision) updateNavigation();
  if (destination === "player") {
    const activeTrackChanged =
      activeSeek !== null && activeSeek.trackKey !== remotePlayerTrackKey(next);
    if (activeTrackChanged) activeSeek = null;
    if (activeSeek) return;
    if (remotePlayerPresentationChanged(previous, next)) renderCurrentSurface();
    else updatePlayerProgress(next);
  } else if (destination === "queue") {
    if (remoteQueuePresentationChanged(previous, next)) renderCurrentSurface();
    else if (remotePlayerPresentationChanged(previous, next))
      updateMiniPlayer();
  } else if (remotePlayerPresentationChanged(previous, next))
    updateMiniPlayer();
}

function receivePlaybackSource(next: PlaybackSourceSnapshot): void {
  if (!bootstrap) return;
  const previous = bootstrap.playbackSource;
  bootstrap = { ...bootstrap, playbackSource: next };
  if (
    previous.revision === next.revision &&
    previous.transitionGeneration === next.transitionGeneration
  )
    return;
  if (destination === "player" || destination === "queue")
    renderCurrentSurface();
  else updateMiniPlayer();
}

function receiveEvent(envelope: RemoteEventEnvelope): void {
  if (!bootstrap) return;
  if (
    !Number.isSafeInteger(envelope.revision) ||
    envelope.revision <= remoteEventRevision
  )
    return;
  remoteEventRevision = envelope.revision;
  if (
    (envelope.type === "player" || envelope.type === "queue") &&
    envelope.data
  ) {
    const accepted = playerStateCoordinator.acceptEvent(
      envelope.data as RemotePlayerState,
      envelope.revision,
    );
    if (accepted) receivePlayerState(accepted);
  } else if (envelope.type === "player-progress" && envelope.data) {
    const accepted = playerStateCoordinator.acceptProgress(
      envelope.data as RemotePlayerProgress,
      envelope.revision,
    );
    if (accepted) receivePlayerState(accepted);
  } else if (envelope.type === "snapshot" && envelope.data) {
    const snapshot = envelope.data as {
      readonly player: RemotePlayerState;
      readonly audioOutput: RemoteBootstrap["audioOutput"];
      readonly playbackSource: PlaybackSourceSnapshot;
    };
    bootstrap = {
      ...bootstrap,
      audioOutput: snapshot.audioOutput,
      playbackSource: snapshot.playbackSource,
    };
    const accepted = playerStateCoordinator.acceptEvent(
      snapshot.player,
      envelope.revision,
    );
    if (accepted) receivePlayerState(accepted);
  } else if (envelope.type === "playback-source" && envelope.data) {
    receivePlaybackSource(envelope.data as PlaybackSourceSnapshot);
  } else if (envelope.type === "audio-output" && envelope.data) {
    bootstrap = {
      ...bootstrap,
      audioOutput: envelope.data as RemoteBootstrap["audioOutput"],
    };
  } else if (
    envelope.type === "library-invalidated" &&
    destination === "library"
  ) {
    renderCurrentSurface();
  }
}

function closeStream(): void {
  stream?.close();
  stream = null;
  if (streamRetry !== null) {
    window.clearTimeout(streamRetry);
    streamRetry = null;
  }
}

function scheduleReconnect(): void {
  if (
    destroyed ||
    document.visibilityState !== "visible" ||
    streamRetry !== null
  )
    return;
  setConnection(navigator.onLine ? "reconnecting" : "offline");
  streamRetry = window.setTimeout(() => {
    streamRetry = null;
    void loadBootstrap();
  }, retryDelay);
  retryDelay = Math.min(30_000, retryDelay * 2);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    closeStream();
    setConnection("offline");
  } else {
    retryDelay = 1_000;
    void loadBootstrap();
  }
});
window.addEventListener("online", scheduleReconnect);
window.addEventListener("offline", () => {
  closeStream();
  setConnection("offline");
});
window.addEventListener("pagehide", () => {
  destroyed = true;
  bootstrapRequests.invalidate();
  closeStream();
  libraryAbort?.abort();
});

renderStartup();
void loadBootstrap();
