import { icon, type IconName } from "../components/icons";
import { config } from "../config";

export function createPlaceholderScreen(
  title: string,
  description: string,
  iconName: IconName,
): HTMLElement {
  const section = document.createElement("section");
  section.className = "screen placeholder-screen";
  section.setAttribute("aria-labelledby", "screen-heading");
  section.innerHTML = `
    <header class="screen-header">
      <span class="screen-header__icon">${icon(iconName)}</span>
      <div>
        <p class="screen-header__eyebrow">${config.appName}</p>
        <h1 id="screen-heading">${title}</h1>
        <p class="screen-header__description">${description}</p>
      </div>
    </header>
    <div class="empty-panel" aria-hidden="true">
      <span class="empty-panel__mark">${icon(iconName, "icon icon--large")}</span>
      <span class="empty-panel__line empty-panel__line--long"></span>
      <span class="empty-panel__line"></span>
    </div>
  `;
  return section;
}
