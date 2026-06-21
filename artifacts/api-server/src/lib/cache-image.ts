import path from "path";
import fs from "fs";
import crypto from "crypto";

export const UPLOAD_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/**
 * Downloads an external image URL and saves it to the uploads folder.
 * Returns the local `/api/uploads/<filename>` path, or null if it fails.
 */
export async function cacheExternalImage(imageUrl: string): Promise<string | null> {
  if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) return null;
  try {
    const res = await fetch(imageUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; HutaoTik/1.0)" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok || !res.body) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) return null; // skip tiny/error responses
    const filename = crypto.randomBytes(14).toString("hex") + ".jpg";
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), buf);
    return `/api/uploads/${filename}`;
  } catch {
    return null;
  }
}

/** Returns true if the URL is already a locally-cached upload. */
export function isLocalUpload(url: string | null | undefined): boolean {
  return typeof url === "string" && url.startsWith("/api/uploads/");
}
