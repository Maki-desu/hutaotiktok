import { Router, type IRouter } from "express";

const router: IRouter = Router();

const ALLOWED_HOSTS = [
  "tiktok.com",
  "www.tiktok.com",
  "vm.tiktok.com",
  "vt.tiktok.com",
  "m.tiktok.com",
];

router.get("/redirect", (req, res): void => {
  const raw = req.query.url as string | undefined;

  if (!raw) {
    res.status(400).send("Missing url parameter");
    return;
  }

  let target: URL;
  try {
    const decoded = decodeURIComponent(raw);
    target = new URL(decoded.startsWith("http") ? decoded : `https://${decoded}`);
  } catch {
    res.status(400).send("Invalid URL");
    return;
  }

  if (!ALLOWED_HOSTS.includes(target.hostname)) {
    res.status(403).send("Redirect target not allowed");
    return;
  }

  res.redirect(302, target.toString());
});

export default router;
