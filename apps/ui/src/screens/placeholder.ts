import { icon, type IconName } from "../components/icons";

export function createPlaceholderScreen(
  title: string,
  description: string,
  iconName: IconName,
): HTMLElement {
  const section = document.createElement("section");
  section.className = "screen placeholder-screen";
  section.setAttribute("aria-label", title);
  section.innerHTML = `
    <header class="screen-header">
      <p class="screen-header__description">${description}</p>
    </header>
    <div class="empty-panel" aria-hidden="true">
      <span class="empty-panel__mark">${icon(iconName, "icon icon--large")}</span>
      <span class="empty-panel__line empty-panel__line--long"></span>
      <span class="empty-panel__line"></span>
    </div>
  `;
  return section;
}
