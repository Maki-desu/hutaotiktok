import { inArray } from "drizzle-orm";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { db, appUpdateDevicesTable } from "@workspace/db";
import { logger } from "./logger";

export type PushResult =
  | { status: "sent"; deviceCount: number; deliveredCount: number }
  | { status: "partial" | "failed"; deviceCount: number; deliveredCount: number }
  | { status: "not_configured"; deviceCount: number; deliveredCount: 0 }
  | { status: "skipped"; deviceCount: number; deliveredCount: 0 };

async function sendMulticastToRegisteredDevices(payload: {
  title: string;
  body: string;
  channelId: string;
  data: Record<string, string>;
  contextLabel: string;
}): Promise<PushResult> {
  let deviceCount = 0;
  let deliveredCount = 0;

  try {
    const tokens = await db
      .select({ token: appUpdateDevicesTable.token })
      .from(appUpdateDevicesTable);
    deviceCount = tokens.length;

    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!serviceAccountJson) {
      return { status: "not_configured", deviceCount, deliveredCount: 0 };
    }
    if (deviceCount === 0) {
      return { status: "sent", deviceCount: 0, deliveredCount: 0 };
    }

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
          title: payload.title,
          body: payload.body,
        },
        data: payload.data,
        android: {
          notification: { channelId: payload.channelId },
        },
      });
      deliveredCount += result.successCount;

      const failedCodes = result.responses.flatMap((response) =>
        response.success ? [] : [response.error?.code ?? "unknown"],
      );
      if (failedCodes.length > 0) {
        logger.warn({ failedCodes }, `Some Hutaotik ${payload.contextLabel} push alerts were rejected.`);
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
    logger.error({ err: error }, `Could not send Hutaotik ${payload.contextLabel} push notifications.`);
    return {
      status: deliveredCount > 0 ? "partial" : "failed",
      deviceCount,
      deliveredCount,
    };
  }
}

export async function notifyAppUpdateDevices(
  versionCode: number,
  versionName: string,
  title?: string,
): Promise<PushResult> {
  const notificationTitle = title?.trim()
    ? `HutaoTik ${versionName} — ${title.trim()}`
    : "HutaoTik update available";

  return sendMulticastToRegisteredDevices({
    title: notificationTitle,
    body: `Version ${versionName} is ready to install.`,
    channelId: "hutaotik_updates",
    data: {
      type: "app_update",
      versionCode: String(versionCode),
    },
    contextLabel: "update",
  });
}

export async function notifyAnnouncementDevices(
  announcementId: number,
  colorType: string,
  content: string,
): Promise<PushResult> {
  const heading =
    colorType === "warning"
      ? "HutaoTik Notice"
      : colorType === "update"
        ? "HutaoTik Update News"
        : "HutaoTik Announcement";
  const body = content.trim().slice(0, 220);

  return sendMulticastToRegisteredDevices({
    title: heading,
    body: body || "Tap to read the latest announcement in HutaoTik.",
    channelId: "hutaotik_announcements",
    data: {
      type: "announcement",
      announcementId: String(announcementId),
      colorType,
    },
    contextLabel: "announcement",
  });
}
