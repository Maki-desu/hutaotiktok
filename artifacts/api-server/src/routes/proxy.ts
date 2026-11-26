import { Router, type IRouter } from "express";
import { Readable } from "stream";

const router: IRouter = Router();
const TIKTOK_MEDIA_DOMAINS = [
  "tiktok.com",
  "tiktokcdn.com",
  "tiktokcdn-us.com",
  "tiktokcdn-eu.com",
  "tiktokv.com",
  "byteoversea.com",
  "ibytedtos.com",
  "ibyteimg.com",
  "tikwm.com",
  "cobalt.tools",
];

function isAllowedMediaUrl(url: URL): boolean {
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
    return false;
  }

  const hostname = url.hostname.toLowerCase();
  if (TIKTOK_MEDIA_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
    return true;
  }

  const cobaltApiUrl = process.env.COBALT_API_URL?.trim();
  if (!cobaltApiUrl) return false;

  try {
    const configuredCobaltUrl = new URL(cobaltApiUrl);
    return configuredCobaltUrl.protocol === "https:" &&
      configuredCobaltUrl.hostname.toLowerCase() === hostname;
  } catch {
    return false;
  }
}

async function fetchMedia(url: URL): Promise<Response> {
  let currentUrl = url;

  for (let redirects = 0; redirects <= 5; redirects++) {
    if (!isAllowedMediaUrl(currentUrl)) {
      throw new Error("The media URL is not from an allowed TikTok download host.");
    }

    const response = await fetch(currentUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; HutaoTik/1.0)",
        "Referer": "https://www.tiktok.com/",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(90_000),
    });

    if (response.status < 300 || response.status >= 400) return response;

    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location) return response;
    if (redirects === 5) throw new Error("The media server returned too many redirects.");
    currentUrl = new URL(location, currentUrl);
  }

  throw new Error("The media server returned too many redirects.");
}

router.get("/proxy-download", async (req, res): Promise<void> => {
  const requestedUrl = req.query.url;
  const filename = typeof req.query.filename === "string" ? req.query.filename : "download";

  if (typeof requestedUrl !== "string" || !requestedUrl) {
    res.status(400).json({ error: "URL required" });
    return;
  }

  let targetUrl: string;
  try {
    targetUrl = new URL(requestedUrl).toString();
  } catch {
    res.status(400).json({ error: "Invalid URL" });
    return;
  }

  const safeFilename = (filename || "download").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
  try {
    const parsedUrl = new URL(targetUrl);
    if (!isAllowedMediaUrl(parsedUrl)) {
      res.status(400).json({ error: "Only TikTok media download URLs are supported." });
      return;
    }

    const upstream = await fetchMedia(parsedUrl);
    if (!upstream.ok || !upstream.body) {
      await upstream.body?.cancel();
      res.status(502).json({ error: "Failed to fetch resource from upstream" });
      return;
    }

    res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(safeFilename)}`
    );

    const contentLength = upstream.headers.get("content-length");
    if (contentLength) res.setHeader("Content-Length", contentLength);

    const nodeStream = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]);
    nodeStream.on("error", (err: Error) => {
      req.log.error({ err }, "proxy-download stream failed");
      if (res.headersSent) res.destroy(err);
      else res.status(502).json({ error: "Failed to stream resource from upstream" });
    });
    nodeStream.pipe(res);
  } catch (err) {
    req.log.warn({ err }, "proxy-download request failed");
    const status = err instanceof Error && err.name === "TimeoutError" ? 504 : 502;
    res.status(status).json({
      error: status === 504 ? "TikTok media download timed out." : "Failed to fetch resource from upstream",
    });
  }
});

export default router;
