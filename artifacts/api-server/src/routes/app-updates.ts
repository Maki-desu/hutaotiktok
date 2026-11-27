import { Router, type IRouter, type RequestHandler } from "express";
import crypto from "crypto";
import fs from "fs";
import https from "https";
import multer from "multer";
import path from "path";
import { desc, eq, sql } from "drizzle-orm";
import {
  db,
  appReleasesTable,
  appUpdateDevicesTable,
  appInstallationsTable,
  type AppRelease,
} from "@workspace/db";
import { requireAdmin } from "../middlewares/admin";
import { logger } from "../lib/logger";
import { notifyAppUpdateDevices, type PushResult } from "../lib/push-notifications";

const router: IRouter = Router();
const DEFAULT_APP_VERSION_CODE = 48;
const DEFAULT_APP_VERSION_NAME = "1.2.32";
const MAX_APK_UPLOAD_BYTES = 250 * 1024 * 1024;
const APK_STORAGE_DIR = path.resolve(
  process.env.APK_STORAGE_DIR || path.join(process.cwd(), "uploads", "app-releases"),
);
if (!fs.existsSync(APK_STORAGE_DIR)) {
  fs.mkdirSync(APK_STORAGE_DIR, { recursive: true });
}

const apkStorage = multer.diskStorage({
  destination(_req, _file, cb) {
    try {
      if (!fs.existsSync(APK_STORAGE_DIR)) {
        fs.mkdirSync(APK_STORAGE_DIR, { recursive: true });
      }
      cb(null, APK_STORAGE_DIR);
    } catch (err) {
      cb(
        err instanceof Error ? err : new Error("Could not prepare APK storage directory."),
        APK_STORAGE_DIR,
      );
    }
  },
  filename(_req, _file, cb) {
    cb(null, `hutaotik-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.apk`);
  },
});

const apkUpload = multer({
  storage: apkStorage,
  limits: {
    fileSize: MAX_APK_UPLOAD_BYTES,
    files: 1,
  },
  fileFilter(_req, file, cb) {
    const lowerName = (file.originalname || "").toLowerCase();
    const lowerMime = (file.mimetype || "").toLowerCase();
    const allowed =
      lowerName.endsWith(".apk") ||
      lowerMime === "application/vnd.android.package-archive" ||
      lowerMime === "application/octet-stream" ||
      lowerMime === "application/zip";
    if (!allowed) {
      cb(new Error("Please upload a valid Android .apk file."));
      return;
    }
    cb(null, true);
  },
});

const handleOptionalApkUpload: RequestHandler = (req, res, next) => {
  if (!req.is("multipart/form-data")) {
    next();
    return;
  }
  apkUpload.single("apk")(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({ error: "APK file is too large (maximum size is 250 MB)." });
        return;
      }
      res.status(400).json({ error: `APK upload error: ${err.message}` });
      return;
    }
    res.status(400).json({
      error: err instanceof Error ? err.message : "Could not process uploaded APK file.",
    });
  });
};

async function safeUnlink(filePath: string | null | undefined): Promise<void> {
  if (!filePath) return;
  try {
    await fs.promises.unlink(filePath);
  } catch {
    /* ignore missing file */
  }
}

async function isZipMagic(filePath: string): Promise<boolean> {
  const handle = await fs.promises.open(filePath, "r");
  try {
    const header = Buffer.alloc(4);
    const { bytesRead } = await handle.read(header, 0, 4, 0);
    return (
      bytesRead === 4 &&
      header[0] === 0x50 &&
      header[1] === 0x4b &&
      header[2] === 0x03 &&
      header[3] === 0x04
    );
  } finally {
    await handle.close();
  }
}

async function computeFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

function streamFileToHttpsUrl(
  targetUrl: string,
  filePath: string,
  fileSize: number,
  headers: Record<string, string>,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const req = https.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: `${parsed.pathname}${parsed.search}`,
        method: "POST",
        headers: {
          ...headers,
          "Content-Length": String(fileSize),
        },
        timeout: 180_000,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          let parsedBody: Record<string, unknown> = {};
          try {
            const raw: unknown = JSON.parse(body);
            if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
              parsedBody = raw as Record<string, unknown>;
            }
          } catch {
            /* ignore non-json error body */
          }
          if (status >= 200 && status < 300) {
            resolve(parsedBody);
          } else {
            const msg =
              typeof parsedBody.message === "string"
                ? parsedBody.message
                : `HTTP ${status}`;
            reject(new Error(`GitHub asset upload failed (${msg}).`));
          }
        });
      },
    );

    req.on("timeout", () => {
      req.destroy(new Error("GitHub asset upload timed out."));
    });
    req.on("error", reject);

    const stream = fs.createReadStream(filePath);
    stream.on("error", (err) => {
      req.destroy(err);
      reject(err);
    });
    stream.pipe(req);
  });
}

async function uploadApkToGitHubRelease(params: {
  filePath: string;
  fileSize: number;
  versionName: string;
  title: string;
  changelog: string;
}): Promise<string> {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    throw new Error("GITHUB_TOKEN is not configured.");
  }
  const repo = process.env.GITHUB_REPO?.trim() || "Maki-desu/hutaotiktok";
  const safeVersion = params.versionName.replace(/[^0-9A-Za-z._-]/g, "-");
  const tag = safeVersion.startsWith("v") ? safeVersion : `v${safeVersion}`;
  const assetName = `Hutaotik-${tag}.apk`;

  const ghHeaders: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "Hutaotik-API",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  type GitHubReleasePayload = {
    id?: number;
    upload_url?: string;
    assets?: Array<{ id: number; name: string }>;
  };

  let releaseData: GitHubReleasePayload | null = null;

  const existingResp = await fetch(
    `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`,
    { headers: ghHeaders },
  );

  if (existingResp.ok) {
    releaseData = (await existingResp.json()) as GitHubReleasePayload;
  } else if (existingResp.status === 404) {
    const createResp = await fetch(`https://api.github.com/repos/${repo}/releases`, {
      method: "POST",
      headers: {
        ...ghHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tag_name: tag,
        name: params.title ? `HutaoTik ${tag} — ${params.title}` : `HutaoTik ${tag}`,
        body: params.changelog,
        draft: false,
        prerelease: false,
      }),
    });
    if (!createResp.ok) {
      const errText = await createResp.text().catch(() => "");
      throw new Error(`Could not create GitHub release ${tag} (HTTP ${createResp.status}): ${errText.slice(0, 160)}`);
    }
    releaseData = (await createResp.json()) as GitHubReleasePayload;
  } else {
    throw new Error(`Could not query GitHub releases (HTTP ${existingResp.status}).`);
  }

  const rawUploadUrl = releaseData?.upload_url;
  if (!rawUploadUrl) {
    throw new Error("GitHub release did not return an upload URL.");
  }

  const existingAsset = releaseData?.assets?.find((asset) => asset.name === assetName);
  if (existingAsset) {
    await fetch(`https://api.github.com/repos/${repo}/releases/assets/${existingAsset.id}`, {
      method: "DELETE",
      headers: ghHeaders,
    }).catch(() => {});
  }

  const uploadBase = rawUploadUrl.replace(/\{[^}]*\}$/, "");
  const uploadTarget = `${uploadBase}?name=${encodeURIComponent(assetName)}`;
  const uploadedAsset = await streamFileToHttpsUrl(uploadTarget, params.filePath, params.fileSize, {
    ...ghHeaders,
    "Content-Type": "application/vnd.android.package-archive",
  });

  const downloadUrl = uploadedAsset.browser_download_url;
  if (typeof downloadUrl !== "string" || !downloadUrl.startsWith("https://")) {
    throw new Error("GitHub asset upload did not return a download URL.");
  }
  return downloadUrl;
}

async function notifyDevices(
  versionCode: number,
  versionName: string,
  title?: string,
): Promise<PushResult> {
  return notifyAppUpdateDevices(versionCode, versionName, title);
}

function serializeRelease(release: AppRelease, currentVersionCode?: number | null) {
  const forcedByMinVersion =
    release.minSupportedVersionCode != null &&
    currentVersionCode != null &&
    currentVersionCode < release.minSupportedVersionCode;

  return {
    id: release.id,
    versionCode: release.versionCode,
    versionName: release.versionName,
    title: release.title || "",
    changelog: release.changelog,
    downloadUrl: release.downloadUrl ?? `/api/app-updates/${release.id}/download`,
    hasUploadedApk: Boolean(release.fileName),
    fileSize: release.fileSize,
    sha256: release.sha256,
    isMandatory: release.isMandatory || forcedByMinVersion,
    minSupportedVersionCode: release.minSupportedVersionCode,
    isActive: release.isActive,
    downloadCount: release.downloadCount,
    createdAt: release.createdAt.toISOString(),
    updatedAt: release.updatedAt.toISOString(),
  };
}

function validateHttpsDownloadUrl(raw: unknown): { url?: string; error?: string } {
  if (typeof raw !== "string" || raw.trim().length === 0 || raw.trim().length > 2048) {
    return { error: "Enter a valid public HTTPS update link." };
  }
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { error: "Enter a valid public HTTPS update link." };
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username.length > 0 ||
    parsed.password.length > 0
  ) {
    return { error: "The APK download link must use HTTPS and cannot contain credentials." };
  }
  return { url: parsed.toString() };
}

function validateOptionalSha256(raw: unknown): { value?: string | null; error?: string } {
  if (raw === undefined || raw === null) return { value: null };
  if (typeof raw !== "string") return { error: "SHA-256 must be a 64-character hex string." };
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0) return { value: null };
  if (!/^[0-9a-f]{64}$/.test(trimmed)) {
    return { error: "SHA-256 must be a valid 64-character hex checksum." };
  }
  return { value: trimmed };
}

function bumpPatchVersion(previousVersionName: string): string | null {
  if (!/^[0-9]+(?:\.[0-9]+)*$/.test(previousVersionName)) return null;
  const segments = previousVersionName.split(".");
  const lastSegment = Number(segments[segments.length - 1]);
  if (!Number.isSafeInteger(lastSegment) || lastSegment >= Number.MAX_SAFE_INTEGER) {
    return null;
  }
  segments[segments.length - 1] = String(lastSegment + 1);
  return segments.join(".");
}

function pushWarning(push: PushResult): string | undefined {
  if (push.status === "not_configured") {
    return "Release is live in the database. HutaoTik devices will notify users automatically via background sync and on app open (optionally add FIREBASE_SERVICE_ACCOUNT_JSON for instant FCM push).";
  }
  if (push.status === "failed" || push.status === "partial") {
    return "Release is live in the database, but not all instant FCM push alerts were delivered.";
  }
  return undefined;
}

/* ── Public Release Endpoints ──────────────────────────────── */

router.get("/app-updates/latest", async (req, res): Promise<void> => {
  const [release] = await db
    .select()
    .from(appReleasesTable)
    .where(eq(appReleasesTable.isActive, true))
    .orderBy(desc(appReleasesTable.versionCode))
    .limit(1);

  if (!release) {
    res.status(404).json({ error: "No active Hutaotik update has been published." });
    return;
  }

  const rawCurrent = typeof req.query.currentVersionCode === "string"
    ? Number.parseInt(req.query.currentVersionCode, 10)
    : null;
  const currentVersionCode =
    rawCurrent !== null && Number.isSafeInteger(rawCurrent) && rawCurrent > 0
      ? rawCurrent
      : null;

  res.json(serializeRelease(release, currentVersionCode));
});

router.get("/app-updates/history", async (_req, res): Promise<void> => {
  const releases = await db
    .select()
    .from(appReleasesTable)
    .where(eq(appReleasesTable.isActive, true))
    .orderBy(desc(appReleasesTable.versionCode))
    .limit(25);

  res.json({
    releases: releases.map((release) => serializeRelease(release)),
  });
});

router.get("/app-updates/:id/download", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) {
    res.status(400).json({ error: "Invalid release ID." });
    return;
  }

  const [release] = await db
    .select()
    .from(appReleasesTable)
    .where(eq(appReleasesTable.id, id))
    .limit(1);

  if (!release) {
    res.status(404).json({ error: "Release not found." });
    return;
  }

  if (!release.fileName) {
    res.status(404).json({ error: "This release uses an external APK download link." });
    return;
  }

  const apkPath = path.join(APK_STORAGE_DIR, path.basename(release.fileName));
  if (!fs.existsSync(apkPath)) {
    res.status(404).json({
      error:
        "The uploaded APK file is no longer on this server's temporary disk. Re-upload it in Hutaotik Admin or set GITHUB_TOKEN on Render for permanent hosting.",
    });
    return;
  }

  void db
    .update(appReleasesTable)
    .set({
      downloadCount: sql`${appReleasesTable.downloadCount} + 1`,
    })
    .where(eq(appReleasesTable.id, id))
    .catch((err) => {
      logger.warn({ err, releaseId: id }, "Could not increment APK download count.");
    });

  res.setHeader("Content-Type", "application/vnd.android.package-archive");
  res.download(apkPath, `Hutaotik-${release.versionName}.apk`);
});

router.post("/app-updates/:id/track-download", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) {
    res.status(400).json({ error: "Invalid release ID." });
    return;
  }

  const updated = await db
    .update(appReleasesTable)
    .set({
      downloadCount: sql`${appReleasesTable.downloadCount} + 1`,
    })
    .where(eq(appReleasesTable.id, id))
    .returning({ id: appReleasesTable.id });

  if (updated.length === 0) {
    res.status(404).json({ error: "Release not found." });
    return;
  }

  res.status(204).end();
});

router.post("/app-updates/check-in", async (req, res): Promise<void> => {
  const installId = req.body?.installId;
  const versionCode = Number(req.body?.versionCode);
  const versionName = req.body?.versionName;
  const platform = typeof req.body?.platform === "string" ? req.body.platform.trim().slice(0, 32) : "android";
  const deviceModel = typeof req.body?.deviceModel === "string"
    ? req.body.deviceModel.trim().slice(0, 120) || null
    : null;
  const androidVersion = typeof req.body?.androidVersion === "string"
    ? req.body.androidVersion.trim().slice(0, 40) || null
    : null;

  if (
    typeof installId !== "string" ||
    !/^[A-Za-z0-9_-]{8,80}$/.test(installId) ||
    !Number.isSafeInteger(versionCode) ||
    versionCode < 1 ||
    versionCode > 2_147_483_647 ||
    typeof versionName !== "string" ||
    versionName.trim().length === 0 ||
    versionName.trim().length > 32
  ) {
    res.status(400).json({ error: "Invalid device check-in payload." });
    return;
  }

  const now = new Date();
  await db
    .insert(appInstallationsTable)
    .values({
      installId,
      versionCode,
      versionName: versionName.trim(),
      platform: platform || "android",
      deviceModel,
      androidVersion,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: appInstallationsTable.installId,
      set: {
        versionCode,
        versionName: versionName.trim(),
        platform: platform || "android",
        deviceModel,
        androidVersion,
        lastSeenAt: now,
      },
    });

  res.status(204).end();
});

router.post("/app-updates/register-device", async (req, res): Promise<void> => {
  const token = req.body?.token;
  if (
    typeof token !== "string" ||
    token.length < 20 ||
    Buffer.byteLength(token, "utf8") > 2000 ||
    /[\u0000-\u001f\u007f]/.test(token)
  ) {
    res.status(400).json({ error: "A valid Firebase device token is required." });
    return;
  }

  const now = new Date();
  await db
    .insert(appUpdateDevicesTable)
    .values({ token, lastSeenAt: now })
    .onConflictDoUpdate({
      target: appUpdateDevicesTable.token,
      set: { lastSeenAt: now },
    });

  res.status(204).end();
});

/* ── Admin Release Database Endpoints ──────────────────────── */

router.get("/admin/app-updates", requireAdmin, async (_req, res): Promise<void> => {
  const [releases, installations, pushTokens] = await Promise.all([
    db
      .select()
      .from(appReleasesTable)
      .orderBy(desc(appReleasesTable.versionCode)),
    db.select().from(appInstallationsTable),
    db.select({ token: appUpdateDevicesTable.token }).from(appUpdateDevicesTable),
  ]);

  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

  const latestActiveRelease = releases.find((r) => r.isActive) ?? null;
  const latestActiveVersionCode = latestActiveRelease?.versionCode ?? null;

  let activeLast7Days = 0;
  let activeLast30Days = 0;
  let upToDateCount = 0;
  let outdatedCount = 0;

  const versionMap = new Map<number, { versionCode: number; versionName: string; count: number }>();

  for (const device of installations) {
    const ageMs = now - device.lastSeenAt.getTime();
    if (ageMs <= sevenDaysMs) activeLast7Days += 1;
    if (ageMs <= thirtyDaysMs) activeLast30Days += 1;

    if (latestActiveVersionCode !== null) {
      if (device.versionCode >= latestActiveVersionCode) upToDateCount += 1;
      else outdatedCount += 1;
    }

    const existing = versionMap.get(device.versionCode);
    if (existing) {
      existing.count += 1;
    } else {
      versionMap.set(device.versionCode, {
        versionCode: device.versionCode,
        versionName: device.versionName,
        count: 1,
      });
    }
  }

  const versionBreakdown = Array.from(versionMap.values()).sort(
    (a, b) => b.versionCode - a.versionCode,
  );
  const totalDownloads = releases.reduce((sum, release) => sum + release.downloadCount, 0);

  res.json({
    releases: releases.map((release) => serializeRelease(release)),
    stats: {
      totalDevices: installations.length,
      activeLast7Days,
      activeLast30Days,
      pushTokenCount: pushTokens.length,
      firebaseConfigured: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON),
      githubUploadConfigured: Boolean(process.env.GITHUB_TOKEN?.trim()),
      latestActiveVersionCode,
      latestActiveVersionName: latestActiveRelease?.versionName ?? null,
      upToDateCount,
      outdatedCount,
      totalDownloads,
      versionBreakdown,
    },
  });
});

router.post(
  "/admin/app-updates",
  requireAdmin,
  handleOptionalApkUpload,
  async (req, res): Promise<void> => {
    const uploadedFile = req.file;
    let shouldCleanupUpload = Boolean(uploadedFile);
    const cleanupUploadedFile = async () => {
      if (shouldCleanupUpload && uploadedFile?.path) {
        shouldCleanupUpload = false;
        await safeUnlink(uploadedFile.path);
      }
    };

    try {
      const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
      const changelog = req.body?.changelog;
      const isMandatory = req.body?.isMandatory === true || req.body?.isMandatory === "true";
      const isActive = req.body?.isActive !== false && req.body?.isActive !== "false";
      const sendPush = req.body?.sendPush !== false && req.body?.sendPush !== "false";

      if (
        title.length > 120 ||
        typeof changelog !== "string" ||
        changelog.trim().length === 0 ||
        changelog.length > 5000
      ) {
        await cleanupUploadedFile();
        res.status(400).json({ error: "Enter a valid release announcement (1–5000 characters)." });
        return;
      }

      const rawDownloadUrl =
        typeof req.body?.downloadUrl === "string" ? req.body.downloadUrl.trim() : "";

      if (!uploadedFile && rawDownloadUrl.length === 0) {
        res.status(400).json({
          error: "Upload an .apk file or enter a valid public HTTPS update link.",
        });
        return;
      }

      let validatedExternalUrl: string | null = null;
      if (!uploadedFile) {
        const urlCheck = validateHttpsDownloadUrl(rawDownloadUrl);
        if (urlCheck.error || !urlCheck.url) {
          res.status(400).json({ error: urlCheck.error ?? "Invalid HTTPS download URL." });
          return;
        }
        validatedExternalUrl = urlCheck.url;
      }

      const shaCheck = validateOptionalSha256(req.body?.sha256);
      if (shaCheck.error) {
        await cleanupUploadedFile();
        res.status(400).json({ error: shaCheck.error });
        return;
      }

      let minSupportedVersionCode: number | null = null;
      if (
        req.body?.minSupportedVersionCode !== undefined &&
        req.body?.minSupportedVersionCode !== null &&
        req.body?.minSupportedVersionCode !== ""
      ) {
        const parsedMin = Number(req.body.minSupportedVersionCode);
        if (!Number.isSafeInteger(parsedMin) || parsedMin < 1 || parsedMin > 2_147_483_647) {
          await cleanupUploadedFile();
          res.status(400).json({ error: "Minimum supported version code must be a positive integer." });
          return;
        }
        minSupportedVersionCode = parsedMin;
      }

      let fileSize: number | null = null;
      if (
        !uploadedFile &&
        req.body?.fileSize !== undefined &&
        req.body?.fileSize !== null &&
        req.body?.fileSize !== ""
      ) {
        const parsedSize = Number(req.body.fileSize);
        if (!Number.isSafeInteger(parsedSize) || parsedSize < 1) {
          res.status(400).json({ error: "File size must be a positive integer in bytes." });
          return;
        }
        fileSize = parsedSize;
      }

      const [latest] = await db
        .select({
          versionCode: appReleasesTable.versionCode,
          versionName: appReleasesTable.versionName,
        })
        .from(appReleasesTable)
        .orderBy(desc(appReleasesTable.versionCode))
        .limit(1);

      let versionCode: number;
      if (
        req.body?.versionCode !== undefined &&
        req.body?.versionCode !== null &&
        req.body?.versionCode !== ""
      ) {
        const parsedCode = Number(req.body.versionCode);
        if (!Number.isSafeInteger(parsedCode) || parsedCode < 1 || parsedCode > 2_147_483_647) {
          await cleanupUploadedFile();
          res.status(400).json({ error: "Version code must be a valid positive integer." });
          return;
        }
        const [duplicate] = await db
          .select({ id: appReleasesTable.id })
          .from(appReleasesTable)
          .where(eq(appReleasesTable.versionCode, parsedCode))
          .limit(1);
        if (duplicate) {
          await cleanupUploadedFile();
          res.status(409).json({
            error: `Version code ${parsedCode} already exists in the release database. Choose a higher version code or edit the existing release.`,
          });
          return;
        }
        versionCode = parsedCode;
      } else {
        const baseCode = Math.max(latest?.versionCode ?? 0, DEFAULT_APP_VERSION_CODE);
        if (baseCode >= 2_147_483_647) {
          await cleanupUploadedFile();
          res.status(409).json({ error: "The Android version code limit has been reached." });
          return;
        }
        versionCode = baseCode + 1;
      }

      let versionName: string;
      if (typeof req.body?.versionName === "string" && req.body.versionName.trim().length > 0) {
        const candidate = req.body.versionName.trim();
        if (!/^[0-9A-Za-z._-]{1,32}$/.test(candidate)) {
          await cleanupUploadedFile();
          res.status(400).json({
            error: "Version name can only contain letters, numbers, dots, underscores, and hyphens.",
          });
          return;
        }
        versionName = candidate;
      } else {
        const previousVersionName = latest?.versionName ?? DEFAULT_APP_VERSION_NAME;
        const bumped = bumpPatchVersion(previousVersionName);
        if (!bumped) {
          await cleanupUploadedFile();
          res.status(409).json({ error: "Could not automatically generate the next app version name." });
          return;
        }
        versionName = bumped;
      }

      let finalDownloadUrl: string | null = validatedExternalUrl;
      let finalFileName: string | null = null;
      let finalSha256: string | null = shaCheck.value ?? null;
      let storageMode: "external" | "server" | "github" = "external";
      let storageWarning: string | undefined;

      if (uploadedFile) {
        if (uploadedFile.size <= 0 || !(await isZipMagic(uploadedFile.path))) {
          await cleanupUploadedFile();
          res.status(400).json({
            error: "Uploaded file is not a valid Android .apk package.",
          });
          return;
        }

        const computedSha256 = await computeFileSha256(uploadedFile.path);
        if (shaCheck.value && shaCheck.value !== computedSha256) {
          await cleanupUploadedFile();
          res.status(400).json({
            error: "The provided SHA-256 does not match the uploaded APK file.",
          });
          return;
        }

        fileSize = uploadedFile.size;
        finalSha256 = computedSha256;

        if (process.env.GITHUB_TOKEN?.trim()) {
          try {
            finalDownloadUrl = await uploadApkToGitHubRelease({
              filePath: uploadedFile.path,
              fileSize: uploadedFile.size,
              versionName,
              title,
              changelog: changelog.trim(),
            });
            finalFileName = null;
            storageMode = "github";
            await cleanupUploadedFile();
          } catch (githubError) {
            logger.error({ err: githubError }, "GitHub Release mirror failed; falling back to local API hosting.");
            finalDownloadUrl = null;
            finalFileName = uploadedFile.filename;
            storageMode = "server";
            shouldCleanupUpload = false;
            storageWarning =
              "GitHub Release auto-mirror failed, so the APK is temporarily hosted on the Render API server instead.";
          }
        } else {
          finalDownloadUrl = null;
          finalFileName = uploadedFile.filename;
          storageMode = "server";
          shouldCleanupUpload = false;
        }
      }

      const now = new Date();
      const [release] = await db
        .insert(appReleasesTable)
        .values({
          versionCode,
          versionName,
          title,
          changelog: changelog.trim(),
          downloadUrl: finalDownloadUrl,
          fileName: finalFileName,
          fileSize,
          sha256: finalSha256,
          isMandatory,
          minSupportedVersionCode,
          isActive,
          updatedAt: now,
        })
        .returning();

      const push: PushResult =
        isActive && sendPush
          ? await notifyDevices(versionCode, versionName, title)
          : { status: "skipped", deviceCount: 0, deliveredCount: 0 };

      const warnings = [storageWarning, pushWarning(push)].filter(
        (entry): entry is string => Boolean(entry),
      );

      res.status(201).json({
        release: serializeRelease(release),
        push,
        storageMode,
        ...(warnings.length > 0 ? { warning: warnings.join(" ") } : {}),
      });
    } catch (error) {
      await cleanupUploadedFile();
      logger.error({ err: error }, "Failed to publish app update.");
      res.status(500).json({ error: "Could not publish the app update. Please try again." });
    }
  },
);

router.patch("/admin/app-updates/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) {
    res.status(400).json({ error: "Invalid release ID." });
    return;
  }

  const updates: Partial<typeof appReleasesTable.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (req.body?.title !== undefined) {
    if (typeof req.body.title !== "string" || req.body.title.trim().length > 120) {
      res.status(400).json({ error: "Release title must be 120 characters or fewer." });
      return;
    }
    updates.title = req.body.title.trim();
  }

  if (req.body?.versionName !== undefined) {
    if (
      typeof req.body.versionName !== "string" ||
      !/^[0-9A-Za-z._-]{1,32}$/.test(req.body.versionName.trim())
    ) {
      res.status(400).json({ error: "Invalid version name." });
      return;
    }
    updates.versionName = req.body.versionName.trim();
  }

  if (req.body?.changelog !== undefined) {
    if (
      typeof req.body.changelog !== "string" ||
      req.body.changelog.trim().length === 0 ||
      req.body.changelog.length > 5000
    ) {
      res.status(400).json({ error: "Changelog must be between 1 and 5000 characters." });
      return;
    }
    updates.changelog = req.body.changelog.trim();
  }

  let replacingHostedApk = false;
  if (req.body?.downloadUrl !== undefined) {
    const rawPatchUrl = typeof req.body.downloadUrl === "string" ? req.body.downloadUrl.trim() : "";
    if (rawPatchUrl.length > 0 && rawPatchUrl !== `/api/app-updates/${id}/download`) {
      const urlCheck = validateHttpsDownloadUrl(rawPatchUrl);
      if (urlCheck.error || !urlCheck.url) {
        res.status(400).json({ error: urlCheck.error ?? "Invalid download URL." });
        return;
      }
      updates.downloadUrl = urlCheck.url;
      updates.fileName = null;
      replacingHostedApk = true;
    }
  }

  if (req.body?.sha256 !== undefined) {
    const shaCheck = validateOptionalSha256(req.body.sha256);
    if (shaCheck.error) {
      res.status(400).json({ error: shaCheck.error });
      return;
    }
    updates.sha256 = shaCheck.value ?? null;
  }

  if (req.body?.isMandatory !== undefined) {
    updates.isMandatory = req.body.isMandatory === true || req.body.isMandatory === "true";
  }

  if (req.body?.isActive !== undefined) {
    updates.isActive = req.body.isActive === true || req.body.isActive === "true";
  }

  if (req.body?.minSupportedVersionCode !== undefined) {
    if (req.body.minSupportedVersionCode === null || req.body.minSupportedVersionCode === "") {
      updates.minSupportedVersionCode = null;
    } else {
      const parsedMin = Number(req.body.minSupportedVersionCode);
      if (!Number.isSafeInteger(parsedMin) || parsedMin < 1 || parsedMin > 2_147_483_647) {
        res.status(400).json({ error: "Invalid minimum supported version code." });
        return;
      }
      updates.minSupportedVersionCode = parsedMin;
    }
  }

  const [existingBeforePatch] = replacingHostedApk
    ? await db
        .select({ fileName: appReleasesTable.fileName })
        .from(appReleasesTable)
        .where(eq(appReleasesTable.id, id))
        .limit(1)
    : [];

  const [updated] = await db
    .update(appReleasesTable)
    .set(updates)
    .where(eq(appReleasesTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Release not found." });
    return;
  }

  if (replacingHostedApk && existingBeforePatch?.fileName) {
    await safeUnlink(path.join(APK_STORAGE_DIR, path.basename(existingBeforePatch.fileName)));
  }

  res.json({ release: serializeRelease(updated) });
});

router.delete("/admin/app-updates/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) {
    res.status(400).json({ error: "Invalid release ID." });
    return;
  }

  const [deleted] = await db
    .delete(appReleasesTable)
    .where(eq(appReleasesTable.id, id))
    .returning({ id: appReleasesTable.id, fileName: appReleasesTable.fileName });

  if (!deleted) {
    res.status(404).json({ error: "Release not found." });
    return;
  }

  if (deleted.fileName) {
    await safeUnlink(path.join(APK_STORAGE_DIR, path.basename(deleted.fileName)));
  }

  res.json({ success: true, id: deleted.id });
});

router.post("/admin/app-updates/:id/notify", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) {
    res.status(400).json({ error: "Invalid release ID." });
    return;
  }

  const [release] = await db
    .select()
    .from(appReleasesTable)
    .where(eq(appReleasesTable.id, id))
    .limit(1);

  if (!release) {
    res.status(404).json({ error: "Release not found." });
    return;
  }

  if (!release.isActive) {
    res.status(400).json({ error: "Resume this release before sending update notifications." });
    return;
  }

  const push = await notifyDevices(release.versionCode, release.versionName, release.title);
  const warning = pushWarning(push);
  res.json({
    release: serializeRelease(release),
    push,
    ...(warning ? { warning } : {}),
  });
});

export default router;
