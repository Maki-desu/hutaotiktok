import { useCallback, useEffect, useState } from "react";
import {
  ArrowUpDown,
  Bell,
  BellRing,
  Check,
  ChevronDown,
  HardDrive,
  ImagePlus,
  Loader2,
  Menu as MenuIcon,
  Minus,
  MonitorSmartphone,
  Palette,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  Type,
} from "lucide-react";
import {
  clearTemporaryCache,
  formatStorageBytes,
  inspectCacheStorage,
  type CacheStorageInfo,
} from "@/lib/cache-storage";
import {
  FONT_STYLE_PRESETS,
  getFontStylePreset,
  loadFontStyle,
  saveFontStyle,
  type FontStyleId,
} from "@/lib/font-style";
import {
  clampDisplayScale,
  clampTopBarOffset,
  DEFAULT_DISPLAY_SCALE,
  DEFAULT_TOP_BAR_OFFSET,
  describeDisplayScale,
  describeTopBarOffset,
  DISPLAY_SCALE_STEP,
  loadDisplayScale,
  loadTopBarOffset,
  MAX_DISPLAY_SCALE,
  MAX_TOP_BAR_OFFSET,
  MIN_DISPLAY_SCALE,
  MIN_TOP_BAR_OFFSET,
  saveDisplayScale,
  saveTopBarOffset,
  TOP_BAR_OFFSET_STEP,
} from "@/lib/display-scale";
import {
  getNotificationStatus,
  loadNotificationPreferences,
  openDeviceNotificationSettings,
  requestAppNotificationPermission,
  saveNotificationPreferences,
  sendTestNotification,
  type NotificationPreferences,
} from "@/lib/notifications";
import { useToast } from "@/hooks/use-toast";
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
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  loadBounceAnimationEnabled,
  saveBounceAnimationEnabled,
} from "@/lib/bounce-animation";
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
  const [appliedDisplayScale, setAppliedDisplayScale] = useState<number>(() => loadDisplayScale());
  const [pendingDisplayScale, setPendingDisplayScale] = useState<number>(() => loadDisplayScale());
  const [appliedTopBarOffset, setAppliedTopBarOffset] = useState<number>(() => loadTopBarOffset());
  const [pendingTopBarOffset, setPendingTopBarOffset] = useState<number>(() => loadTopBarOffset());
  const [fontStyle, setFontStyle] = useState<FontStyleId>(() => loadFontStyle());
  const [bounceEnabled, setBounceEnabled] = useState<boolean>(() =>
    loadBounceAnimationEnabled(),
  );
  const [bounceError, setBounceError] = useState<string | null>(null);
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
  const [cacheInfo, setCacheInfo] = useState<CacheStorageInfo | null>(null);
  const [loadingCache, setLoadingCache] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);
  const [notifPrefs, setNotifPrefs] = useState<NotificationPreferences>(() =>
    loadNotificationPreferences(),
  );
  const [notifStatus, setNotifStatus] = useState(() => getNotificationStatus());
  const [requestingNotifPerm, setRequestingNotifPerm] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const syncStatus = () => setNotifStatus(getNotificationStatus());
    window.addEventListener("focus", syncStatus);
    return () => window.removeEventListener("focus", syncStatus);
  }, []);

  const updateNotifPref = (key: keyof NotificationPreferences, value: boolean) => {
    const updated = saveNotificationPreferences({
      ...notifPrefs,
      [key]: value,
    });
    setNotifPrefs(updated);
    setNotifStatus(getNotificationStatus());
  };

  const handleEnableNotifications = async () => {
    setRequestingNotifPerm(true);
    try {
      const result = await requestAppNotificationPermission();
      const refreshed = getNotificationStatus();
      setNotifStatus(refreshed);
      if (result === "granted" || refreshed.granted) {
        toast({
          title: "Push notifications enabled!",
          description: "Live download bars, update alerts, and announcements are now active.",
        });
      } else {
        toast({
          title: "Notification permission blocked",
          description: "Tap 'Open Android Notification Settings' to allow notifications for HutaoTik.",
          variant: "destructive",
        });
      }
    } finally {
      setRequestingNotifPerm(false);
    }
  };

  const handleSendTestNotification = () => {
    const sent = sendTestNotification();
    if (sent) {
      toast({
        title: "Test notification sent!",
        description: "Check your notification shade to see how HutaoTik alerts look.",
      });
    } else {
      toast({
        title: "Permission required",
        description: "Allow notifications for HutaoTik first, then try sending a test alert.",
        variant: "destructive",
      });
    }
  };

  const refreshCacheInfo = useCallback(async () => {
    setLoadingCache(true);
    try {
      const info = await inspectCacheStorage();
      setCacheInfo(info);
    } catch (error) {
      console.error("Could not inspect app cache.", error);
    } finally {
      setLoadingCache(false);
    }
  }, []);

  useEffect(() => {
    void refreshCacheInfo();
  }, [refreshCacheInfo]);

  const handleClearCache = async () => {
    setClearingCache(true);
    try {
      const beforeBytes = cacheInfo?.totalBytes ?? 0;
      const { freedBytes, clearedHistoryCount } = await clearTemporaryCache();
      const updated = await inspectCacheStorage();
      setCacheInfo(updated);
      const effectiveFreed = Math.max(freedBytes, Math.max(0, beforeBytes - updated.totalBytes));
      const didClear = effectiveFreed > 0 || clearedHistoryCount > 0;
      const details: string[] = [];
      if (effectiveFreed > 0) details.push(`freed ${formatStorageBytes(effectiveFreed)}`);
      if (clearedHistoryCount > 0) {
        details.push(
          `cleared ${clearedHistoryCount} history item${clearedHistoryCount === 1 ? "" : "s"}`,
        );
      }
      toast({
        title: didClear ? "Cache & history cleared" : "Cache is already clean",
        description: didClear
          ? `Successfully ${details.join(" and ")} without touching your saved videos or photos.`
          : "No temporary files or download history needed to be removed.",
      });
    } catch (error) {
      toast({
        title: "Could not clear cache",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setClearingCache(false);
    }
  };

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

  const handleApplyDisplayScale = () => {
    const saved = saveDisplayScale(pendingDisplayScale);
    setAppliedDisplayScale(saved);
    setPendingDisplayScale(saved);
    toast({
      title: `Display size set to ${saved}%`,
      description:
        saved === DEFAULT_DISPLAY_SCALE
          ? "Restored standard layout sizing across HutaoTik."
          : `Layout scaled to ${saved}% (${describeDisplayScale(saved)}) for this device.`,
    });
  };

  const handleResetDisplayScale = () => {
    const saved = saveDisplayScale(DEFAULT_DISPLAY_SCALE);
    setAppliedDisplayScale(saved);
    setPendingDisplayScale(saved);
    toast({
      title: "Display size reset to 100%",
      description: "Restored default display sizing across HutaoTik.",
    });
  };

  const handleApplyTopBarOffset = () => {
    const saved = saveTopBarOffset(pendingTopBarOffset);
    setAppliedTopBarOffset(saved);
    setPendingTopBarOffset(saved);
    toast({
      title: `Top bar height set to ${saved}px`,
      description:
        saved === DEFAULT_TOP_BAR_OFFSET
          ? "Restored standard top position for HutaoTik & Menu."
          : `Moved HutaoTik & Menu buttons to ${saved}px from the top (${describeTopBarOffset(saved)}).`,
    });
  };

  const handleResetTopBarOffset = () => {
    const saved = saveTopBarOffset(DEFAULT_TOP_BAR_OFFSET);
    setAppliedTopBarOffset(saved);
    setPendingTopBarOffset(saved);
    toast({
      title: `Top bar height reset to ${DEFAULT_TOP_BAR_OFFSET}px`,
      description: "Restored default top header position.",
    });
  };

  const handleSelectFontStyle = (nextFont: FontStyleId) => {
    const preset = saveFontStyle(nextFont);
    setFontStyle(preset.id);
    toast({
      title: `Font changed to ${preset.name}`,
      description: preset.tagline,
    });
  };

  const updateBounceAnimation = (enabled: boolean) => {
    try {
      saveBounceAnimationEnabled(enabled);
      setBounceEnabled(enabled);
      setBounceError(null);
    } catch (error) {
      console.error("Could not save the bounce animation setting.", error);
      setBounceError("Could not save this animation setting. Check that storage is available and try again.");
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
    <div className="mx-auto max-w-2xl space-y-5">
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
      <details open className="animate-card-bounce-in settings-disclosure rounded-2xl border border-border bg-card px-4 shadow-sm" style={{ animationDelay: "0ms" }}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span>
            <span className="flex flex-wrap items-center gap-2 text-base font-semibold text-card-foreground">
              <MonitorSmartphone className="h-4 w-4 text-primary" />
              Display Size &amp; Top Bar
              <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-[10px] font-bold text-primary">
                {appliedDisplayScale}%
              </span>
              {appliedTopBarOffset !== DEFAULT_TOP_BAR_OFFSET && (
                <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-[10px] font-bold text-primary">
                  Top {appliedTopBarOffset}px
                </span>
              )}
            </span>
            <span className="mt-1 block text-left text-xs font-normal text-muted-foreground">
              Adjust layout scale and the vertical height of the top HutaoTik &amp; Menu buttons.
            </span>
          </span>
          <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300" />
        </summary>
        <div className="space-y-3 pb-4">
          {/* Live proportional preview box so dragging the slider does not shift controls mid-drag */}
          <div className="rounded-xl border border-border bg-background p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-base font-extrabold text-foreground">
                  {pendingDisplayScale}%
                </span>
                <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                  {describeDisplayScale(pendingDisplayScale)}
                </span>
              </div>
              {pendingDisplayScale !== appliedDisplayScale ? (
                <span className="rounded-full border border-amber-500/35 bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                  Preview · Tap Apply
                </span>
              ) : (
                <span className="rounded-full border border-emerald-500/35 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
                  Active
                </span>
              )}
            </div>

            <div
              className="rounded-lg border border-border/70 bg-card/60 p-2.5 overflow-hidden"
              style={{ fontSize: `${(16 * pendingDisplayScale) / 100}px` }}
            >
              <div className="flex items-center justify-between gap-[0.5em]">
                <span className="font-syne font-bold text-foreground" style={{ fontSize: "0.95em" }}>
                  Hutao<span className="text-primary">Tik</span>
                </span>
                <span
                  className="inline-flex items-center gap-[0.25em] rounded-md border border-primary/40 bg-primary/15 px-[0.55em] py-[0.2em] font-semibold text-primary"
                  style={{ fontSize: "0.68em" }}
                >
                  Menu ▾
                </span>
              </div>
              <p className="mt-[0.45em] text-muted-foreground" style={{ fontSize: "0.75em", lineHeight: 1.35 }}>
                Sample layout text and buttons at {pendingDisplayScale}% display scale.
              </p>
            </div>
          </div>

          {/* Slider + minus/plus step buttons */}
          <div className="space-y-2">
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                aria-label="Decrease display size"
                disabled={pendingDisplayScale <= MIN_DISPLAY_SCALE}
                onClick={() =>
                  setPendingDisplayScale((current) =>
                    clampDisplayScale(current - DISPLAY_SCALE_STEP),
                  )
                }
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-40"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <Slider
                aria-label="Display size slider"
                min={MIN_DISPLAY_SCALE}
                max={MAX_DISPLAY_SCALE}
                step={DISPLAY_SCALE_STEP}
                value={[pendingDisplayScale]}
                onValueChange={(values) => {
                  const next = values[0];
                  if (typeof next === "number") {
                    setPendingDisplayScale(clampDisplayScale(next));
                  }
                }}
                className="flex-1 py-2"
              />
              <button
                type="button"
                aria-label="Increase display size"
                disabled={pendingDisplayScale >= MAX_DISPLAY_SCALE}
                onClick={() =>
                  setPendingDisplayScale((current) =>
                    clampDisplayScale(current + DISPLAY_SCALE_STEP),
                  )
                }
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="flex items-center justify-between gap-1 px-1">
              {[65, 75, 85, 100, 110].map((mark) => (
                <button
                  key={mark}
                  type="button"
                  onClick={() => setPendingDisplayScale(mark)}
                  className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold transition-colors ${
                    pendingDisplayScale === mark
                      ? "bg-primary/20 text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {mark}%
                </button>
              ))}
            </div>
          </div>

          {/* Apply + Reset buttons */}
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <button
              type="button"
              data-testid="apply-display-scale"
              onClick={handleApplyDisplayScale}
              disabled={pendingDisplayScale === appliedDisplayScale}
              className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 text-xs font-bold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Check className="h-4 w-4" />
              {pendingDisplayScale === appliedDisplayScale
                ? `Applied (${appliedDisplayScale}%)`
                : `Apply Display Size (${pendingDisplayScale}%)`}
            </button>
            {(appliedDisplayScale !== DEFAULT_DISPLAY_SCALE ||
              pendingDisplayScale !== DEFAULT_DISPLAY_SCALE) && (
              <button
                type="button"
                onClick={handleResetDisplayScale}
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-border bg-background px-3 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset 100%
              </button>
            )}
          </div>

          {/* Top Bar Height (HutaoTik & Menu) slider */}
          <div className="border-t border-border/70 pt-4 mt-2 space-y-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-card-foreground">
                <ArrowUpDown className="h-3.5 w-3.5 text-primary" />
                Top Buttons Height
              </div>
              <p className="text-xs text-muted-foreground">
                Move the top HutaoTik &amp; Menu buttons higher or lower to clear notches and status bars.
              </p>
            </div>

            <div className="rounded-xl border border-border bg-background p-3 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-base font-extrabold text-foreground">
                    {pendingTopBarOffset}px
                  </span>
                  <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                    {describeTopBarOffset(pendingTopBarOffset)}
                  </span>
                </div>
                {pendingTopBarOffset !== appliedTopBarOffset ? (
                  <span className="rounded-full border border-amber-500/35 bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                    Preview · Tap Apply
                  </span>
                ) : (
                  <span className="rounded-full border border-emerald-500/35 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
                    Active
                  </span>
                )}
              </div>

              {/* Live phone-top banner preview showing HutaoTik & Menu shifting vertically */}
              <div className="relative h-28 rounded-lg border border-border/70 bg-gradient-to-b from-primary/20 via-card/85 to-background overflow-hidden">
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1.5 left-1/2 -translate-x-1/2 h-1.5 w-14 rounded-full bg-white/20"
                />
                <div
                  className="flex items-center justify-between px-3 transition-[padding] duration-150"
                  style={{
                    paddingTop: `${Math.round((pendingTopBarOffset / MAX_TOP_BAR_OFFSET) * 62 + 8)}px`,
                  }}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-5 w-5 rounded-md border border-white/25 bg-primary/35 inline-block" />
                    <span className="font-syne text-xs font-bold text-foreground">HutaoTik</span>
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-lg border border-white/25 bg-black/55 px-2 py-1 text-[10px] font-semibold text-white">
                    <MenuIcon className="h-3 w-3 text-primary" />
                    Menu
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  aria-label="Move top buttons higher"
                  disabled={pendingTopBarOffset <= MIN_TOP_BAR_OFFSET}
                  onClick={() =>
                    setPendingTopBarOffset((current) =>
                      clampTopBarOffset(current - TOP_BAR_OFFSET_STEP),
                    )
                  }
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-40"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <Slider
                  aria-label="Top buttons height slider"
                  min={MIN_TOP_BAR_OFFSET}
                  max={MAX_TOP_BAR_OFFSET}
                  step={TOP_BAR_OFFSET_STEP}
                  value={[pendingTopBarOffset]}
                  onValueChange={(values) => {
                    const next = values[0];
                    if (typeof next === "number") {
                      setPendingTopBarOffset(clampTopBarOffset(next));
                    }
                  }}
                  className="flex-1 py-2"
                />
                <button
                  type="button"
                  aria-label="Move top buttons lower"
                  disabled={pendingTopBarOffset >= MAX_TOP_BAR_OFFSET}
                  onClick={() =>
                    setPendingTopBarOffset((current) =>
                      clampTopBarOffset(current + TOP_BAR_OFFSET_STEP),
                    )
                  }
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-40"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="flex items-center justify-between gap-1 px-1">
                {[0, 16, 32, 48, 72, 96].map((mark) => (
                  <button
                    key={mark}
                    type="button"
                    onClick={() => setPendingTopBarOffset(mark)}
                    className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold transition-colors ${
                      pendingTopBarOffset === mark
                        ? "bg-primary/20 text-primary"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {mark}px
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <button
                type="button"
                data-testid="apply-top-bar-offset"
                onClick={handleApplyTopBarOffset}
                disabled={pendingTopBarOffset === appliedTopBarOffset}
                className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 text-xs font-bold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Check className="h-4 w-4" />
                {pendingTopBarOffset === appliedTopBarOffset
                  ? `Applied (${appliedTopBarOffset}px)`
                  : `Apply Top Height (${pendingTopBarOffset}px)`}
              </button>
              {(appliedTopBarOffset !== DEFAULT_TOP_BAR_OFFSET ||
                pendingTopBarOffset !== DEFAULT_TOP_BAR_OFFSET) && (
                <button
                  type="button"
                  onClick={handleResetTopBarOffset}
                  className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-border bg-background px-3 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset {DEFAULT_TOP_BAR_OFFSET}px
                </button>
              )}
            </div>
          </div>
        </div>
      </details>

      <details className="animate-card-bounce-in settings-disclosure rounded-2xl border border-border bg-card px-4 shadow-sm" style={{ animationDelay: "30ms" }}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span>
            <span className="flex flex-wrap items-center gap-2 text-base font-semibold text-card-foreground">
              <Type className="h-4 w-4 text-primary" />
              Font Style
              <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                {getFontStylePreset(fontStyle).name}
              </span>
            </span>
            <span className="mt-1 block text-left text-xs font-normal text-muted-foreground">
              Switch between multiple modern font pairings across the entire app.
            </span>
          </span>
          <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300" />
        </summary>
        <div className="space-y-2.5 pb-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {FONT_STYLE_PRESETS.map((preset) => {
              const selected = fontStyle === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  data-testid={`font-option-${preset.id}`}
                  onClick={() => handleSelectFontStyle(preset.id)}
                  className={`group flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-all ${
                    selected
                      ? "border-primary bg-primary/12 shadow-[0_6px_18px_-6px_hsl(var(--primary)/0.45)]"
                      : "border-border bg-background hover:border-primary/45 hover:bg-card/80"
                  }`}
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span
                      className="text-sm font-bold text-foreground leading-tight"
                      style={{ fontFamily: preset.display }}
                    >
                      {preset.name}
                    </span>
                    {selected && (
                      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
                        <Check className="h-3 w-3" />
                      </span>
                    )}
                  </div>
                  <span
                    className="text-xs font-medium text-foreground/80"
                    style={{ fontFamily: preset.display }}
                  >
                    Download anything.
                  </span>
                  <span
                    className="text-[11px] leading-snug text-muted-foreground"
                    style={{ fontFamily: preset.sans }}
                  >
                    {preset.tagline}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </details>

      <details className="animate-card-bounce-in settings-disclosure rounded-2xl border border-border bg-card px-4 shadow-sm" style={{ animationDelay: "50ms" }}>
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

      <details className="animate-card-bounce-in settings-disclosure rounded-2xl border border-border bg-card px-4 shadow-sm" style={{ animationDelay: "60ms" }}>
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
            <SelectItem value="liquid-glass">Liquid Glass — iPhone frosted crystal</SelectItem>
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

      <div
        className="animate-card-bounce-in rounded-2xl border border-border bg-card p-4 shadow-sm"
        style={{ animationDelay: "90ms" }}
      >
        <div className="flex items-center justify-between gap-4">
          <label htmlFor="bounce-animations-switch" className="cursor-pointer">
            <span className="block text-base font-semibold text-card-foreground">Bounce Animations</span>
            <span className="mt-1 block text-left text-xs font-normal text-muted-foreground">
              Enable or turn off bouncy spring effects on cards, buttons, popups, menus, and screens.
            </span>
          </label>
          <Switch
            id="bounce-animations-switch"
            checked={bounceEnabled}
            onCheckedChange={updateBounceAnimation}
            aria-label="Bounce animations"
          />
        </div>
        {bounceError && (
          <p role="alert" className="mt-3 text-xs text-destructive">
            {bounceError}
          </p>
        )}
      </div>

      <details className="animate-card-bounce-in settings-disclosure rounded-2xl border border-border bg-card px-4 shadow-sm" style={{ animationDelay: "120ms" }}>
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

        {!bounceEnabled && dropdownAnimation === "bounce" && (
          <p className="text-xs text-muted-foreground">
            Using smooth fade while Bounce Animations is turned off.
          </p>
        )}

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

      <details className="animate-card-bounce-in settings-disclosure rounded-2xl border border-border bg-card px-4 shadow-sm" style={{ animationDelay: "180ms" }}>
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

      <details className="animate-card-bounce-in settings-disclosure rounded-2xl border border-border bg-card px-4 shadow-sm" style={{ animationDelay: "240ms" }}>
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

        {!bounceEnabled && (screenTransition === "bounce" || screenTransition === "elastic") && (
          <p className="text-xs text-muted-foreground">
            Using Fade while Bounce Animations is turned off.
          </p>
        )}

        {transitionError && (
          <p role="alert" className="text-xs text-destructive">
            {transitionError}
          </p>
        )}
        </div>
      </details>

      <details className="animate-card-bounce-in settings-disclosure rounded-2xl border border-border bg-card px-4 shadow-sm" style={{ animationDelay: "270ms" }}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span>
            <span className="flex items-center gap-2 text-base font-semibold text-card-foreground">
              <Bell className="h-4 w-4 text-primary" />
              Push Notifications
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                  notifStatus.granted
                    ? "border-emerald-500/35 bg-emerald-500/15 text-emerald-400"
                    : "border-amber-500/35 bg-amber-500/15 text-amber-400"
                }`}
              >
                {notifStatus.granted ? "Allowed" : "Enable"}
              </span>
            </span>
            <span className="mt-1 block text-left text-xs font-normal text-muted-foreground">
              Live background download bars, app update alerts, and lobby announcements.
            </span>
          </span>
          <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300" />
        </summary>
        <div className="space-y-3 pb-4">
          {!notifStatus.granted && (
            <div className="space-y-2 rounded-xl border border-amber-500/35 bg-amber-500/10 p-3">
              <p className="text-xs font-semibold text-amber-300">
                Notification permission is currently turned off.
              </p>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Allow notifications so downloads keep running with live progress when you leave HutaoTik, and so you receive new update &amp; announcement alerts.
              </p>
              <div className="flex flex-wrap gap-2 pt-0.5">
                <button
                  type="button"
                  disabled={requestingNotifPerm}
                  onClick={() => void handleEnableNotifications()}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-xs font-bold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
                >
                  <BellRing className="h-3.5 w-3.5" />
                  {requestingNotifPerm ? "Requesting…" : "Enable Notifications"}
                </button>
                <button
                  type="button"
                  onClick={openDeviceNotificationSettings}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-background px-3 text-xs font-semibold text-foreground transition-colors hover:border-primary/40"
                >
                  Android Settings
                </button>
              </div>
            </div>
          )}

          <div className="space-y-2.5 rounded-xl border border-border bg-background p-3">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="notif-downloads-switch" className="cursor-pointer">
                <span className="block text-sm font-semibold text-foreground">
                  Live Download Notifications
                </span>
                <span className="block text-[11px] text-muted-foreground">
                  Show live download progress and keep downloading after you exit the app.
                </span>
              </label>
              <Switch
                id="notif-downloads-switch"
                checked={notifPrefs.downloads}
                onCheckedChange={(checked) => updateNotifPref("downloads", checked)}
                aria-label="Live download notifications"
              />
            </div>

            <div className="border-t border-border/60 pt-2.5 flex items-center justify-between gap-3">
              <label htmlFor="notif-updates-switch" className="cursor-pointer">
                <span className="block text-sm font-semibold text-foreground">
                  App Update Alerts
                </span>
                <span className="block text-[11px] text-muted-foreground">
                  Notify you automatically when a new HutaoTik release is published.
                </span>
              </label>
              <Switch
                id="notif-updates-switch"
                checked={notifPrefs.updates}
                onCheckedChange={(checked) => updateNotifPref("updates", checked)}
                aria-label="App update notifications"
              />
            </div>

            <div className="border-t border-border/60 pt-2.5 flex items-center justify-between gap-3">
              <label htmlFor="notif-announcements-switch" className="cursor-pointer">
                <span className="block text-sm font-semibold text-foreground">
                  Announcement Alerts
                </span>
                <span className="block text-[11px] text-muted-foreground">
                  Notify you when new announcements or notices are posted to the lobby.
                </span>
              </label>
              <Switch
                id="notif-announcements-switch"
                checked={notifPrefs.announcements}
                onCheckedChange={(checked) => updateNotifPref("announcements", checked)}
                aria-label="Announcement notifications"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleSendTestNotification}
              className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border border-primary/40 bg-primary/10 px-3 text-xs font-bold text-primary transition-colors hover:bg-primary/20"
            >
              <BellRing className="h-3.5 w-3.5" />
              Send Test Notification
            </button>
            {notifStatus.granted && notifStatus.sdkInt > 0 && (
              <button
                type="button"
                onClick={openDeviceNotificationSettings}
                className="inline-flex h-9 items-center justify-center rounded-xl border border-border bg-background px-3 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                Channels
              </button>
            )}
          </div>
        </div>
      </details>

      <details className="animate-card-bounce-in settings-disclosure rounded-2xl border border-border bg-card px-4 shadow-sm" style={{ animationDelay: "320ms" }}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span>
            <span className="flex items-center gap-2 text-base font-semibold text-card-foreground">
              <HardDrive className="h-4 w-4 text-primary" />
              Storage &amp; Cache
              {cacheInfo && (
                <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-[10px] font-bold text-primary">
                  {cacheInfo.totalBytes > 0 ? formatStorageBytes(cacheInfo.totalBytes) : "Clean"}
                </span>
              )}
            </span>
            <span className="mt-1 block text-left text-xs font-normal text-muted-foreground">
              Inspect and clear temporary cache files and saved download history.
            </span>
          </span>
          <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300" />
        </summary>
        <div className="space-y-3 pb-4">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background p-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Cache &amp; History Size
              </p>
              <p className="mt-0.5 font-mono text-lg font-extrabold text-foreground">
                {loadingCache && !cacheInfo
                  ? "Scanning…"
                  : formatStorageBytes(cacheInfo?.totalBytes ?? 0)}
              </p>
              {cacheInfo && (
                <p className="text-[11px] text-muted-foreground">
                  {cacheInfo.isNative
                    ? `${cacheInfo.fileCount} temp file${cacheInfo.fileCount === 1 ? "" : "s"} · `
                    : ""}
                  {cacheInfo.historyCount} history item{cacheInfo.historyCount === 1 ? "" : "s"}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => void refreshCacheInfo()}
              disabled={loadingCache || clearingCache}
              aria-label="Refresh cache storage size"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loadingCache ? "animate-spin" : ""}`} />
            </button>
          </div>

          {cacheInfo && (
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-border bg-background/70 p-2.5">
                <p className="text-[10px] font-semibold text-muted-foreground">TaoCompress</p>
                <p className="mt-0.5 font-mono text-xs font-bold text-foreground">
                  {formatStorageBytes(cacheInfo.breakdown.compressedVideos)}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-background/70 p-2.5">
                <p className="text-[10px] font-semibold text-muted-foreground">Temp Downloads</p>
                <p className="mt-0.5 font-mono text-xs font-bold text-foreground">
                  {formatStorageBytes(cacheInfo.breakdown.tempDownloads)}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-background/70 p-2.5">
                <p className="text-[10px] font-semibold text-muted-foreground">Update APKs</p>
                <p className="mt-0.5 font-mono text-xs font-bold text-foreground">
                  {formatStorageBytes(cacheInfo.breakdown.updateApks)}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-background/70 p-2.5">
                <p className="text-[10px] font-semibold text-muted-foreground">Download History</p>
                <p className="mt-0.5 font-mono text-xs font-bold text-foreground">
                  {cacheInfo.historyCount} item{cacheInfo.historyCount === 1 ? "" : "s"} (
                  {formatStorageBytes(cacheInfo.breakdown.historyBytes)})
                </p>
              </div>
            </div>
          )}

          <p className="text-xs leading-relaxed text-muted-foreground">
            Clears temporary working files and your Download History list. Your saved videos, photos, preferences, and built-in downloader tools stay untouched.
          </p>

          <button
            type="button"
            onClick={() => void handleClearCache()}
            disabled={
              clearingCache ||
              (cacheInfo !== null &&
                cacheInfo.totalBytes === 0 &&
                cacheInfo.fileCount === 0 &&
                cacheInfo.historyCount === 0)
            }
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-4 text-xs font-bold text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {clearingCache ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Clearing Cache &amp; History…
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4" />
                Clear Cache &amp; Download History
              </>
            )}
          </button>
        </div>
      </details>
      </div>
    </div>
  );
}
