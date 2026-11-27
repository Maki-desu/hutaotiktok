export interface LocalHistoryRecord {
  id: string;
  title: string;
  author: string;
  authorUsername: string;
  thumbnail: string | null;
  quality: string;
  sourceUrl: string;
  downloadUrl?: string | null;
  platform: "tiktok" | "youtube" | "facebook" | "twitter" | "pinterest" | "instagram";
  downloadedAt: string;
}

export const LOCAL_HISTORY_KEY = "hutaotik_local_history";
const HISTORY_CHANGED_EVENT = "hutaotik:history-changed";

function notifyHistoryChanged(): void {
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new Event(HISTORY_CHANGED_EVENT));
  }
}

export function onLocalHistoryChanged(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(HISTORY_CHANGED_EVENT, listener);
  return () => window.removeEventListener(HISTORY_CHANGED_EVENT, listener);
}

export function getLocalHistory(): LocalHistoryRecord[] {
  try {
    const raw = localStorage.getItem(LOCAL_HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LocalHistoryRecord[]) : [];
  } catch {
    return [];
  }
}

export function getLocalHistoryBytes(): number {
  try {
    const raw = localStorage.getItem(LOCAL_HISTORY_KEY);
    if (!raw) return 0;
    return typeof TextEncoder !== "undefined" ? new TextEncoder().encode(raw).length : raw.length * 2;
  } catch {
    return 0;
  }
}

export function saveLocalHistoryRecord(
  record: Omit<LocalHistoryRecord, "id" | "downloadedAt">,
): LocalHistoryRecord {
  const history = getLocalHistory();
  const newRecord: LocalHistoryRecord = {
    ...record,
    id: String(Date.now()) + "_" + Math.random().toString(36).substring(2, 7),
    downloadedAt: new Date().toISOString(),
  };

  // Prepend new record & deduplicate by sourceUrl + quality
  const updated = [
    newRecord,
    ...history.filter(
      (r) => !(r.sourceUrl === record.sourceUrl && r.quality === record.quality),
    ),
  ].slice(0, 100);

  try {
    localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(updated));
    notifyHistoryChanged();
  } catch {
    /* ignore storage full */
  }

  return newRecord;
}

export function removeLocalHistoryRecord(id: string): LocalHistoryRecord[] {
  const updated = getLocalHistory().filter((r) => r.id !== id);
  try {
    if (updated.length === 0) {
      localStorage.removeItem(LOCAL_HISTORY_KEY);
    } else {
      localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(updated));
    }
    notifyHistoryChanged();
  } catch {
    /* ignore */
  }
  return updated;
}

export function clearLocalHistory(): void {
  try {
    localStorage.removeItem(LOCAL_HISTORY_KEY);
    notifyHistoryChanged();
  } catch {
    /* ignore */
  }
}
