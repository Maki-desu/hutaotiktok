export const UI_STYLES = ["normal", "liquid-glass", "soft-glow", "minimal"] as const;

export type UiStyle = (typeof UI_STYLES)[number];

const STORAGE_KEY = "hutaotik-ui-style";

export function loadUiStyle(): UiStyle {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return UI_STYLES.find((style) => style === stored) ?? "normal";
  } catch {
    return "normal";
  }
}

export function saveUiStyle(style: UiStyle): void {
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.dataset.uiStyle = style;
  }
  try {
    localStorage.setItem(STORAGE_KEY, style);
  } catch {
    /* ignore storage write errors */
  }
}
