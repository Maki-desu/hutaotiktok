export interface ThemeCustomization {
  accent: string;
  background: string;
  gradientEnabled: boolean;
  gradientEnd: string;
}

const STORAGE_KEY = "hutaotik-theme-customization";
let transitionTimer: ReturnType<typeof setTimeout> | undefined;

function playThemeTransition(): void {
  const root = document.documentElement;
  root.classList.remove("theme-transition");
  void root.offsetWidth;
  root.classList.add("theme-transition");
  if (transitionTimer) clearTimeout(transitionTimer);
  transitionTimer = setTimeout(() => {
    root.classList.remove("theme-transition");
    transitionTimer = undefined;
  }, 850);
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

export function loadThemeCustomization(): ThemeCustomization | null {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!stored) return null;

  try {
    const value: unknown = JSON.parse(stored);
    if (
      typeof value === "object" &&
      value !== null &&
      "accent" in value &&
      "background" in value &&
      "gradientEnabled" in value &&
      "gradientEnd" in value &&
      isHexColor(value.accent) &&
      isHexColor(value.background) &&
      typeof value.gradientEnabled === "boolean" &&
      isHexColor(value.gradientEnd)
    ) {
      return {
        accent: value.accent,
        background: value.background,
        gradientEnabled: value.gradientEnabled,
        gradientEnd: value.gradientEnd,
      };
    }
    throw new Error("Saved theme colors have an invalid format.");
  } catch (error) {
    console.error("Could not load saved theme colors.", error);
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

function toHsl(hex: string): { value: string; lightness: number } {
  const red = parseInt(hex.slice(1, 3), 16) / 255;
  const green = parseInt(hex.slice(3, 5), 16) / 255;
  const blue = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;

  if (delta !== 0) {
    if (max === red) hue = ((green - blue) / delta) % 6;
    else if (max === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }

  const lightness = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  return {
    value: `${Math.round(hue)} ${Math.round(saturation * 100)}% ${Math.round(lightness * 100)}%`,
    lightness,
  };
}

function adjustedHsl(hex: string, adjustment: number): string {
  const color = toHsl(hex);
  const lightness = Math.max(0, Math.min(100, color.lightness * 100 + adjustment));
  return `${color.value.split(" ")[0]} ${color.value.split(" ")[1]} ${Math.round(lightness)}%`;
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastingForeground(hex: string): string {
  return relativeLuminance(hex) > 0.179 ? "0 0% 7%" : "0 0% 98%";
}

export function applyThemeCustomization(theme: ThemeCustomization): void {
  const root = document.documentElement;
  playThemeTransition();
  const accent = toHsl(theme.accent);
  const background = toHsl(theme.background);
  const isLight = relativeLuminance(theme.background) > 0.179;
  const foreground = contrastingForeground(theme.background);
  const mutedLightness = Math.max(0, Math.min(100, background.lightness * 100 + (isLight ? -42 : 42)));
  const mutedForeground = `${toHsl(theme.background).value.split(" ")[0]} 14% ${Math.round(mutedLightness)}%`;

  root.style.setProperty("--primary", accent.value);
  root.style.setProperty("--primary-foreground", contrastingForeground(theme.accent));
  root.style.setProperty("--ring", accent.value);
  root.style.setProperty("--sidebar-primary", accent.value);
  root.style.setProperty("--sidebar-ring", accent.value);
  root.style.setProperty("--chart-1", accent.value);

  root.style.setProperty("--background", background.value);
  root.style.setProperty("--foreground", foreground);
  root.style.setProperty("--card", adjustedHsl(theme.background, isLight ? 2 : 3));
  root.style.setProperty("--card-foreground", foreground);
  root.style.setProperty("--popover", adjustedHsl(theme.background, isLight ? 2 : 3));
  root.style.setProperty("--popover-foreground", foreground);
  root.style.setProperty("--secondary", adjustedHsl(theme.background, isLight ? -5 : 8));
  root.style.setProperty("--secondary-foreground", foreground);
  root.style.setProperty("--muted", adjustedHsl(theme.background, isLight ? -3 : 6));
  root.style.setProperty("--muted-foreground", mutedForeground);
  root.style.setProperty("--accent", adjustedHsl(theme.background, isLight ? -6 : 12));
  root.style.setProperty("--accent-foreground", foreground);
  root.style.setProperty("--border", adjustedHsl(theme.background, isLight ? -12 : 12));
  root.style.setProperty("--card-border", adjustedHsl(theme.background, isLight ? -12 : 12));
  root.style.setProperty("--popover-border", adjustedHsl(theme.background, isLight ? -12 : 12));
  root.style.setProperty("--input", adjustedHsl(theme.background, isLight ? -14 : 14));
  root.style.setProperty("--sidebar", adjustedHsl(theme.background, isLight ? -2 : 3));
  root.style.setProperty("--sidebar-foreground", foreground);
  root.style.setProperty("--sidebar-border", adjustedHsl(theme.background, isLight ? -12 : 12));
  root.style.setProperty("--sidebar-accent", adjustedHsl(theme.background, isLight ? -6 : 8));
  root.style.setProperty("--sidebar-accent-foreground", foreground);

  if (theme.gradientEnabled) {
    const gradientEnd = toHsl(theme.gradientEnd);
    root.style.setProperty(
      "--app-surface-gradient",
      [
        `radial-gradient(ellipse at 12% 28%, hsl(${accent.value} / 0.14), transparent 56%)`,
        `radial-gradient(ellipse at 88% 78%, hsl(${gradientEnd.value} / 0.18), transparent 58%)`,
        `linear-gradient(135deg, ${theme.background} 0%, ${theme.background} 55%, ${theme.gradientEnd} 100%)`,
      ].join(", "),
    );
  } else {
    root.style.removeProperty("--app-surface-gradient");
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
}

export function clearThemeCustomization(): void {
  const root = document.documentElement;
  playThemeTransition();
  const properties = [
    "--primary", "--primary-foreground", "--ring", "--sidebar-primary", "--sidebar-ring", "--chart-1",
    "--background", "--foreground", "--card", "--card-foreground", "--popover", "--popover-foreground",
    "--secondary", "--secondary-foreground", "--muted", "--muted-foreground", "--accent", "--accent-foreground",
    "--border", "--card-border", "--popover-border", "--input", "--sidebar", "--sidebar-foreground",
    "--sidebar-border", "--sidebar-accent", "--sidebar-accent-foreground", "--app-surface-gradient",
  ];
  properties.forEach((property) => root.style.removeProperty(property));
  localStorage.removeItem(STORAGE_KEY);
}
