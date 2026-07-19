interface FoldersSessionState {
  sourceId: string | null;
  relativePath: string;
  selectedEntryId: string | null;
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

export const foldersSession = {
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
