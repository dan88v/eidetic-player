import { t } from "../i18n";
import { createPlaceholderScreen } from "./placeholder";

export function createQueueScreen(): HTMLElement {
  return createPlaceholderScreen(
    t("screen.queue.title"),
    t("screen.queue.description"),
    "queue",
  );
}
