import { Router, type IRouter } from "express";
import path from "path";
import { desc, inArray, eq, sql } from "drizzle-orm";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import {
  db,
  appReleasesTable,
  appUpdateDevicesTable,
  appInstallationsTable,
  type AppRelease,
} from "@workspace/db";
import { requireAdmin } from "../middlewares/admin";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const DEFAULT_APP_VERSION_CODE = 32;
const DEFAULT_APP_VERSION_NAME = "1.2.16";
const APK_STORAGE_DIR = path.resolve(
  process.env.APK_STORAGE_DIR || path.join(process.cwd(), "uploads", "app-releases"),
);

type PushResult =
  | { status: "sent"; deviceCount: number; deliveredCount: number }
  | { status: "partial" | "failed"; deviceCount: number; deliveredCount: number }
  | { status: "not_configured"; deviceCount: number; deliveredCount: 0 }
  | { status: "skipped"; deviceCount: number; deliveredCount: 0 };

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
    return "Release is live in the database. Users will see the update prompt when they open HutaoTik (configure FIREBASE_SERVICE_ACCOUNT_JSON to also send background push alerts).";
  }
  if (push.status === "failed" || push.status === "partial") {
    return "Release is live in the database, but not all background push alerts were delivered.";
  }
  return undefined;
}

async function notifyDevices(
  versionCode: number,
  versionName: string,
  title?: string,
): Promise<PushResult> {
  let deviceCount = 0;
  let deliveredCount = 0;
  try {
    const tokens = await db
      .select({ token: appUpdateDevicesTable.token })
      .from(appUpdateDevicesTable);
    deviceCount = tokens.length;
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!serviceAccountJson) return { status: "not_configured", deviceCount, deliveredCount: 0 };
    if (deviceCount === 0) return { status: "sent", deviceCount: 0, deliveredCount: 0 };

    const serviceAccount = JSON.parse(serviceAccountJson);
    const app =
      getApps().find((existingApp) => existingApp.name === "hutaotik-app-updates") ??
      initializeApp(
        { credential: cert(serviceAccount) },
        "hutaotik-app-updates",
      );
    const messaging = getMessaging(app);
    const invalidTokens: string[] = [];

    const notificationTitle = title?.trim()
      ? `HutaoTik ${versionName} — ${title.trim()}`
      : "HutaoTik update available";

    for (let index = 0; index < tokens.length; index += 500) {
      const batch = tokens.slice(index, index + 500);
      const result = await messaging.sendEachForMulticast({
        tokens: batch.map(({ token }) => token),
        notification: {
          title: notificationTitle,
          body: `Version ${versionName} is ready to install.`,
        },
        data: {
          type: "app_update",
          versionCode: String(versionCode),
        },
        android: {
          notification: { channelId: "hutaotik_updates" },
        },
      });
      deliveredCount += result.successCount;
      const failedCodes = result.responses.flatMap((response) =>
        response.success ? [] : [response.error?.code ?? "unknown"],
      );
      if (failedCodes.length > 0) {
        logger.warn({ failedCodes }, "Some Hutaotik update push alerts were rejected.");
      }

      result.responses.forEach((response, responseIndex) => {
        if (
          !response.success &&
          (response.error?.code === "messaging/registration-token-not-registered" ||
            response.error?.code === "messaging/invalid-registration-token")
        ) {
          invalidTokens.push(batch[responseIndex].token);
        }
      });
    }

    if (invalidTokens.length > 0) {
      await db
        .delete(appUpdateDevicesTable)
        .where(inArray(appUpdateDevicesTable.token, invalidTokens));
    }
    return {
      status: deliveredCount === deviceCount ? "sent" : deliveredCount > 0 ? "partial" : "failed",
      deviceCount,
      deliveredCount,
    };
  } catch (error) {
    logger.error({ err: error }, "Could not send Hutaotik update push notifications.");
    return {
      status: deliveredCount > 0 ? "partial" : "failed",
      deviceCount,
      deliveredCount,
    };
  }
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

  res.download(
    path.join(APK_STORAGE_DIR, release.fileName),
    `Hutaotik-${release.versionName}.apk`,
  );
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
  async (req, res): Promise<void> => {
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
      res.status(400).json({ error: "Enter a valid release announcement (1–5000 characters)." });
      return;
    }

    const urlCheck = validateHttpsDownloadUrl(req.body?.downloadUrl);
    if (urlCheck.error || !urlCheck.url) {
      res.status(400).json({ error: urlCheck.error ?? "Invalid HTTPS download URL." });
      return;
    }

    const shaCheck = validateOptionalSha256(req.body?.sha256);
    if (shaCheck.error) {
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
        res.status(400).json({ error: "Minimum supported version code must be a positive integer." });
        return;
      }
      minSupportedVersionCode = parsedMin;
    }

    let fileSize: number | null = null;
    if (
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
        res.status(400).json({ error: "Version code must be a valid positive integer." });
        return;
      }
      const [duplicate] = await db
        .select({ id: appReleasesTable.id })
        .from(appReleasesTable)
        .where(eq(appReleasesTable.versionCode, parsedCode))
        .limit(1);
      if (duplicate) {
        res.status(409).json({
          error: `Version code ${parsedCode} already exists in the release database. Choose a higher version code or edit the existing release.`,
        });
        return;
      }
      versionCode = parsedCode;
    } else {
      const baseCode = Math.max(latest?.versionCode ?? 0, DEFAULT_APP_VERSION_CODE);
      if (baseCode >= 2_147_483_647) {
        res.status(409).json({ error: "The Android version code limit has been reached." });
        return;
      }
      versionCode = baseCode + 1;
    }

    let versionName: string;
    if (typeof req.body?.versionName === "string" && req.body.versionName.trim().length > 0) {
      const candidate = req.body.versionName.trim();
      if (!/^[0-9A-Za-z._-]{1,32}$/.test(candidate)) {
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
        res.status(409).json({ error: "Could not automatically generate the next app version name." });
        return;
      }
      versionName = bumped;
    }

    const now = new Date();
    const [release] = await db
      .insert(appReleasesTable)
      .values({
        versionCode,
        versionName,
        title,
        changelog: changelog.trim(),
        downloadUrl: urlCheck.url,
        fileSize,
        sha256: shaCheck.value ?? null,
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

    const warning = pushWarning(push);
    res.status(201).json({
      release: serializeRelease(release),
      push,
      ...(warning ? { warning } : {}),
    });
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

  if (req.body?.downloadUrl !== undefined) {
    const urlCheck = validateHttpsDownloadUrl(req.body.downloadUrl);
    if (urlCheck.error || !urlCheck.url) {
      res.status(400).json({ error: urlCheck.error ?? "Invalid download URL." });
      return;
    }
    updates.downloadUrl = urlCheck.url;
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

  const [updated] = await db
    .update(appReleasesTable)
    .set(updates)
    .where(eq(appReleasesTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Release not found." });
    return;
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
    .returning({ id: appReleasesTable.id });

  if (!deleted) {
    res.status(404).json({ error: "Release not found." });
    return;
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
