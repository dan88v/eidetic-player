import { t } from "../i18n";
import { createPlaceholderScreen } from "./placeholder";

export function createLibraryScreen(): HTMLElement {
  return createPlaceholderScreen(
    t("screen.library.title"),
    t("screen.library.description"),
    "library",
  );
}
