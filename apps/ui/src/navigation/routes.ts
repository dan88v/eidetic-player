import type { IconName } from "../components/icons";
import type { TranslationKey } from "../i18n/en";
import type { ScreenId } from "../state/types";

export interface NavigationItem {
  readonly id: ScreenId;
  readonly titleKey: TranslationKey;
  readonly descriptionKey: TranslationKey;
  readonly icon: IconName;
}

export const navigationItems: readonly NavigationItem[] = [
  {
    id: "nowPlaying",
    titleKey: "screen.nowPlaying.title",
    descriptionKey: "screen.nowPlaying.description",
    icon: "nowPlaying",
  },
  {
    id: "folders",
    titleKey: "screen.folders.title",
    descriptionKey: "screen.folders.description",
    icon: "folder",
  },
  {
    id: "library",
    titleKey: "screen.library.title",
    descriptionKey: "screen.library.description",
    icon: "library",
  },
  {
    id: "sources",
    titleKey: "screen.sources.title",
    descriptionKey: "screen.sources.description",
    icon: "sources",
  },
  {
    id: "queue",
    titleKey: "screen.queue.title",
    descriptionKey: "screen.queue.description",
    icon: "queue",
  },
  {
    id: "settings",
    titleKey: "screen.settings.title",
    descriptionKey: "screen.settings.description",
    icon: "settings",
  },
] as const;

export function getNavigationItem(screen: ScreenId): NavigationItem {
  const item = navigationItems.find(({ id }) => id === screen);
  if (!item) throw new Error(`Unknown screen: ${screen}`);
  return item;
}
