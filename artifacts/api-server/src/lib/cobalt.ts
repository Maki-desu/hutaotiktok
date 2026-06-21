import { Readable } from "stream";
import { logger } from "./logger";

const COBALT_API = "https://api.cobalt.tools/";

export interface CobaltResult {
  url: string;
  filename: string | null;
}

interface CobaltResponse {
  status: string;
  url?: string;
  filename?: string;
  picker?: Array<{ type: string; url: string; thumb?: string }>;
  error?: { code: string };
}

export async function cobaltFetch(
  url: string,
  opts: {
    downloadMode?: "auto" | "audio" | "mute";
    audioFormat?: string;
    videoQuality?: string;
  } = {}
): Promise<CobaltResult | null> {
  try {
    const res = await fetch(COBALT_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        url,
        downloadMode: opts.downloadMode ?? "auto",
        ...(opts.audioFormat ? { audioFormat: opts.audioFormat } : {}),
        ...(opts.videoQuality ? { videoQuality: opts.videoQuality } : {}),
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      logger.warn({ status: res.status, url }, "cobalt: non-ok");
      return null;
    }

    const data = (await res.json()) as CobaltResponse;

    if (data.status === "redirect" || data.status === "tunnel") {
      return data.url ? { url: data.url, filename: data.filename ?? null } : null;
    }

    if (data.status === "picker" && data.picker?.length) {
      const item = data.picker.find((p) => p.type === "video") ?? data.picker[0];
      return { url: item.url, filename: null };
    }

    logger.warn({ status: data.status, error: data.error, url }, "cobalt: unhandled status");
    return null;
  } catch (err) {
    logger.error({ err, url }, "cobalt: fetch error");
    return null;
  }
}

/**
 * Fetches a cobalt audio URL and streams it to an Express response as MP3.
 */
export async function streamCobaltAudio(
  cobaltResult: CobaltResult,
  res: import("express").Response,
  filename: string
): Promise<void> {
  const upstream = await fetch(cobaltResult.url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; HutaoTik/1.0)" },
    signal: AbortSignal.timeout(90_000),
  });

  if (!upstream.ok || !upstream.body) {
    res.status(502).json({ error: "Audio stream unavailable" });
    return;
  }

  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
  );
  const cl = upstream.headers.get("content-length");
  if (cl) res.setHeader("Content-Length", cl);

  const nodeStream = Readable.fromWeb(
    upstream.body as Parameters<typeof Readable.fromWeb>[0]
  );
  nodeStream.pipe(res);
  nodeStream.on("error", () => {
    if (!res.headersSent) res.status(500).end();
  });
}
