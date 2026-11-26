export const DROPDOWN_ANIMATIONS = ["smooth", "bounce", "slide", "fade", "none"] as const;

export type DropdownAnimation = (typeof DROPDOWN_ANIMATIONS)[number];

export const DROPDOWN_SPEEDS = ["slow", "normal", "fast"] as const;

export type DropdownSpeed = (typeof DROPDOWN_SPEEDS)[number];

const STORAGE_KEY = "hutaotik-dropdown-animation";
const SPEED_STORAGE_KEY = "hutaotik-dropdown-speed";
const SPEED_VARIABLES: Record<DropdownSpeed, [string, string, string, string]> = {
  slow: ["850ms", "260ms", "620ms", "75ms"],
  normal: ["560ms", "180ms", "420ms", "38ms"],
  fast: ["300ms", "110ms", "240ms", "18ms"],
};

export function loadDropdownAnimation(): DropdownAnimation {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return DROPDOWN_ANIMATIONS.find((animation) => animation === stored) ?? "smooth";
  } catch (error) {
    console.error("Could not load the saved dropdown animation.", error);
    return "smooth";
  }
}

export function saveDropdownAnimation(animation: DropdownAnimation): void {
  document.documentElement.dataset.dropdownAnimation = animation;
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
