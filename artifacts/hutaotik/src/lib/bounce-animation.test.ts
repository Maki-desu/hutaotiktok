import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyBounceAnimation,
  loadBounceAnimationEnabled,
  onBounceAnimationChanged,
  saveBounceAnimationEnabled,
} from "./bounce-animation";

describe("bounce-animation preference", () => {
  const store = new Map<string, string>();
  const dataset: Record<string, string | undefined> = {};
  const target = new EventTarget();

  beforeEach(() => {
    store.clear();
    for (const key of Object.keys(dataset)) {
      delete dataset[key];
    }

    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
    });
    vi.stubGlobal("document", {
      documentElement: { dataset },
    });
    vi.stubGlobal("window", {
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      dispatchEvent: target.dispatchEvent.bind(target),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to enabled when no preference is stored", () => {
    expect(loadBounceAnimationEnabled()).toBe(true);
    applyBounceAnimation(loadBounceAnimationEnabled());
    expect(dataset.bounceAnimation).toBe("on");
  });

  it("persists turning bounce animations off and updates root dataset", () => {
    const events: boolean[] = [];
    const unsubscribe = onBounceAnimationChanged((enabled) => events.push(enabled));

    saveBounceAnimationEnabled(false);

    expect(loadBounceAnimationEnabled()).toBe(false);
    expect(dataset.bounceAnimation).toBe("off");
    expect(events).toEqual([false]);

    saveBounceAnimationEnabled(true);

    expect(loadBounceAnimationEnabled()).toBe(true);
    expect(dataset.bounceAnimation).toBe("on");
    expect(events).toEqual([false, true]);

    unsubscribe();
  });
});
