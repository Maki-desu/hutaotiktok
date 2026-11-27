import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyFontStyle,
  DEFAULT_FONT_STYLE,
  FONT_STYLE_IDS,
  FONT_STYLE_PRESETS,
  FONT_STYLE_STORAGE_KEY,
  loadFontStyle,
  onFontStyleChanged,
  saveFontStyle,
} from "./font-style";

describe("font-style", () => {
  const storage = new Map<string, string>();
  const target = new EventTarget();
  const rootDataset: Record<string, string | undefined> = {};
  const rootStyles = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    rootStyles.clear();
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
        style: {
          setProperty: (name: string, value: string) => rootStyles.set(name, value),
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to modern font preset and rejects unknown saved IDs", () => {
    expect(loadFontStyle()).toBe(DEFAULT_FONT_STYLE);
    storage.set(FONT_STYLE_STORAGE_KEY, "does-not-exist");
    expect(loadFontStyle()).toBe(DEFAULT_FONT_STYLE);
    expect(FONT_STYLE_PRESETS.length).toBe(FONT_STYLE_IDS.length);
  });

  it("applies, persists, and broadcasts every font preset cleanly", () => {
    const received: string[] = [];
    const unsubscribe = onFontStyleChanged((id) => received.push(id));

    for (const id of FONT_STYLE_IDS) {
      const preset = saveFontStyle(id);
      expect(preset.id).toBe(id);
      expect(loadFontStyle()).toBe(id);
      expect(storage.get(FONT_STYLE_STORAGE_KEY)).toBe(id);
      expect(rootDataset.fontStyle).toBe(id);
      expect(rootStyles.get("--app-font-sans")).toBe(preset.sans);
      expect(rootStyles.get("--app-font-serif")).toBe(preset.display);
      expect(rootStyles.get("--app-font-mono")).toBe(preset.mono);
    }

    unsubscribe();
    expect(received).toEqual([...FONT_STYLE_IDS]);

    const applied = applyFontStyle("poppins");
    expect(applied.name).toBe("Poppins Smooth");
    expect(rootDataset.fontStyle).toBe("poppins");
  });
});
