export interface FoldersSessionState {
  sourceId: string | null;
  relativePath: string;
  selectedEntryId: string | null;
}

export interface FoldersBrowserSession {
  getLocation(): Readonly<FoldersSessionState>;
  openSource(sourceId: string): void;
  setLocation(sourceId: string, relativePath: string): void;
  showSources(): void;
  setSelected(entryId: string | null): void;
  saveScroll(sourceId: string, relativePath: string, scrollTop: number): void;
  scrollFor(sourceId: string, relativePath: string): number;
  removeSource(sourceId: string): void;
}

const state: FoldersSessionState = {
  sourceId: null,
  relativePath: "",
  selectedEntryId: null,
};

const scrollPositions = new Map<string, number>();

function key(sourceId: string, relativePath: string): string {
  return `${sourceId}\0${relativePath}`;
}

export const foldersSession: FoldersBrowserSession = {
  getLocation(): Readonly<FoldersSessionState> {
    return { ...state };
  },
  openSource(sourceId: string): void {
    state.sourceId = sourceId;
    state.relativePath = "";
    state.selectedEntryId = null;
  },
  setLocation(sourceId: string, relativePath: string): void {
    state.sourceId = sourceId;
    state.relativePath = relativePath;
  },
  showSources(): void {
    state.sourceId = null;
    state.relativePath = "";
    state.selectedEntryId = null;
  },
  setSelected(entryId: string | null): void {
    state.selectedEntryId = entryId;
  },
  saveScroll(sourceId: string, relativePath: string, scrollTop: number): void {
    scrollPositions.set(key(sourceId, relativePath), scrollTop);
  },
  scrollFor(sourceId: string, relativePath: string): number {
    return scrollPositions.get(key(sourceId, relativePath)) ?? 0;
  },
  removeSource(sourceId: string): void {
    if (state.sourceId === sourceId) this.showSources();
    for (const storedKey of scrollPositions.keys())
      if (storedKey.startsWith(`${sourceId}\0`))
        scrollPositions.delete(storedKey);
  },
};

function createUsbSession(): FoldersBrowserSession {
  const locations = new Map<string, string>();
  const selected = new Map<string, string | null>();
  const scroll = new Map<string, number>();
  let activeDeviceId: string | null = null;
  return {
    getLocation() {
      return {
        sourceId: activeDeviceId,
        relativePath: activeDeviceId
          ? (locations.get(activeDeviceId) ?? "")
          : "",
        selectedEntryId: activeDeviceId
          ? (selected.get(activeDeviceId) ?? null)
          : null,
      };
    },
    openSource(deviceId) {
      activeDeviceId = deviceId;
      if (!locations.has(deviceId)) locations.set(deviceId, "");
    },
    setLocation(deviceId, relativePath) {
      activeDeviceId = deviceId;
      locations.set(deviceId, relativePath);
    },
    showSources() {
      activeDeviceId = null;
    },
    setSelected(entryId) {
      if (activeDeviceId) selected.set(activeDeviceId, entryId);
    },
    saveScroll(deviceId, relativePath, scrollTop) {
      scroll.set(key(deviceId, relativePath), scrollTop);
    },
    scrollFor(deviceId, relativePath) {
      return scroll.get(key(deviceId, relativePath)) ?? 0;
    },
    removeSource(deviceId) {
      if (activeDeviceId === deviceId) activeDeviceId = null;
      locations.delete(deviceId);
      selected.delete(deviceId);
      for (const storedKey of scroll.keys())
        if (storedKey.startsWith(`${deviceId}\0`)) scroll.delete(storedKey);
    },
  };
}

export const usbStorageSession = createUsbSession();
