export const SCREEN_TRANSITIONS = [
  "fade",
  "slide",
  "zoom",
  "bounce",
  "elastic",
  "flip",
  "blur",
  "none",
] as const;

export type ScreenTransition = (typeof SCREEN_TRANSITIONS)[number];

const STORAGE_KEY = "hutaotik-screen-transition";
const BOUNCY_DEFAULT_MIGRATION_KEY = "hutaotik-bouncy-screen-v1";
const CHANGE_EVENT = "hutaotik:screen-transition-changed";

export function loadScreenTransition(): ScreenTransition {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!localStorage.getItem(BOUNCY_DEFAULT_MIGRATION_KEY)) {
      localStorage.setItem(BOUNCY_DEFAULT_MIGRATION_KEY, "1");
      if (!stored || stored === "fade") {
        localStorage.setItem(STORAGE_KEY, "bounce");
        return "bounce";
      }
    }
    const transition = SCREEN_TRANSITIONS.find((candidate) => candidate === stored);
    if (transition) return transition;
    if (stored) console.warn("Ignoring an unsupported saved screen transition.", stored);
    return "bounce";
  } catch (error) {
    console.error("Could not load the saved screen transition.", error);
    return "bounce";
  }
}

export function saveScreenTransition(transition: ScreenTransition): void {
  localStorage.setItem(BOUNCY_DEFAULT_MIGRATION_KEY, "1");
  localStorage.setItem(STORAGE_KEY, transition);
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent<ScreenTransition>(CHANGE_EVENT, { detail: transition }));
  }
}

export function onScreenTransitionChanged(
  listener: (transition: ScreenTransition) => void,
): () => void {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") {
    return () => {};
  }
  const handler = (event: Event) => {
    if (event instanceof CustomEvent && SCREEN_TRANSITIONS.includes(event.detail)) {
      listener(event.detail);
    } else {
      listener(loadScreenTransition());
    }
  };
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}
