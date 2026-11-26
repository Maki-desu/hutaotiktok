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

export function loadScreenTransition(): ScreenTransition {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const transition = SCREEN_TRANSITIONS.find((candidate) => candidate === stored);
    if (transition) return transition;
    if (stored) console.warn("Ignoring an unsupported saved screen transition.", stored);
    return "fade";
  } catch (error) {
    console.error("Could not load the saved screen transition.", error);
    return "fade";
  }
}

export function saveScreenTransition(transition: ScreenTransition): void {
  localStorage.setItem(STORAGE_KEY, transition);
}
