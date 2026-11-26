export type BrandingImageKey = "banner" | "logo" | "launcherIcon";
export type BrandingImages = Record<BrandingImageKey, string | null>;

const DATABASE_NAME = "hutaotik-branding";
const STORE_NAME = "images";
const IMAGE_KEYS: BrandingImageKey[] = ["banner", "logo", "launcherIcon"];
const MAX_IMAGE_SIZE = 3 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const CHANGE_EVENT = "hutaotik-branding-change";

let databasePromise: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (!("indexedDB" in window)) {
    return Promise.reject(new Error("Image storage is not available in this browser."));
  }
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Could not open image storage."));
      request.onblocked = () => reject(new Error("Image storage is blocked by another open app tab."));
    });
  }
  return databasePromise;
}

function readImage(file: File): Promise<string> {
  if (!IMAGE_TYPES.has(file.type)) {
    return Promise.reject(new Error("Choose a PNG, JPG, or WebP image."));
  }
  if (file.size > MAX_IMAGE_SIZE) {
    return Promise.reject(new Error("Choose an image smaller than 3 MB."));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Could not read this image."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read this image."));
    reader.readAsDataURL(file);
  });
}

function notifyBrandingChanged(): void {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export async function loadBrandingImages(): Promise<BrandingImages> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const result: BrandingImages = { banner: null, logo: null, launcherIcon: null };
    let remaining = IMAGE_KEYS.length;

    for (const key of IMAGE_KEYS) {
      const request = store.get(key);
      request.onsuccess = () => {
        result[key] = typeof request.result === "string" ? request.result : null;
        remaining -= 1;
        if (remaining === 0) resolve(result);
      };
      request.onerror = () => reject(request.error ?? new Error("Could not load saved images."));
    }
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not load saved images."));
  });
}

export async function saveBrandingImage(key: BrandingImageKey, file: File | null): Promise<string | null> {
  const database = await openDatabase();
  const image = file ? await readImage(file) : null;
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = image ? store.put(image, key) : store.delete(key);
    request.onsuccess = () => {
      notifyBrandingChanged();
      resolve(image);
    };
    request.onerror = () => reject(request.error ?? new Error("Could not save this image."));
  });
}

export function onBrandingChanged(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}
