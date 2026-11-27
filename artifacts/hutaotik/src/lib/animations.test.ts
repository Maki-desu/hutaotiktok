import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadScreenTransition,
  onScreenTransitionChanged,
  saveScreenTransition,
  SCREEN_TRANSITIONS,
} from "./screen-transitions";
import {
  DROPDOWN_ANIMATIONS,
  DROPDOWN_SPEEDS,
  loadDropdownAnimation,
  loadDropdownSpeed,
  saveDropdownAnimation,
  saveDropdownSpeed,
} from "./dropdown-animations";

describe("animation settings & CSS integrity", () => {
  const storage = new Map<string, string>();
  const target = new EventTarget();
  const rootDataset: Record<string, string | undefined> = {};
  const rootStyles = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    rootStyles.clear();
    for (const k of Object.keys(rootDataset)) delete rootDataset[k];

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

  it("notifies listeners immediately when screen transition changes", () => {
    const received: string[] = [];
    const unsub = onScreenTransitionChanged((next) => received.push(next));

    for (const transition of SCREEN_TRANSITIONS) {
      saveScreenTransition(transition);
      expect(loadScreenTransition()).toBe(transition);
    }

    unsub();
    expect(received).toEqual([...SCREEN_TRANSITIONS]);
  });

  it("applies every dropdown animation mode and speed variable cleanly", () => {
    for (const mode of DROPDOWN_ANIMATIONS) {
      saveDropdownAnimation(mode);
      expect(loadDropdownAnimation()).toBe(mode);
      expect(rootDataset.dropdownAnimation).toBe(mode);
    }

    for (const speed of DROPDOWN_SPEEDS) {
      saveDropdownSpeed(speed);
      expect(loadDropdownSpeed()).toBe(speed);
      expect(rootDataset.dropdownSpeed).toBe(speed);
      expect(rootStyles.get("--dropdown-open-duration")).toMatch(/ms$/);
      expect(rootStyles.get("--dropdown-close-duration")).toMatch(/ms$/);
    }
  });

  it("keeps animation CSS free of conflicting tw-animate-css classes and broken blur(0)", () => {
    const css = readFileSync(resolve(import.meta.dirname, "../index.css"), "utf8");
    const selectSrc = readFileSync(resolve(import.meta.dirname, "../components/ui/select.tsx"), "utf8");
    const dropdownSrc = readFileSync(resolve(import.meta.dirname, "../components/ui/dropdown-menu.tsx"), "utf8");
    const popoverSrc = readFileSync(resolve(import.meta.dirname, "../components/ui/popover.tsx"), "utf8");
    const dialogSrc = readFileSync(resolve(import.meta.dirname, "../components/ui/dialog.tsx"), "utf8");

    // LightningCSS minifies `blur(0)` to invalid `blur()`; enforce non-empty blur values.
    expect(css).not.toMatch(/filter:\s*blur\(\s*0?\s*\)/);

    // Entrance animations must use `backwards` so hover/active transforms and fixed children are never locked.
    expect(css).toMatch(/\.screen-transition\s*\{[^}]*animation-fill-mode:\s*backwards;/);
    expect(css).toMatch(/\.animate-bounce-pop\s*\{[^}]*backwards;/);
    expect(css).toMatch(/\.toast-bounce\[data-state="open"\]\s*\{[^}]*backwards;/);

    // Dropdown surfaces must not carry conflicting tw-animate-css enter/exit classes alongside .dropdown-motion.
    expect(selectSrc).not.toContain("data-[state=open]:animate-in");
    expect(dropdownSrc).not.toContain("data-[state=open]:animate-in");
    expect(popoverSrc).not.toContain("data-[state=open]:animate-in");

    // Dialog centering must not depend on translate-x-[-50%].
    expect(dialogSrc).not.toContain("translate-x-[-50%]");
  });
});
