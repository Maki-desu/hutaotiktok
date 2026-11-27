import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyDisplayScale,
  clampDisplayScale,
  DEFAULT_DISPLAY_SCALE,
  describeDisplayScale,
  DISPLAY_SCALE_STORAGE_KEY,
  loadDisplayScale,
  MAX_DISPLAY_SCALE,
  MIN_DISPLAY_SCALE,
  onDisplayScaleChanged,
  saveDisplayScale,
} from "./display-scale";

describe("display-scale", () => {
  const storage = new Map<string, string>();
  const target = new EventTarget();
  const rootDataset: Record<string, string | undefined> = {};
  const rootStyles = new Map<string, string>();
  const rootStyleObj: {
    fontSize: string;
    setProperty: (name: string, value: string) => void;
    removeProperty: (name: string) => void;
  } = {
    fontSize: "",
    setProperty: (name, value) => {
      rootStyles.set(name, value);
    },
    removeProperty: (name) => {
      if (name === "font-size") rootStyleObj.fontSize = "";
      rootStyles.delete(name);
    },
  };

  beforeEach(() => {
    storage.clear();
    rootStyles.clear();
    rootStyleObj.fontSize = "";
    for (const key of Object.keys(rootDataset)) delete rootDataset[key];

    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    });
    vi.stubGlobal("window", {
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      dispatchEvent: target.dispatchEvent.bind(target),
    });
    vi.stubGlobal("document", {
      documentElement: {
        dataset: rootDataset,
        style: rootStyleObj,
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("clamps and snaps display scale values to 5% increments within bounds", () => {
    expect(clampDisplayScale(Number.NaN)).toBe(DEFAULT_DISPLAY_SCALE);
    expect(clampDisplayScale(40)).toBe(MIN_DISPLAY_SCALE);
    expect(clampDisplayScale(150)).toBe(MAX_DISPLAY_SCALE);
    expect(clampDisplayScale(83)).toBe(85);
    expect(clampDisplayScale(77)).toBe(75);
    expect(describeDisplayScale(70)).toBe("Extra Compact");
    expect(describeDisplayScale(80)).toBe("Compact");
    expect(describeDisplayScale(90)).toBe("Smaller");
    expect(describeDisplayScale(100)).toBe("Default");
    expect(describeDisplayScale(110)).toBe("Larger");
  });

  it("persists, applies, resets, and broadcasts display scale changes", () => {
    const received: number[] = [];
    const unsubscribe = onDisplayScaleChanged((scale) => received.push(scale));

    expect(loadDisplayScale()).toBe(100);

    expect(saveDisplayScale(80)).toBe(80);
    expect(storage.get(DISPLAY_SCALE_STORAGE_KEY)).toBe("80");
    expect(rootStyleObj.fontSize).toBe("80%");
    expect(rootStyles.get("--display-scale")).toBe("0.80");
    expect(rootDataset.displayScale).toBe("80");
    expect(loadDisplayScale()).toBe(80);

    expect(applyDisplayScale(100)).toBe(100);
    expect(rootStyleObj.fontSize).toBe("");
    expect(rootDataset.displayScale).toBe("100");

    saveDisplayScale(75);
    unsubscribe();

    expect(received).toEqual([80, 75]);
  });
});
