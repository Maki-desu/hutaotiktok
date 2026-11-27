import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyDisplayScale,
  applyTopBarOffset,
  clampDisplayScale,
  clampTopBarOffset,
  DEFAULT_DISPLAY_SCALE,
  DEFAULT_TOP_BAR_OFFSET,
  describeDisplayScale,
  describeTopBarOffset,
  DISPLAY_SCALE_STORAGE_KEY,
  loadDisplayScale,
  loadTopBarOffset,
  MAX_DISPLAY_SCALE,
  MAX_TOP_BAR_OFFSET,
  MIN_DISPLAY_SCALE,
  MIN_TOP_BAR_OFFSET,
  onDisplayScaleChanged,
  onTopBarOffsetChanged,
  saveDisplayScale,
  saveTopBarOffset,
  TOP_BAR_OFFSET_STORAGE_KEY,
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

  it("clamps, persists, applies, and broadcasts top bar height offsets", () => {
    expect(clampTopBarOffset(Number.NaN)).toBe(DEFAULT_TOP_BAR_OFFSET);
    expect(clampTopBarOffset(-10)).toBe(MIN_TOP_BAR_OFFSET);
    expect(clampTopBarOffset(200)).toBe(MAX_TOP_BAR_OFFSET);
    expect(clampTopBarOffset(30)).toBe(32);
    expect(describeTopBarOffset(4)).toBe("Very High");
    expect(describeTopBarOffset(16)).toBe("Default");
    expect(describeTopBarOffset(36)).toBe("Lower");
    expect(describeTopBarOffset(56)).toBe("Notch Safe");
    expect(describeTopBarOffset(84)).toBe("Extra Low");

    const received: number[] = [];
    const unsubscribe = onTopBarOffsetChanged((offset) => received.push(offset));

    expect(loadTopBarOffset()).toBe(DEFAULT_TOP_BAR_OFFSET);
    expect(saveTopBarOffset(48)).toBe(48);
    expect(storage.get(TOP_BAR_OFFSET_STORAGE_KEY)).toBe("48");
    expect(rootStyles.get("--top-bar-offset")).toBe("48px");
    expect(rootDataset.topBarOffset).toBe("48");
    expect(loadTopBarOffset()).toBe(48);

    expect(applyTopBarOffset(0)).toBe(0);
    expect(rootStyles.get("--top-bar-offset")).toBe("0px");
    expect(rootDataset.topBarOffset).toBe("0");

    saveTopBarOffset(0);
    unsubscribe();
    expect(received).toEqual([48, 0]);
  });
});
