import { Router, type IRouter } from "express";
import { Readable } from "stream";

const router: IRouter = Router();

router.get("/proxy-download", async (req, res): Promise<void> => {
  const url = req.query.url as string;
  const filename = req.query.filename as string;

  if (!url) {
    res.status(400).json({ error: "URL required" });
    return;
  }

  let targetUrl: string;
  try {
    targetUrl = decodeURIComponent(url);
  } catch {
    res.status(400).json({ error: "Invalid URL" });
    return;
  }

  const upstream = await fetch(targetUrl, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });

  if (!upstream.ok) {
    res.status(502).json({ error: "Failed to fetch resource from upstream" });
    return;
  }

  const contentType = upstream.headers.get("content-type") || "application/octet-stream";
  const safeFilename = (filename || "download").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");

  res.setHeader("Content-Type", contentType);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename*=UTF-8''${encodeURIComponent(safeFilename)}`
  );

  const cl = upstream.headers.get("content-length");
  if (cl) res.setHeader("Content-Length", cl);

  if (!upstream.body) {
    res.status(502).json({ error: "No body from upstream" });
    return;
  }

  const nodeStream = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]);
  nodeStream.pipe(res);
  nodeStream.on("error", () => res.end());
});

export default router;
