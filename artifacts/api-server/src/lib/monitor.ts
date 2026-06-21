import { eq } from "drizzle-orm";
import { db, monitoredAccountsTable, postNotificationsTable } from "@workspace/db";
import { logger } from "./logger";
import { fetchTikwmUserInfo, fetchLatestUserVideoUrl } from "./tikwm";

const POLL_INTERVAL_MS = 60_000;
const INTER_ACCOUNT_DELAY_MS = 2_000;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function checkAccount(
  account: typeof monitoredAccountsTable.$inferSelect,
): Promise<void> {
  try {
    const info = await fetchTikwmUserInfo(account.username);

    if (!info) {
      logger.info({ username: account.username }, "monitor: could not fetch user info");
      await db
        .update(monitoredAccountsTable)
        .set({ lastCheckedAt: new Date() })
        .where(eq(monitoredAccountsTable.id, account.id));
      return;
    }

    const prevCount = account.lastVideoCount;
    const newCount = info.videoCount;

    const isFirstCheck = prevCount === null;
    const countIncreased = !isFirstCheck && newCount > prevCount;

    if (countIncreased) {
      const diff = newCount - prevCount;
      logger.info(
        { username: account.username, prevCount, newCount, diff },
        "monitor: new video(s) detected — creating notification",
      );

      await db.insert(postNotificationsTable).values({
        monitoredAccountId: account.id,
        username: account.username,
        avatarUrl: info.avatarUrl ?? account.avatarUrl ?? null,
        videoId: `count_${newCount}_${Date.now()}`,
        videoTitle: `@${account.username} has posted a new video, check it out!`,
        thumbnail: info.avatarUrl ?? account.avatarUrl ?? null,
        videoUrl: (await fetchLatestUserVideoUrl(account.username)) ?? account.tiktokUrl,
        isRead: false,
      });
    } else if (isFirstCheck) {
      logger.info(
        { username: account.username, videoCount: newCount },
        "monitor: baseline set — no notification on first check",
      );
    }

    await db
      .update(monitoredAccountsTable)
      .set({
        lastVideoCount: newCount,
        lastCheckedAt: new Date(),
        ...(info.avatarUrl ? { avatarUrl: info.avatarUrl } : {}),
      })
      .where(eq(monitoredAccountsTable.id, account.id));
  } catch (err) {
    logger.error({ err, username: account.username }, "monitor: error checking account");
  }
}

async function runPollCycle(): Promise<void> {
  try {
    const accounts = await db
      .select()
      .from(monitoredAccountsTable)
      .where(eq(monitoredAccountsTable.notificationsEnabled, true));

    if (accounts.length === 0) return;

    logger.info({ count: accounts.length }, "monitor: poll cycle started");

    for (let i = 0; i < accounts.length; i++) {
      if (i > 0) await sleep(INTER_ACCOUNT_DELAY_MS);
      await checkAccount(accounts[i]);
    }

    logger.info("monitor: poll cycle complete");
  } catch (err) {
    logger.error({ err }, "monitor: poll cycle error");
  }
}

export function startMonitor(): void {
  logger.info({ intervalMs: POLL_INTERVAL_MS }, "monitor: TikTok video-count monitor started");
  runPollCycle().catch((err) => logger.error({ err }, "monitor: initial poll failed"));
  setInterval(() => {
    runPollCycle().catch((err) => logger.error({ err }, "monitor: poll failed"));
  }, POLL_INTERVAL_MS);
}
