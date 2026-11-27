import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowUpCircle,
  CheckCircle2,
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { SiDiscord } from "react-icons/si";
import {
  fetchLatestRelease,
  fetchReleaseHistory,
  getInstalledAppVersion,
  isDirectApkInstallUrl,
  isUpdateNewer,
  registerAppUpdateProgressListener,
  resolveReleaseDownloadUrl,
  startAppUpdateInstall,
  toDownloadProgressState,
  type AppUpdateProgressEvent,
  type AvailableRelease,
} from "@/lib/app-updates";
import { DownloadProgressCard } from "@/components/download-progress-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const DISCORD_INVITE_URL = "https://discord.gg/wu6ndP3Qgf";

function formatReleaseDate(raw: string): string {
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

export default function Updates() {
  const installed = getInstalledAppVersion();
  const [latest, setLatest] = useState<AvailableRelease | null>(null);
  const [history, setHistory] = useState<AvailableRelease[]>([]);
  const [checking, setChecking] = useState(true);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [progressEvent, setProgressEvent] = useState<AppUpdateProgressEvent | null>(null);

  const runCheck = useCallback(async () => {
    setChecking(true);
    setCheckError(null);
    try {
      const [latestRelease, releaseHistory] = await Promise.all([
        fetchLatestRelease(),
        fetchReleaseHistory().catch(() => []),
      ]);
      setLatest(latestRelease);
      setHistory(releaseHistory);
    } catch (cause) {
      setCheckError(
        cause instanceof Error ? cause.message : "Could not reach the update server right now.",
      );
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void runCheck();
  }, [runCheck]);

  useEffect(() => {
    return registerAppUpdateProgressListener((event) => {
      setProgressEvent(event);
      if (event.status === "failed") {
        setDownloading(false);
        setInstallError(
          event.message || "Update download failed. Try again or open the link in your browser.",
        );
      } else if (event.status === "permission_required") {
        setDownloading(false);
        setInstallError(
          "Allow HutaoTik to install unknown apps in Android settings, then tap Update again.",
        );
      } else if (event.status === "installing" || event.status === "completed") {
        setDownloading(false);
      }
    });
  }, []);

  const hasUpdate = latest !== null && isUpdateNewer(latest.versionCode, installed.versionCode);
  const isDirectApk = latest ? isDirectApkInstallUrl(latest.downloadUrl) : false;

  const handleInstallLatest = () => {
    if (!latest) return;
    setInstallError(null);
    const outcome = startAppUpdateInstall(latest);
    if (outcome === "started" && isDirectApk) {
      setDownloading(true);
      setProgressEvent({ status: "downloading", percent: 2, message: "Starting APK download…" });
      return;
    }
    if (outcome === "permission_required") {
      setInstallError("Allow HutaoTik to install unknown apps in Android settings, then tap Update again.");
      return;
    }
    if (outcome === "failed") {
      setInstallError("Could not start the APK download. Try opening the link in your browser.");
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {/* App Version & Live Update Checker Card */}
      <section className="animate-card-bounce-in rounded-2xl border border-border bg-card p-5 shadow-sm space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary border border-primary/25">
              {hasUpdate ? (
                <ArrowUpCircle className="h-6 w-6" />
              ) : (
                <Sparkles className="h-5 w-5" />
              )}
            </div>
            <div className="min-w-0">
              <h1 className="font-syne text-xl font-bold leading-tight">App Updates</h1>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Installed: <span className="font-mono font-semibold text-foreground">v{installed.versionName}</span>{" "}
                <span className="font-mono">(Build {installed.versionCode})</span>
              </p>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={checking || downloading}
            onClick={() => void runCheck()}
            className="h-9 shrink-0 gap-1.5 rounded-xl text-xs font-semibold"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${checking ? "animate-spin" : ""}`} />
            Check
          </Button>
        </div>

        {checking ? (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-background/60 p-3 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            Checking the HutaoTik release database…
          </div>
        ) : checkError ? (
          <div className="flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{checkError}</span>
          </div>
        ) : hasUpdate && latest ? (
          <div className="space-y-3 rounded-xl border border-primary/35 bg-primary/8 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-syne text-base font-bold text-foreground">
                  HutaoTik v{latest.versionName} Available!
                </span>
                <Badge className="bg-primary text-primary-foreground text-[10px] font-bold">
                  Build {latest.versionCode}
                </Badge>
                {latest.isMandatory && (
                  <Badge variant="destructive" className="text-[10px]">
                    Required
                  </Badge>
                )}
              </div>
              {latest.createdAt && (
                <span className="text-[11px] text-muted-foreground">
                  {formatReleaseDate(latest.createdAt)}
                </span>
              )}
            </div>

            {latest.title && (
              <p className="text-xs font-semibold text-primary">{latest.title}</p>
            )}
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/90">
              {latest.changelog}
            </p>

            {downloading && progressEvent && (
              <DownloadProgressCard
                title={`Downloading HutaoTik v${latest.versionName}…`}
                progress={toDownloadProgressState(progressEvent)}
                className=""
              />
            )}

            {installError && (
              <div className="space-y-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                <p>{installError}</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    window.open(
                      resolveReleaseDownloadUrl(latest.downloadUrl).toString(),
                      "_blank",
                      "noopener,noreferrer",
                    )
                  }
                  className="h-8 w-full gap-1.5 text-xs"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open link in browser
                </Button>
              </div>
            )}

            <Button
              type="button"
              disabled={downloading}
              onClick={handleInstallLatest}
              className="w-full max-w-full overflow-hidden h-11 gap-2 rounded-xl font-bold"
            >
              {downloading ? (
                <>
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                  <span className="min-w-0 truncate">Downloading… {progressEvent?.percent ?? 0}%</span>
                </>
              ) : isDirectApk ? (
                <>
                  <Download className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 truncate">Download & Install v{latest.versionName}</span>
                </>
              ) : (
                <>
                  <ExternalLink className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 truncate">Open v{latest.versionName} Update Link</span>
                </>
              )}
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
            <div className="min-w-0">
              <p className="text-xs font-bold text-emerald-400">You&apos;re up to date!</p>
              <p className="text-[11px] text-muted-foreground">
                HutaoTik v{installed.versionName} is the newest available version.
              </p>
            </div>
          </div>
        )}
      </section>

      {/* Release History Feed */}
      {history.length > 0 && (
        <section className="animate-card-bounce-in rounded-2xl border border-border bg-card p-5 shadow-sm space-y-3" style={{ animationDelay: "60ms" }}>
          <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Release Changelog History
          </h2>
          <div className="space-y-3">
            {history.map((item) => (
              <div
                key={item.id}
                className="rounded-xl border border-border bg-background/60 p-3.5 space-y-1.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold text-foreground">
                      v{item.versionName}
                    </span>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      Build {item.versionCode}
                    </Badge>
                    {item.versionCode === installed.versionCode && (
                      <Badge className="bg-primary/15 text-primary border-primary/30 text-[10px]">
                        Installed
                      </Badge>
                    )}
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    {formatReleaseDate(item.createdAt)}
                  </span>
                </div>
                {item.title && (
                  <p className="text-xs font-semibold text-primary">{item.title}</p>
                )}
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                  {item.changelog}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Discord Community Card */}
      <section className="animate-card-bounce-in rounded-2xl border border-indigo-400/30 bg-card p-6 text-center shadow-lg shadow-indigo-950/10 sm:p-8" style={{ animationDelay: "120ms" }}>
        <div className="animate-float-gentle mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-500/15 text-indigo-400">
          <SiDiscord className="h-7 w-7" />
        </div>
        <h2 className="text-2xl font-syne font-bold">Hutao Updates Discord</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          Join the Discord server for Hutaotik updates, announcements, and community news.
        </p>
        <Button
          asChild
          className="mt-6 h-11 rounded-xl bg-indigo-600 px-6 font-bold text-white hover:bg-indigo-500"
        >
          <a href={DISCORD_INVITE_URL} target="_blank" rel="noopener noreferrer">
            <SiDiscord className="h-4 w-4" />
            Join the Discord Server
          </a>
        </Button>
        <p className="mt-4 break-all text-xs text-muted-foreground">{DISCORD_INVITE_URL}</p>
      </section>
    </div>
  );
}
