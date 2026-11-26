export const UI_STYLES = ["normal", "liquid-glass", "soft-glow", "minimal"] as const;

export type UiStyle = (typeof UI_STYLES)[number];

const STORAGE_KEY = "hutaotik-ui-style";

export function loadUiStyle(): UiStyle {
  const stored = localStorage.getItem(STORAGE_KEY);
  return UI_STYLES.find((style) => style === stored) ?? "normal";
}

export function saveUiStyle(style: UiStyle): void {
  document.documentElement.dataset.uiStyle = style;
  localStorage.setItem(STORAGE_KEY, style);
}
