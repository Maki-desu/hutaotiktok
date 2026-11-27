export const MIN_DISPLAY_SCALE = 65;
export const MAX_DISPLAY_SCALE = 110;
export const DEFAULT_DISPLAY_SCALE = 100;
export const DISPLAY_SCALE_STEP = 5;

export const DISPLAY_SCALE_STORAGE_KEY = "hutaotik-display-scale";
export const DISPLAY_SCALE_CHANGED_EVENT = "hutaotik:display-scale-changed";

export function clampDisplayScale(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_DISPLAY_SCALE;
  }
  const stepped = Math.round(value / DISPLAY_SCALE_STEP) * DISPLAY_SCALE_STEP;
  return Math.max(MIN_DISPLAY_SCALE, Math.min(MAX_DISPLAY_SCALE, stepped));
}

export function describeDisplayScale(scale: number): string {
  const clamped = clampDisplayScale(scale);
  if (clamped <= 70) return "Extra Compact";
  if (clamped <= 80) return "Compact";
  if (clamped <= 95) return "Smaller";
  if (clamped === 100) return "Default";
  return "Larger";
}

export function loadDisplayScale(): number {
  try {
    const raw = localStorage.getItem(DISPLAY_SCALE_STORAGE_KEY);
    if (!raw) return DEFAULT_DISPLAY_SCALE;
    const parsed = Number.parseFloat(raw);
    return clampDisplayScale(parsed);
  } catch {
    return DEFAULT_DISPLAY_SCALE;
  }
}

export function applyDisplayScale(scale: number): number {
  const clamped = clampDisplayScale(scale);
  if (typeof document !== "undefined" && document.documentElement) {
    const root = document.documentElement;
    if (clamped === DEFAULT_DISPLAY_SCALE) {
      root.style.removeProperty("font-size");
    } else {
      root.style.fontSize = `${clamped}%`;
    }
    root.style.setProperty("--display-scale", (clamped / 100).toFixed(2));
    root.dataset.displayScale = String(clamped);
  }
  return clamped;
}

export function saveDisplayScale(scale: number): number {
  const clamped = applyDisplayScale(scale);
  try {
    localStorage.setItem(DISPLAY_SCALE_STORAGE_KEY, String(clamped));
  } catch {
    /* ignore storage write errors */
  }
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    try {
      window.dispatchEvent(new CustomEvent<number>(DISPLAY_SCALE_CHANGED_EVENT, { detail: clamped }));
    } catch {
      window.dispatchEvent(new Event(DISPLAY_SCALE_CHANGED_EVENT));
    }
  }
  return clamped;
}

export function onDisplayScaleChanged(listener: (scale: number) => void): () => void {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") {
    return () => {};
  }
  const handler = (event: Event) => {
    if (event instanceof CustomEvent && typeof event.detail === "number") {
      listener(clampDisplayScale(event.detail));
    } else {
      listener(loadDisplayScale());
    }
  };
  window.addEventListener(DISPLAY_SCALE_CHANGED_EVENT, handler);
  return () => window.removeEventListener(DISPLAY_SCALE_CHANGED_EVENT, handler);
}
