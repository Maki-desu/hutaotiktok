export const DROPDOWN_ANIMATIONS = ["smooth", "bounce", "slide", "fade", "none"] as const;

export type DropdownAnimation = (typeof DROPDOWN_ANIMATIONS)[number];

export const DROPDOWN_SPEEDS = ["slow", "normal", "fast"] as const;

export type DropdownSpeed = (typeof DROPDOWN_SPEEDS)[number];

const STORAGE_KEY = "hutaotik-dropdown-animation";
const SPEED_STORAGE_KEY = "hutaotik-dropdown-speed";
const BOUNCY_DEFAULT_MIGRATION_KEY = "hutaotik-bouncy-dropdown-v1";
const SPEED_VARIABLES: Record<DropdownSpeed, [string, string, string, string]> = {
  slow: ["520ms", "200ms", "380ms", "34ms"],
  normal: ["340ms", "150ms", "280ms", "22ms"],
  fast: ["220ms", "100ms", "180ms", "12ms"],
};

export function loadDropdownAnimation(): DropdownAnimation {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!localStorage.getItem(BOUNCY_DEFAULT_MIGRATION_KEY)) {
      localStorage.setItem(BOUNCY_DEFAULT_MIGRATION_KEY, "1");
      if (!stored || stored === "smooth") {
        localStorage.setItem(STORAGE_KEY, "bounce");
        return "bounce";
      }
    }
    return DROPDOWN_ANIMATIONS.find((animation) => animation === stored) ?? "bounce";
  } catch (error) {
    console.error("Could not load the saved dropdown animation.", error);
    return "bounce";
  }
}

export function saveDropdownAnimation(animation: DropdownAnimation): void {
  document.documentElement.dataset.dropdownAnimation = animation;
  localStorage.setItem(BOUNCY_DEFAULT_MIGRATION_KEY, "1");
  localStorage.setItem(STORAGE_KEY, animation);
}

export function loadDropdownSpeed(): DropdownSpeed {
  try {
    const stored = localStorage.getItem(SPEED_STORAGE_KEY);
    return DROPDOWN_SPEEDS.find((speed) => speed === stored) ?? "normal";
  } catch (error) {
    console.error("Could not load the saved dropdown speed.", error);
    return "normal";
  }
}

export function saveDropdownSpeed(speed: DropdownSpeed): void {
  localStorage.setItem(SPEED_STORAGE_KEY, speed);
  document.documentElement.dataset.dropdownSpeed = speed;
  const [openDuration, closeDuration, itemDuration, itemStagger] = SPEED_VARIABLES[speed];
  document.documentElement.style.setProperty("--dropdown-open-duration", openDuration);
  document.documentElement.style.setProperty("--dropdown-close-duration", closeDuration);
  document.documentElement.style.setProperty("--dropdown-item-duration", itemDuration);
  document.documentElement.style.setProperty("--dropdown-item-stagger", itemStagger);
}
