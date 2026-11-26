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

export function getLocalHistory(): LocalHistoryRecord[] {
  try {
    const raw = localStorage.getItem("hutaotik_local_history");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveLocalHistoryRecord(record: Omit<LocalHistoryRecord, "id" | "downloadedAt">): LocalHistoryRecord {
  const history = getLocalHistory();
  const newRecord: LocalHistoryRecord = {
    ...record,
    id: String(Date.now()) + "_" + Math.random().toString(36).substring(2, 7),
    downloadedAt: new Date().toISOString(),
  };

  // Prepend new record & filter duplicates
  const updated = [
    newRecord,
    ...history.filter(
      (r) => !(r.sourceUrl === record.sourceUrl && r.quality === record.quality)
    ),
  ].slice(0, 100);

  try {
    localStorage.setItem("hutaotik_local_history", JSON.stringify(updated));
  } catch {
    /* ignore storage full */
  }

  return newRecord;
}

export function clearLocalHistory(): void {
  localStorage.removeItem("hutaotik_local_history");
}
