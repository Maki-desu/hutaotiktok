import { useEffect, useState } from "react";
import { ChevronDown, ImagePlus, Palette, Trash2 } from "lucide-react";
import {
  applyThemeCustomization,
  loadThemeCustomization,
  type ThemeCustomization,
} from "@/lib/theme-customization";
import { loadUiStyle, saveUiStyle, type UiStyle } from "@/lib/ui-style";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  loadScreenTransition,
  saveScreenTransition,
  type ScreenTransition,
} from "@/lib/screen-transitions";
import {
  loadDropdownAnimation,
  loadDropdownSpeed,
  saveDropdownAnimation,
  saveDropdownSpeed,
  type DropdownAnimation,
  type DropdownSpeed,
} from "@/lib/dropdown-animations";
import {
  loadBrandingImages,
  saveBrandingImage,
  type BrandingImageKey,
  type BrandingImages,
} from "@/lib/app-branding";

const COLOR_PRESETS: {
  id: string;
  name: string;
  colors: ThemeCustomization;
}[] = [
  {
    id: "default",
    name: "Ember (Default)",
    colors: {
      accent: "#f97316",
      background: "#0a0a0a",
      gradientEnabled: false,
      gradientEnd: "#7c2d12",
    },
  },
  {
    id: "ocean",
    name: "Ocean",
    colors: {
      accent: "#38bdf8",
      background: "#071a2e",
      gradientEnabled: true,
      gradientEnd: "#0e7490",
    },
  },
  {
    id: "forest",
    name: "Forest",
    colors: {
      accent: "#4ade80",
      background: "#0b1b12",
      gradientEnabled: true,
      gradientEnd: "#166534",
    },
  },
  {
    id: "sakura",
    name: "Sakura",
    colors: {
      accent: "#fb7185",
      background: "#24121b",
      gradientEnabled: true,
      gradientEnd: "#9d174d",
    },
  },
  {
    id: "violet",
    name: "Violet",
    colors: {
      accent: "#c084fc",
      background: "#171126",
      gradientEnabled: true,
      gradientEnd: "#5b21b6",
    },
  },
  {
    id: "sunset",
    name: "Sunset",
    colors: {
      accent: "#fbbf24",
      background: "#24120d",
      gradientEnabled: true,
      gradientEnd: "#be123c",
    },
  },
];

export default function Settings() {
  const [customization, setCustomization] = useState<ThemeCustomization | null>(
    () => loadThemeCustomization(),
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const [screenTransition, setScreenTransition] = useState<ScreenTransition>(
    () => loadScreenTransition(),
  );
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [uiStyle, setUiStyle] = useState<UiStyle>(() => loadUiStyle());
  const [uiStyleError, setUiStyleError] = useState<string | null>(null);
  const [dropdownAnimation, setDropdownAnimation] = useState<DropdownAnimation>(
    () => loadDropdownAnimation(),
  );
  const [dropdownAnimationError, setDropdownAnimationError] = useState<string | null>(null);
  const [dropdownSpeed, setDropdownSpeed] = useState<DropdownSpeed>(() => loadDropdownSpeed());
  const [dropdownSpeedError, setDropdownSpeedError] = useState<string | null>(null);
  const [brandingImages, setBrandingImages] = useState<BrandingImages>({
    banner: null,
    logo: null,
    launcherIcon: null,
  });
  const [brandingError, setBrandingError] = useState<string | null>(null);
  const [savingBrandingKey, setSavingBrandingKey] = useState<BrandingImageKey | null>(null);

  useEffect(() => {
    let mounted = true;
    loadBrandingImages()
      .then((images) => {
        if (mounted) setBrandingImages(images);
      })
      .catch((error: unknown) => {
        console.error("Could not load app branding images.", error);
        if (mounted) setBrandingError("Could not load saved branding images. Image storage may be unavailable.");
      });
    return () => {
      mounted = false;
    };
  }, []);
  const colors = customization ?? {
    accent: "#f97316",
    background: "#0a0a0a",
    gradientEnabled: false,
    gradientEnd: "#7c2d12",
  };
  const selectedPreset =
    COLOR_PRESETS.find(({ colors: preset }) =>
      preset.accent === colors.accent &&
      preset.background === colors.background &&
      preset.gradientEnabled === colors.gradientEnabled &&
      preset.gradientEnd === colors.gradientEnd
    )?.id ?? (customization ? "custom" : "default");

  const updateCustomization = (next: ThemeCustomization) => {
    try {
      applyThemeCustomization(next);
      setCustomization(next);
      setSaveError(null);
    } catch (error) {
      console.error("Could not save the selected color theme.", error);
      setSaveError("Could not save the selected theme. Check that storage is available and try again.");
    }
  };

  const updateUiStyle = (value: string) => {
    if (value !== "normal" && value !== "liquid-glass" && value !== "soft-glow" && value !== "minimal") return;
    try {
      saveUiStyle(value);
      setUiStyle(value);
      setUiStyleError(null);
    } catch (error) {
      console.error("Could not save the UI style.", error);
      setUiStyleError("Could not save this UI style. Check that storage is available and try again.");
    }
  };

  const updateScreenTransition = (value: string) => {
    if (
      value !== "fade" &&
      value !== "slide" &&
      value !== "zoom" &&
      value !== "bounce" &&
      value !== "elastic" &&
      value !== "flip" &&
      value !== "blur" &&
      value !== "none"
    ) return;
    try {
      saveScreenTransition(value);
      setScreenTransition(value);
      setTransitionError(null);
    } catch (error) {
      console.error("Could not save the screen transition.", error);
      setTransitionError("Could not save this transition. Check that storage is available and try again.");
    }
  };

  const updateDropdownAnimation = (value: string) => {
    if (value !== "smooth" && value !== "bounce" && value !== "slide" && value !== "fade" && value !== "none") return;
    try {
      saveDropdownAnimation(value);
      setDropdownAnimation(value);
      setDropdownAnimationError(null);
    } catch (error) {
      console.error("Could not save the dropdown animation.", error);
      setDropdownAnimationError("Could not save this dropdown animation. Check that storage is available and try again.");
    }
  };

  const updateDropdownSpeed = (value: string) => {
    if (value !== "slow" && value !== "normal" && value !== "fast") return;
    try {
      saveDropdownSpeed(value);
      setDropdownSpeed(value);
      setDropdownSpeedError(null);
    } catch (error) {
      console.error("Could not save the dropdown speed.", error);
      setDropdownSpeedError("Could not save this dropdown speed. Check that storage is available and try again.");
    }
  };

  const updateBrandingImage = async (key: BrandingImageKey, file: File | null) => {
    setSavingBrandingKey(key);
    try {
      const image = await saveBrandingImage(key, file);
      setBrandingImages((current) => ({ ...current, [key]: image }));
      setBrandingError(null);
    } catch (error) {
      console.error(`Could not save the ${key} image.`, error);
      setBrandingError(error instanceof Error ? error.message : "Could not save this image.");
    } finally {
      setSavingBrandingKey(null);
    }
  };

  const renderBrandingControl = (
    key: BrandingImageKey,
    title: string,
    description: string,
    shape: "wide" | "square",
  ) => (
    <div className="space-y-2 rounded-xl border border-border bg-background p-3">
      <div>
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {brandingImages[key] && (
        <img
          src={brandingImages[key] ?? undefined}
          alt={`${title} preview`}
          className={shape === "wide"
            ? "h-24 w-full rounded-lg border border-border object-cover"
            : "h-16 w-16 rounded-xl border border-border object-cover"}
        />
      )}
      <div className="flex flex-wrap gap-2">
        <label className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-semibold transition-colors hover:border-primary/50 hover:text-foreground ${savingBrandingKey === key ? "pointer-events-none opacity-60" : ""}`}>
          <ImagePlus className="h-4 w-4" />
          {savingBrandingKey === key ? "Saving…" : brandingImages[key] ? "Choose image" : "Upload image"}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            disabled={savingBrandingKey === key}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void updateBrandingImage(key, file);
              event.currentTarget.value = "";
            }}
          />
        </label>
        {brandingImages[key] && (
          <button
            type="button"
            disabled={savingBrandingKey === key}
            onClick={() => void updateBrandingImage(key, null)}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive disabled:opacity-60"
          >
            <Trash2 className="h-4 w-4" />
            Reset
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-2xl space-y-5 animate-in fade-in duration-300">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-bold font-syne">
          <Palette className="h-6 w-6 text-primary" />
          Settings
        </h1>
        <p className="text-sm text-muted-foreground">
          Personalize how HutaoTik looks on this device.
        </p>
      </header>

      <div className="space-y-3">
      <details className="settings-disclosure rounded-2xl border border-border bg-card px-4 shadow-sm">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span>
            <span className="block text-base font-semibold text-card-foreground">Themes</span>
            <span className="mt-1 block text-left text-xs font-normal text-muted-foreground">
              Choose a color theme for HutaoTik.
            </span>
          </span>
          <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300" />
        </summary>
        <div className="space-y-2 pb-4">

        <label htmlFor="theme-preset" className="mb-2 block text-sm font-semibold text-foreground">
          Color theme
        </label>
        <Select
          value={selectedPreset}
          onValueChange={(value) => {
            if (value === "custom") return;
            const preset = COLOR_PRESETS.find((item) => item.id === value);
            if (preset) updateCustomization(preset.colors);
          }}
        >
          <SelectTrigger id="theme-preset" aria-label="Color theme" className="h-11 rounded-xl bg-background">
            <SelectValue placeholder="Choose a theme" />
          </SelectTrigger>
          <SelectContent>
            {selectedPreset === "custom" && <SelectItem value="custom" disabled>Custom theme</SelectItem>}
            {COLOR_PRESETS.map(({ id, name, colors: preset }) => (
              <SelectItem key={id} value={id}>
                <span className="inline-flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="theme-preset-swatch h-3.5 w-3.5 rounded-full border border-border"
                    style={{
                      background: preset.gradientEnabled
                        ? `linear-gradient(135deg, ${preset.accent}, ${preset.gradientEnd})`
                        : preset.accent,
                    }}
                  />
                  {name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {saveError && (
          <p role="alert" className="text-xs text-destructive">
            {saveError}
          </p>
        )}
        </div>
      </details>

      <details className="settings-disclosure rounded-2xl border border-border bg-card px-4 shadow-sm">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span>
            <span className="block text-base font-semibold text-card-foreground">Interface Style</span>
            <span className="mt-1 block text-left text-xs font-normal text-muted-foreground">
              Choose how cards and panels look throughout the app.
            </span>
          </span>
          <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300" />
        </summary>
        <div className="space-y-2 pb-4">
        <Select value={uiStyle} onValueChange={updateUiStyle}>
          <SelectTrigger aria-label="Interface style" className="h-11 rounded-xl bg-background">
            <SelectValue placeholder="Choose an interface style" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="normal">Normal</SelectItem>
            <SelectItem value="liquid-glass">Liquid Glass</SelectItem>
            <SelectItem value="soft-glow">Soft Glow</SelectItem>
            <SelectItem value="minimal">Minimal</SelectItem>
          </SelectContent>
        </Select>
        {uiStyleError && (
          <p role="alert" className="mt-3 text-xs text-destructive">
            {uiStyleError}
          </p>
        )}
        </div>
      </details>

      <details className="settings-disclosure rounded-2xl border border-border bg-card px-4 shadow-sm">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span>
            <span className="block text-base font-semibold text-card-foreground">Dropdown Animation</span>
            <span className="mt-1 block text-left text-xs font-normal text-muted-foreground">
              Choose how menus and dropdowns open throughout the app.
            </span>
          </span>
          <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300" />
        </summary>
        <div className="space-y-2 pb-4">

        <Select value={dropdownAnimation} onValueChange={updateDropdownAnimation}>
          <SelectTrigger aria-label="Dropdown animation" className="h-11 rounded-xl bg-background">
            <SelectValue placeholder="Choose a dropdown animation" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="smooth">Smooth — soft float and blur</SelectItem>
            <SelectItem value="bounce">Bounce — playful spring</SelectItem>
            <SelectItem value="slide">Slide — glide into place</SelectItem>
            <SelectItem value="fade">Fade — gentle dissolve</SelectItem>
            <SelectItem value="none">None — no animation</SelectItem>
          </SelectContent>
        </Select>

        <label className="mb-2 mt-4 block text-sm font-semibold text-foreground" id="dropdown-speed-label">
          Animation speed
        </label>
        <Select value={dropdownSpeed} onValueChange={updateDropdownSpeed}>
          <SelectTrigger aria-labelledby="dropdown-speed-label" aria-label="Dropdown animation speed" className="h-11 rounded-xl bg-background">
            <SelectValue placeholder="Choose animation speed" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="slow">Slow — relaxed and floaty</SelectItem>
            <SelectItem value="normal">Normal — balanced</SelectItem>
            <SelectItem value="fast">Fast — quick and snappy</SelectItem>
          </SelectContent>
        </Select>

        {dropdownAnimationError && (
          <p role="alert" className="mt-3 text-xs text-destructive">
            {dropdownAnimationError}
          </p>
        )}
        {dropdownSpeedError && (
          <p role="alert" className="text-xs text-destructive">
            {dropdownSpeedError}
          </p>
        )}
        </div>
      </details>

      <details className="settings-disclosure rounded-2xl border border-border bg-card px-4 shadow-sm">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span>
            <span className="block text-base font-semibold text-card-foreground">App Branding</span>
            <span className="mt-1 block text-left text-xs font-normal text-muted-foreground">
              Customize the lobby artwork and in-app logos.
            </span>
          </span>
          <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300" />
        </summary>
        <div className="space-y-3 pb-4">
        <div className="space-y-3">
          {renderBrandingControl("banner", "Lobby banner", "Wide image displayed behind the lobby header.", "wide")}
          {renderBrandingControl("logo", "In-app logo", "Used in the app header and startup screen.", "square")}
          {renderBrandingControl(
            "launcherIcon",
            "APK launcher icon",
            "Saved as your desired launcher artwork. Changing an installed Android app icon requires a new APK build.",
            "square",
          )}
        </div>
        {brandingError && (
          <p role="alert" className="text-xs text-destructive">
            {brandingError}
          </p>
        )}
        </div>
      </details>

      <details className="settings-disclosure rounded-2xl border border-border bg-card px-4 shadow-sm">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span>
            <span className="block text-base font-semibold text-card-foreground">Screen Transitions</span>
            <span className="mt-1 block text-left text-xs font-normal text-muted-foreground">
              Choose how screens animate when you move around the app.
            </span>
          </span>
          <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300" />
        </summary>
        <div className="space-y-2 pb-4">

        <Select value={screenTransition} onValueChange={updateScreenTransition}>
          <SelectTrigger aria-label="Screen transition" className="h-11 rounded-xl bg-background">
            <SelectValue placeholder="Choose a transition" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fade">Fade — soft dissolve</SelectItem>
            <SelectItem value="slide">Slide — move in from the side</SelectItem>
            <SelectItem value="zoom">Zoom — gently scale in</SelectItem>
            <SelectItem value="bounce">Bounce — playful spring-in</SelectItem>
            <SelectItem value="elastic">Elastic — overshoot and settle</SelectItem>
            <SelectItem value="flip">Flip — 3D card turn</SelectItem>
            <SelectItem value="blur">Blur — sharpen into view</SelectItem>
            <SelectItem value="none">None — no screen animation</SelectItem>
          </SelectContent>
        </Select>

        {transitionError && (
          <p role="alert" className="text-xs text-destructive">
            {transitionError}
          </p>
        )}
        </div>
      </details>
      </div>
    </div>
  );
}
