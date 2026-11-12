import { Router, type IRouter } from "express";
import path from "path";
import { desc, inArray, eq } from "drizzle-orm";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { db, appReleasesTable, appUpdateDevicesTable } from "@workspace/db";
import { requireAdmin } from "../middlewares/admin";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const DEFAULT_APP_VERSION_CODE = 22;
const DEFAULT_APP_VERSION_NAME = "1.2.6";
const APK_STORAGE_DIR = path.resolve(
  process.env.APK_STORAGE_DIR || path.join(process.cwd(), "uploads", "app-releases"),
);

type PushResult =
  | { status: "sent"; deviceCount: number; deliveredCount: number }
  | { status: "partial" | "failed"; deviceCount: number; deliveredCount: number }
  | { status: "not_configured"; deviceCount: number; deliveredCount: 0 };

async function notifyDevices(versionCode: number, versionName: string): Promise<PushResult> {
  let deviceCount = 0;
  let deliveredCount = 0;
  try {
    const tokens = await db.select({ token: appUpdateDevicesTable.token }).from(appUpdateDevicesTable);
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

    for (let index = 0; index < tokens.length; index += 500) {
      const batch = tokens.slice(index, index + 500);
      const result = await messaging.sendEachForMulticast({
        tokens: batch.map(({ token }) => token),
        notification: {
          title: "Hutaotik update available",
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

router.get("/app-updates/latest", async (_req, res): Promise<void> => {
  const [release] = await db
    .select()
    .from(appReleasesTable)
    .orderBy(desc(appReleasesTable.versionCode))
    .limit(1);

  if (!release) {
    res.status(404).json({ error: "No Hutaotik update has been published." });
    return;
  }

  res.json({
    versionCode: release.versionCode,
    versionName: release.versionName,
    changelog: release.changelog,
    downloadUrl: release.downloadUrl ?? `/api/app-updates/${release.id}/download`,
    fileSize: release.fileSize,
    sha256: release.sha256,
    isMandatory: release.isMandatory,
    createdAt: release.createdAt.toISOString(),
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

router.post(
  "/admin/app-updates",
  requireAdmin,
  async (req, res): Promise<void> => {
    const changelog = req.body?.changelog;
    const rawDownloadUrl = req.body?.downloadUrl;
    const isMandatory = req.body?.isMandatory === true || req.body?.isMandatory === "true";

    if (
      typeof changelog !== "string" ||
      changelog.trim().length === 0 ||
      changelog.length > 5000 ||
      typeof rawDownloadUrl !== "string" ||
      rawDownloadUrl.length > 2048
    ) {
      res.status(400).json({ error: "Enter a valid version code, version name, announcement, and APK link." });
      return;
    }

    let downloadUrl: URL;
    try {
      downloadUrl = new URL(rawDownloadUrl);
    } catch {
      res.status(400).json({ error: "Enter a valid public HTTPS update link." });
      return;
    }
    if (
      downloadUrl.protocol !== "https:" ||
      downloadUrl.username.length > 0 ||
      downloadUrl.password.length > 0
    ) {
      res.status(400).json({ error: "The APK download link must use HTTPS and cannot contain credentials." });
      return;
    }

    const [latest] = await db
      .select({
        versionCode: appReleasesTable.versionCode,
        versionName: appReleasesTable.versionName,
      })
      .from(appReleasesTable)
      .orderBy(desc(appReleasesTable.versionCode))
      .limit(1);
    const minimumVersionCode = latest?.versionCode ?? DEFAULT_APP_VERSION_CODE;
    if (minimumVersionCode >= 2_147_483_647) {
      res.status(409).json({ error: "The Android version code limit has been reached." });
      return;
    }
    const versionCode = minimumVersionCode + 1;
    const previousVersionName = latest?.versionName ?? DEFAULT_APP_VERSION_NAME;
    const versionName = previousVersionName && /^[0-9]+(?:\.[0-9]+)*$/.test(previousVersionName)
      ? (() => {
          const segments = previousVersionName.split(".");
          const lastSegment = Number(segments[segments.length - 1]);
          if (!Number.isSafeInteger(lastSegment) || lastSegment >= Number.MAX_SAFE_INTEGER) {
            return null;
          }
          segments[segments.length - 1] = String(lastSegment + 1);
          return segments.join(".");
        })()
      : null;
    if (!versionName) {
      res.status(409).json({ error: "Could not automatically generate the next app version name." });
      return;
    }

    const [release] = await db
      .insert(appReleasesTable)
      .values({
        versionCode,
        versionName,
        changelog: changelog.trim(),
        downloadUrl: downloadUrl.toString(),
        isMandatory,
      })
      .returning();

    const push = await notifyDevices(versionCode, versionName);
    res.status(201).json({
      release: {
        versionCode: release.versionCode,
        versionName: release.versionName,
      },
      push,
      ...(push.status === "not_configured"
        ? { warning: "Release is published; configure FIREBASE_SERVICE_ACCOUNT_JSON to send push alerts." }
        : push.status === "failed" || push.status === "partial"
          ? { warning: "Release is published, but not all push alerts were delivered. Check server logs." }
          : {}),
    });
  },
);

export default router;
