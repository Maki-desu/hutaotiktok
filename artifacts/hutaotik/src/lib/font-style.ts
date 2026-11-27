export interface FontStylePreset {
  id: FontStyleId;
  name: string;
  tagline: string;
  sans: string;
  display: string;
  mono: string;
}

export const FONT_STYLE_IDS = [
  "modern",
  "studio",
  "poppins",
  "editorial",
  "rounded",
  "sora",
  "mono",
  "classic",
] as const;

export type FontStyleId = (typeof FONT_STYLE_IDS)[number];

export const DEFAULT_FONT_STYLE: FontStyleId = "modern";
export const FONT_STYLE_STORAGE_KEY = "hutaotik-font-style";
export const FONT_STYLE_CHANGED_EVENT = "hutaotik:font-style-changed";

const DEFAULT_MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

export const FONT_STYLE_PRESETS: readonly FontStylePreset[] = [
  {
    id: "modern",
    name: "Modern Jakarta",
    tagline: "Crisp geometric sans · Outfit display (Default)",
    sans: "'Plus Jakarta Sans', 'Inter', system-ui, -apple-system, sans-serif",
    display: "'Outfit', 'Plus Jakarta Sans', system-ui, sans-serif",
    mono: DEFAULT_MONO,
  },
  {
    id: "studio",
    name: "Studio Grotesk",
    tagline: "Clean Inter body · sharp Space Grotesk headings",
    sans: "'Inter', system-ui, -apple-system, sans-serif",
    display: "'Space Grotesk', 'Inter', system-ui, sans-serif",
    mono: DEFAULT_MONO,
  },
  {
    id: "poppins",
    name: "Poppins Smooth",
    tagline: "Polished rounded geometry for a sleek mobile feel",
    sans: "'Poppins', system-ui, -apple-system, sans-serif",
    display: "'Poppins', system-ui, sans-serif",
    mono: DEFAULT_MONO,
  },
  {
    id: "editorial",
    name: "Bricolage Studio",
    tagline: "Expressive modern headlines · clean DM Sans text",
    sans: "'DM Sans', system-ui, -apple-system, sans-serif",
    display: "'Bricolage Grotesque', 'DM Sans', system-ui, sans-serif",
    mono: DEFAULT_MONO,
  },
  {
    id: "sora",
    name: "Sora Neo",
    tagline: "Futuristic neo-geometric typography",
    sans: "'Sora', system-ui, -apple-system, sans-serif",
    display: "'Sora', system-ui, sans-serif",
    mono: DEFAULT_MONO,
  },
  {
    id: "rounded",
    name: "Rounded Soft",
    tagline: "Friendly soft curves · Fredoka & Nunito",
    sans: "'Nunito', system-ui, -apple-system, sans-serif",
    display: "'Fredoka', 'Nunito', system-ui, sans-serif",
    mono: DEFAULT_MONO,
  },
  {
    id: "mono",
    name: "Cyber Mono",
    tagline: "Crisp developer monospace · Space Grotesk titles",
    sans: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
    display: "'Space Grotesk', 'JetBrains Mono', monospace",
    mono: DEFAULT_MONO,
  },
  {
    id: "classic",
    name: "Classic Syne",
    tagline: "Original HutaoTik Inter & wide Syne display",
    sans: "'Inter', system-ui, -apple-system, sans-serif",
    display: "'Syne', 'Inter', system-ui, sans-serif",
    mono: DEFAULT_MONO,
  },
] as const;

export function getFontStylePreset(id: string | null | undefined): FontStylePreset {
  return (
    FONT_STYLE_PRESETS.find((preset) => preset.id === id) ??
    FONT_STYLE_PRESETS[0]
  );
}

export function isFontStyleId(value: unknown): value is FontStyleId {
  return typeof value === "string" && FONT_STYLE_IDS.includes(value as FontStyleId);
}

export function loadFontStyle(): FontStyleId {
  try {
    const stored = localStorage.getItem(FONT_STYLE_STORAGE_KEY);
    return isFontStyleId(stored) ? stored : DEFAULT_FONT_STYLE;
  } catch {
    return DEFAULT_FONT_STYLE;
  }
}

export function applyFontStyle(id: FontStyleId): FontStylePreset {
  const preset = getFontStylePreset(id);
  if (typeof document !== "undefined" && document.documentElement) {
    const root = document.documentElement;
    root.dataset.fontStyle = preset.id;
    root.style.setProperty("--app-font-sans", preset.sans);
    root.style.setProperty("--app-font-serif", preset.display);
    root.style.setProperty("--app-font-mono", preset.mono);
  }
  return preset;
}

export function saveFontStyle(id: FontStyleId): FontStylePreset {
  const preset = applyFontStyle(id);
  try {
    localStorage.setItem(FONT_STYLE_STORAGE_KEY, preset.id);
  } catch {
    /* ignore storage write errors */
  }
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    try {
      window.dispatchEvent(new CustomEvent<FontStyleId>(FONT_STYLE_CHANGED_EVENT, { detail: preset.id }));
    } catch {
      window.dispatchEvent(new Event(FONT_STYLE_CHANGED_EVENT));
    }
  }
  return preset;
}

export function onFontStyleChanged(listener: (id: FontStyleId) => void): () => void {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") {
    return () => {};
  }
  const handler = (event: Event) => {
    if (event instanceof CustomEvent && isFontStyleId(event.detail)) {
      listener(event.detail);
    } else {
      listener(loadFontStyle());
    }
  };
  window.addEventListener(FONT_STYLE_CHANGED_EVENT, handler);
  return () => window.removeEventListener(FONT_STYLE_CHANGED_EVENT, handler);
}
