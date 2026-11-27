const STORAGE_KEY = "hutaotik-bounce-animation";
const CHANGE_EVENT = "hutaotik:bounce-animation-changed";

export function loadBounceAnimationEnabled(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored !== "off";
  } catch (error) {
    console.error("Could not load the saved bounce animation preference.", error);
    return true;
  }
}

export function applyBounceAnimation(enabled: boolean): void {
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.dataset.bounceAnimation = enabled ? "on" : "off";
  }
}

export function saveBounceAnimationEnabled(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
  applyBounceAnimation(enabled);
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent<boolean>(CHANGE_EVENT, { detail: enabled }));
  }
}

export function onBounceAnimationChanged(listener: (enabled: boolean) => void): () => void {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") {
    return () => {};
  }
  const handler = (event: Event) => {
    if (event instanceof CustomEvent && typeof event.detail === "boolean") {
      listener(event.detail);
    } else {
      listener(loadBounceAnimationEnabled());
    }
  };
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}
