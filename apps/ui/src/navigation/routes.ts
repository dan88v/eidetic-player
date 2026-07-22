import type { IconName } from "../components/icons";
import type { TranslationKey } from "../i18n/en";
import type { ScreenId } from "../state/types";

export interface NavigationItem {
  readonly id: ScreenId;
  readonly titleKey: TranslationKey;
  readonly descriptionKey: TranslationKey;
  readonly icon: IconName;
  readonly screenGroup: "main" | "settings";
}

export const navigationItems: readonly NavigationItem[] = [
  {
    id: "nowPlaying",
    titleKey: "screen.nowPlaying.title",
    descriptionKey: "screen.nowPlaying.description",
    icon: "nowPlaying",
    screenGroup: "main",
  },
  {
    id: "library",
    titleKey: "screen.library.title",
    descriptionKey: "screen.library.description",
    icon: "library",
    screenGroup: "main",
  },
  {
    id: "favorites",
    titleKey: "screen.favorites.title",
    descriptionKey: "screen.favorites.description",
    icon: "heart",
    screenGroup: "main",
  },
  {
    id: "recentlyPlayed",
    titleKey: "screen.recentlyPlayed.title",
    descriptionKey: "screen.recentlyPlayed.description",
    icon: "history",
    screenGroup: "main",
  },
  {
    id: "folders",
    titleKey: "screen.folders.title",
    descriptionKey: "screen.folders.description",
    icon: "folder",
    screenGroup: "main",
  },
  {
    id: "sources",
    titleKey: "screen.sources.title",
    descriptionKey: "screen.sources.description",
    icon: "sources",
    screenGroup: "main",
  },
  {
    id: "settings",
    titleKey: "screen.settings.title",
    descriptionKey: "screen.settings.description",
    icon: "settings",
    screenGroup: "settings",
  },
] as const;

export function getNavigationItem(screen: ScreenId): NavigationItem {
  const item = navigationItems.find(({ id }) => id === screen);
  if (!item) throw new Error(`Unknown screen: ${screen}`);
  return item;
}

export function isSettingsRoute(screen: ScreenId): boolean {
  return getNavigationItem(screen).screenGroup === "settings";
}
