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

const TAP_BOUNCE_CLASS = "btn-tap-bouncing";
const TAP_BOUNCE_SELECTOR =
  "button, [role='button'], [role='combobox'], [role='switch'], [role='tab'], summary, .interactive-element";

let tapBounceInstalled = false;

export function installGlobalTapBounce(): void {
  if (tapBounceInstalled) return;
  if (
    typeof window === "undefined" ||
    typeof document === "undefined" ||
    typeof document.addEventListener !== "function"
  ) {
    return;
  }
  tapBounceInstalled = true;

  const cleanupTimers = new WeakMap<HTMLElement, number>();
  let downX = 0;
  let downY = 0;

  const triggerBounce = (el: HTMLElement) => {
    if (document.documentElement?.dataset?.bounceAnimation === "off") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;
    if (el.matches(":disabled, [aria-disabled='true'], [role='slider'], [data-no-bounce]")) return;

    const prevTimer = cleanupTimers.get(el);
    if (prevTimer !== undefined) {
      window.clearTimeout(prevTimer);
    }

    el.classList.remove(TAP_BOUNCE_CLASS);
    // Force reflow so rapid consecutive taps replay the spring cleanly
    void el.offsetWidth;
    el.classList.add(TAP_BOUNCE_CLASS);

    const clear = () => {
      el.classList.remove(TAP_BOUNCE_CLASS);
      const activeTimer = cleanupTimers.get(el);
      if (activeTimer !== undefined) {
        window.clearTimeout(activeTimer);
        cleanupTimers.delete(el);
      }
    };

    el.addEventListener("animationend", clear, { once: true });
    cleanupTimers.set(el, window.setTimeout(clear, 460));
  };

  document.addEventListener(
    "pointerdown",
    (event: PointerEvent) => {
      downX = event.clientX;
      downY = event.clientY;
    },
    { passive: true, capture: true },
  );

  document.addEventListener(
    "pointerup",
    (event: PointerEvent) => {
      const dx = event.clientX - downX;
      const dy = event.clientY - downY;
      if (dx * dx + dy * dy > 144) return; // Ignore scroll/swipe gestures
      const target = event.target instanceof Element ? event.target.closest(TAP_BOUNCE_SELECTOR) : null;
      if (target instanceof HTMLElement) {
        triggerBounce(target);
      }
    },
    { passive: true, capture: true },
  );

  document.addEventListener(
    "keydown",
    (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const target = event.target instanceof Element ? event.target.closest(TAP_BOUNCE_SELECTOR) : null;
      if (target instanceof HTMLElement) {
        triggerBounce(target);
      }
    },
    { passive: true, capture: true },
  );
}
