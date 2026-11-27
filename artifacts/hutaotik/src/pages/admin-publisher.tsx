import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ArrowUpCircle,
  Bell,
  CheckCircle2,
  Database,
  Download,
  ExternalLink,
  Globe,
  Loader2,
  LogOut,
  Megaphone,
  PauseCircle,
  Pencil,
  PlayCircle,
  RefreshCw,
  Send,
  ShieldCheck,
  Smartphone,
  Trash2,
  Users,
} from "lucide-react";
import { apiUrl, saveAdminApiUrl } from "@/lib/api-url";
import { isDirectApkInstallUrl } from "@/lib/app-updates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

const DEFAULT_API_SERVER_URL = "https://hutaotiktok-mja6.onrender.com";
const EMBEDDED_ADMIN_KEY = (import.meta.env.VITE_ADMIN_APP_KEY ?? "").trim();

type PushStatus = {
  status: "sent" | "partial" | "not_configured" | "failed" | "skipped";
  deviceCount: number;
  deliveredCount: number;
};

type AdminRelease = {
  id: number;
  versionCode: number;
  versionName: string;
  title: string;
  changelog: string;
  downloadUrl: string;
  fileSize: number | null;
  sha256: string | null;
  isMandatory: boolean;
  minSupportedVersionCode: number | null;
  isActive: boolean;
  downloadCount: number;
  createdAt: string;
  updatedAt: string;
};

type FleetStats = {
  totalDevices: number;
  activeLast7Days: number;
  activeLast30Days: number;
  pushTokenCount: number;
  firebaseConfigured: boolean;
  latestActiveVersionCode: number | null;
  latestActiveVersionName: string | null;
  upToDateCount: number;
  outdatedCount: number;
  totalDownloads: number;
  versionBreakdown: Array<{ versionCode: number; versionName: string; count: number }>;
};

type AdminAnnouncement = {
  id: number;
  content: string;
  colorType: "info" | "warning" | "update";
  isPermanent: boolean;
  isActive: boolean;
  expiresAt: string | null;
  createdAt: string;
};

type PublishMode = "update" | "announcement";
type PublishFeedback = {
  message: string;
  push?: PushStatus;
  warning?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bumpPatch(versionName: string): string {
  if (!/^[0-9]+(?:\.[0-9]+)*$/.test(versionName)) return "1.2.16";
  const parts = versionName.split(".");
  const last = Number(parts[parts.length - 1]);
  if (!Number.isSafeInteger(last)) return versionName;
  parts[parts.length - 1] = String(last + 1);
  return parts.join(".");
}

function formatDate(raw: string): string {
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

async function readApiResponse(response: Response): Promise<Record<string, unknown>> {
  const body = await response.text();
  let data: unknown;

  try {
    data = JSON.parse(body);
  } catch (cause) {
    if (body.trimStart().startsWith("<")) {
      if (
        response.status === 404 &&
        new URL(response.url).pathname.endsWith("/api/admin/app-updates")
      ) {
        throw new Error(
          "This Render API does not have the updated app-release database endpoints yet. Push the latest code so Render deploys, then try again.",
        );
      }
      if (response.status === 503) {
        throw new Error(
          "The Hutaotik API is waking up or unavailable (HTTP 503). Wait a few seconds and try again.",
        );
      }
      throw new Error(
        `The API check received a web page (HTTP ${response.status}) from ${response.url}. Enter only the Render base URL: ${DEFAULT_API_SERVER_URL}.`,
      );
    }
    if (response.status === 503) {
      throw new Error("The Hutaotik API is unavailable (HTTP 503). Try again when Render is live.");
    }
    if (cause instanceof SyntaxError) {
      throw new Error("The API server returned an invalid JSON response.");
    }
    throw cause;
  }

  if (Array.isArray(data)) {
    return { items: data };
  }
  if (!isRecord(data)) {
    throw new Error("The API server returned an unexpected response.");
  }
  return data;
}

export default function AdminPublisher() {
  const defaultCodeFromBuild = Number.parseInt(
    import.meta.env.VITE_DEFAULT_RELEASE_VERSION_CODE ?? "32",
    10,
  );
  const defaultNameFromBuild = import.meta.env.VITE_DEFAULT_RELEASE_VERSION_NAME ?? "1.2.16";
  const hasEmbeddedKey = EMBEDDED_ADMIN_KEY.length > 0;

  const [token, setToken] = useState(() => localStorage.getItem("hutaotik_release_admin_token") ?? "");
  const [serverUrl, setServerUrl] = useState(
    () =>
      localStorage.getItem("hutaotik_admin_api_url") ||
      import.meta.env.VITE_API_URL?.trim() ||
      DEFAULT_API_SERVER_URL,
  );
  const [serverDialogOpen, setServerDialogOpen] = useState(false);
  const [serverUrlDraft, setServerUrlDraft] = useState(serverUrl);
  const [savingServerUrl, setSavingServerUrl] = useState(false);
  const [serverDialogError, setServerDialogError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [activeTab, setActiveTab] = useState("publish");
  const isUnlocked = hasEmbeddedKey || token.length > 0;

  // Publish form state
  const [mode, setMode] = useState<PublishMode>("update");
  const [versionName, setVersionName] = useState(() => bumpPatch(defaultNameFromBuild));
  const [versionCode, setVersionCode] = useState(() =>
    String((Number.isSafeInteger(defaultCodeFromBuild) ? defaultCodeFromBuild : 32) + 1),
  );
  const [releaseTitle, setReleaseTitle] = useState("");
  const [changelog, setChangelog] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [sha256, setSha256] = useState("");
  const [isMandatory, setIsMandatory] = useState(false);
  const [minSupportedCode, setMinSupportedCode] = useState("");
  const [announcementColor, setAnnouncementColor] = useState<"info" | "warning" | "update">("info");
  const [announcementPermanent, setAnnouncementPermanent] = useState(false);
  const [announcementDays, setAnnouncementDays] = useState("7");

  // Database state
  const [releases, setReleases] = useState<AdminRelease[]>([]);
  const [stats, setStats] = useState<FleetStats | null>(null);
  const [announcements, setAnnouncements] = useState<AdminAnnouncement[]>([]);
  const [loadingDb, setLoadingDb] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);

  // Action feedback
  const [busy, setBusy] = useState(false);
  const [busyReleaseId, setBusyReleaseId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PublishFeedback | null>(null);

  // Edit & Delete dialogs
  const [editingRelease, setEditingRelease] = useState<AdminRelease | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editVersionName, setEditVersionName] = useState("");
  const [editChangelog, setEditChangelog] = useState("");
  const [editDownloadUrl, setEditDownloadUrl] = useState("");
  const [editSha256, setEditSha256] = useState("");
  const [editMandatory, setEditMandatory] = useState(false);
  const [editMinSupported, setEditMinSupported] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminRelease | null>(null);

  const getAdminHeaders = useCallback(
    (includeJson = false): Record<string, string> => {
      const headers: Record<string, string> = {};
      if (includeJson) headers["Content-Type"] = "application/json";
      if (hasEmbeddedKey) {
        headers["x-admin-key"] = EMBEDDED_ADMIN_KEY;
      } else if (token) {
        headers["x-admin-token"] = token;
      }
      return headers;
    },
    [hasEmbeddedKey, token],
  );

  const handleUnauthorized = useCallback(() => {
    if (hasEmbeddedKey) {
      setDbError(
        "The Render API rejected this admin app's built-in key (HTTP 401). Push the latest backend to Render and add ADMIN_APP_KEY to your Render Environment Variables (or rebuild Hutaotik-Admin.apk with your Render ADMIN_PASSWORD), then tap Refresh.",
      );
      return;
    }
    localStorage.removeItem("hutaotik_release_admin_token");
    setToken("");
    setError("Your admin session expired. Sign in again.");
  }, [hasEmbeddedKey]);

  const loadDatabase = useCallback(async () => {
    if (!isUnlocked) return;
    setLoadingDb(true);
    setDbError(null);
    try {
      const headers = getAdminHeaders(false);
      const [releasesRes, annRes] = await Promise.all([
        fetch(apiUrl("/api/admin/app-updates"), { headers, cache: "no-store" }),
        fetch(apiUrl("/api/admin/announcements"), { headers, cache: "no-store" }).catch(() => null),
      ]);

      if (releasesRes.status === 401) {
        handleUnauthorized();
        return;
      }

      const data = await readApiResponse(releasesRes);
      if (!releasesRes.ok) {
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : `Could not load release database (HTTP ${releasesRes.status}).`,
        );
      }

      const loadedReleases = Array.isArray(data.releases) ? (data.releases as AdminRelease[]) : [];
      setReleases(loadedReleases);
      setStats(isRecord(data.stats) ? (data.stats as unknown as FleetStats) : null);

      const highestDbCode = loadedReleases.reduce((max, item) => Math.max(max, item.versionCode), 0);
      const baseCode = Math.max(highestDbCode, Number.isSafeInteger(defaultCodeFromBuild) ? defaultCodeFromBuild : 32);
      setVersionCode((current) => {
        const currentNum = Number.parseInt(current, 10);
        if (!Number.isSafeInteger(currentNum) || currentNum <= highestDbCode) {
          return String(baseCode + 1);
        }
        return current;
      });
      if (loadedReleases.length > 0) {
        setVersionName((current) => current || bumpPatch(loadedReleases[0].versionName));
      }

      if (annRes && annRes.ok) {
        const annData = await readApiResponse(annRes);
        if (Array.isArray(annData.items)) {
          setAnnouncements(annData.items as AdminAnnouncement[]);
        }
      }
    } catch (cause) {
      setDbError(cause instanceof Error ? cause.message : "Could not load the app database.");
    } finally {
      setLoadingDb(false);
    }
  }, [isUnlocked, getAdminHeaders, defaultCodeFromBuild, handleUnauthorized]);

  useEffect(() => {
    if (isUnlocked) {
      void loadDatabase();
    }
  }, [isUnlocked, loadDatabase]);

  const saveServerSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSavingServerUrl(true);
    setServerDialogError(null);
    try {
      const savedApiUrl = saveAdminApiUrl(serverUrlDraft.trim());
      const healthResponse = await fetch(apiUrl("/api/healthz"), { cache: "no-store" });
      const health = await readApiResponse(healthResponse);
      if (!healthResponse.ok || health.status !== "ok") {
        throw new Error("This URL is not the Hutaotik API service. Check the Render URL and try again.");
      }
      setServerUrl(savedApiUrl);
      setServerDialogOpen(false);
      await loadDatabase();
    } catch (cause) {
      setServerDialogError(
        cause instanceof Error ? cause.message : "Could not connect to that server URL.",
      );
    } finally {
      setSavingServerUrl(false);
    }
  };

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const savedApiUrl = saveAdminApiUrl(serverUrl.trim());
      setServerUrl(savedApiUrl);
      const healthResponse = await fetch(apiUrl("/api/healthz"), { cache: "no-store" });
      const health = await readApiResponse(healthResponse);
      if (!healthResponse.ok || health.status !== "ok") {
        throw new Error("This URL is not the Hutaotik API service. Check the Render URL and try again.");
      }

      const response = await fetch(apiUrl("/api/admin/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await readApiResponse(response);
      if (!response.ok || typeof data.token !== "string") {
        throw new Error(
          typeof data.error === "string" ? data.error : "Admin sign-in failed.",
        );
      }
      localStorage.setItem("hutaotik_release_admin_token", data.token);
      setToken(data.token);
      setPassword("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Admin sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  const publish = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const isUpdate = mode === "update";
      const content = changelog.trim();
      const link = downloadUrl.trim();
      const parsedCode = Number.parseInt(versionCode, 10);
      const parsedMinCode = minSupportedCode.trim()
        ? Number.parseInt(minSupportedCode.trim(), 10)
        : null;

      if (isUpdate && (!Number.isSafeInteger(parsedCode) || parsedCode < 1)) {
        throw new Error("Enter a valid numeric Android version code.");
      }

      const response = await fetch(
        apiUrl(isUpdate ? "/api/admin/app-updates" : "/api/admin/announcements"),
        {
          method: "POST",
          headers: getAdminHeaders(true),
          body: JSON.stringify(
            isUpdate
              ? {
                  versionCode: parsedCode,
                  versionName: versionName.trim(),
                  title: releaseTitle.trim(),
                  changelog: content,
                  downloadUrl: link,
                  isMandatory,
                  minSupportedVersionCode: parsedMinCode,
                  sha256: sha256.trim() || null,
                }
              : {
                  content: link ? `${content}\n\n${link}` : content,
                  colorType: announcementColor,
                  durationDays: announcementPermanent ? undefined : Number.parseInt(announcementDays, 10) || 7,
                  isPermanent: announcementPermanent,
                },
          ),
        },
      );
      const data = await readApiResponse(response);
      if (response.status === 401) {
        handleUnauthorized();
        return;
      }
      if (!response.ok) {
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : "The post could not be published.",
        );
      }

      if (isUpdate) {
        const publishedRelease = data.release as AdminRelease;
        const push = data.push as PushStatus | undefined;
        setResult({
          message: `Published v${publishedRelease.versionName} (Build ${publishedRelease.versionCode}) to the App Database!`,
          push,
          warning: typeof data.warning === "string" ? data.warning : undefined,
        });
        setVersionCode(String(publishedRelease.versionCode + 1));
        setVersionName(bumpPatch(publishedRelease.versionName));
        setReleaseTitle("");
        setChangelog("");
        setDownloadUrl("");
        setSha256("");
        setIsMandatory(false);
        setMinSupportedCode("");
      } else {
        setResult({ message: "Lobby announcement published to every HutaoTik user." });
        setChangelog("");
        setDownloadUrl("");
      }
      await loadDatabase();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not publish.");
    } finally {
      setBusy(false);
    }
  };

  const toggleReleaseActive = async (release: AdminRelease) => {
    setBusyReleaseId(release.id);
    setDbError(null);
    try {
      const response = await fetch(apiUrl(`/api/admin/app-updates/${release.id}`), {
        method: "PATCH",
        headers: getAdminHeaders(true),
        body: JSON.stringify({ isActive: !release.isActive }),
      });
      if (response.status === 401) {
        handleUnauthorized();
        return;
      }
      const data = await readApiResponse(response);
      if (!response.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Could not update release status.");
      }
      await loadDatabase();
    } catch (cause) {
      setDbError(cause instanceof Error ? cause.message : "Could not toggle release.");
    } finally {
      setBusyReleaseId(null);
    }
  };

  const openEditDialog = (release: AdminRelease) => {
    setEditingRelease(release);
    setEditTitle(release.title || "");
    setEditVersionName(release.versionName);
    setEditChangelog(release.changelog);
    setEditDownloadUrl(release.downloadUrl);
    setEditSha256(release.sha256 || "");
    setEditMandatory(release.isMandatory);
    setEditMinSupported(
      release.minSupportedVersionCode != null ? String(release.minSupportedVersionCode) : "",
    );
  };

  const saveEditRelease = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingRelease) return;
    setSavingEdit(true);
    setDbError(null);
    try {
      const response = await fetch(apiUrl(`/api/admin/app-updates/${editingRelease.id}`), {
        method: "PATCH",
        headers: getAdminHeaders(true),
        body: JSON.stringify({
          title: editTitle.trim(),
          versionName: editVersionName.trim(),
          changelog: editChangelog.trim(),
          downloadUrl: editDownloadUrl.trim(),
          sha256: editSha256.trim() || null,
          isMandatory: editMandatory,
          minSupportedVersionCode: editMinSupported.trim()
            ? Number.parseInt(editMinSupported.trim(), 10)
            : null,
        }),
      });
      if (response.status === 401) {
        handleUnauthorized();
        return;
      }
      const data = await readApiResponse(response);
      if (!response.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Could not save release changes.");
      }
      setEditingRelease(null);
      await loadDatabase();
    } catch (cause) {
      setDbError(cause instanceof Error ? cause.message : "Could not save changes.");
    } finally {
      setSavingEdit(false);
    }
  };

  const confirmDeleteRelease = async () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setBusyReleaseId(id);
    setDbError(null);
    try {
      const response = await fetch(apiUrl(`/api/admin/app-updates/${id}`), {
        method: "DELETE",
        headers: getAdminHeaders(false),
      });
      if (response.status === 401) {
        handleUnauthorized();
        return;
      }
      const data = await readApiResponse(response);
      if (!response.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Could not delete release.");
      }
      setDeleteTarget(null);
      await loadDatabase();
    } catch (cause) {
      setDbError(cause instanceof Error ? cause.message : "Could not delete release.");
    } finally {
      setBusyReleaseId(null);
    }
  };

  const resendPushForRelease = async (release: AdminRelease) => {
    setBusyReleaseId(release.id);
    setDbError(null);
    setResult(null);
    try {
      const response = await fetch(apiUrl(`/api/admin/app-updates/${release.id}/notify`), {
        method: "POST",
        headers: getAdminHeaders(false),
      });
      if (response.status === 401) {
        handleUnauthorized();
        return;
      }
      const data = await readApiResponse(response);
      if (!response.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Could not send notification.");
      }
      setResult({
        message: `Notification triggered for v${release.versionName}.`,
        push: data.push as PushStatus | undefined,
        warning: typeof data.warning === "string" ? data.warning : undefined,
      });
    } catch (cause) {
      setDbError(cause instanceof Error ? cause.message : "Could not notify devices.");
    } finally {
      setBusyReleaseId(null);
    }
  };

  const toggleAnnouncement = async (ann: AdminAnnouncement) => {
    try {
      const response = await fetch(apiUrl(`/api/admin/announcements/${ann.id}`), {
        method: "PUT",
        headers: getAdminHeaders(true),
        body: JSON.stringify({ isActive: !ann.isActive }),
      });
      if (response.status === 401) {
        handleUnauthorized();
        return;
      }
      if (response.ok) await loadDatabase();
    } catch {
      /* ignore */
    }
  };

  const deleteAnnouncement = async (id: number) => {
    try {
      const response = await fetch(apiUrl(`/api/admin/announcements/${id}`), {
        method: "DELETE",
        headers: getAdminHeaders(false),
      });
      if (response.status === 401) {
        handleUnauthorized();
        return;
      }
      if (response.ok) await loadDatabase();
    } catch {
      /* ignore */
    }
  };

  const signOut = () => {
    localStorage.removeItem("hutaotik_release_admin_token");
    setToken("");
    setResult(null);
    setReleases([]);
    setStats(null);
    setAnnouncements([]);
  };

  const directApkPreview =
    downloadUrl.trim().length > 0 && isDirectApkInstallUrl(downloadUrl.trim(), `${serverUrl}/`);

  return (
    <main className="min-h-screen bg-background px-4 py-6 pb-16 pt-safe text-foreground">
      <div className="mx-auto max-w-2xl space-y-5">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.22em] text-primary">
              <Database className="h-3.5 w-3.5 shrink-0" />
              App Update Database
            </p>
            <h1 className="mt-1 font-syne text-2xl font-extrabold tracking-tight sm:text-3xl">
              Hutaotik Admin
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Manage releases, send updates to every user, and monitor installed versions.
            </p>
          </div>
          {isUnlocked && (
            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => {
                  setServerUrlDraft(serverUrl);
                  setServerDialogError(null);
                  setServerDialogOpen(true);
                }}
                title="API Server URL"
                className="h-9 w-9 rounded-xl"
              >
                <Globe className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => void loadDatabase()}
                disabled={loadingDb}
                title="Refresh database"
                className="h-9 w-9 rounded-xl"
              >
                <RefreshCw className={`h-4 w-4 ${loadingDb ? "animate-spin" : ""}`} />
              </Button>
              {!hasEmbeddedKey && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={signOut}
                  className="h-9 gap-1.5 rounded-xl px-3 text-xs"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Sign out
                </Button>
              )}
            </div>
          )}
        </header>

        {!isUnlocked ? (
          <Card className="rounded-2xl border-border bg-card shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <ShieldCheck className="h-5 w-5 text-primary" />
                Admin Sign-In
              </CardTitle>
              <CardDescription>
                Connect to your Hutaotik API server and sign in with your configured admin password.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={login} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="admin-api-url">Hutaotik API server URL</Label>
                  <Input
                    id="admin-api-url"
                    type="url"
                    inputMode="url"
                    autoCapitalize="none"
                    value={serverUrl}
                    onChange={(event) => setServerUrl(event.target.value)}
                    placeholder={DEFAULT_API_SERVER_URL}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="admin-password">Admin password</Label>
                  <Input
                    id="admin-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                  />
                </div>
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                <Button type="submit" disabled={busy} className="h-11 w-full rounded-xl font-bold">
                  {busy ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Connecting…
                    </>
                  ) : (
                    "Sign in to Database"
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Quick Summary Strip */}
            {stats && (
              <div className="grid grid-cols-3 gap-2.5">
                <div className="rounded-2xl border border-border bg-card p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Live Version
                  </p>
                  <p className="mt-1 truncate font-mono text-base font-extrabold text-primary">
                    {stats.latestActiveVersionName ? `v${stats.latestActiveVersionName}` : "None"}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {stats.latestActiveVersionCode ? `Build ${stats.latestActiveVersionCode}` : "No active build"}
                  </p>
                </div>
                <div className="rounded-2xl border border-border bg-card p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Active Users
                  </p>
                  <p className="mt-1 font-mono text-base font-extrabold text-foreground">
                    {stats.totalDevices}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {stats.outdatedCount} need update
                  </p>
                </div>
                <div className="rounded-2xl border border-border bg-card p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Update Taps
                  </p>
                  <p className="mt-1 font-mono text-base font-extrabold text-emerald-400">
                    {stats.totalDownloads}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {releases.length} releases in DB
                  </p>
                </div>
              </div>
            )}

            {dbError && (
              <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="break-words">{dbError}</span>
              </div>
            )}

            {result && (
              <div role="status" className="space-y-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs">
                <p className="flex items-center gap-1.5 font-bold text-emerald-400">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  {result.message}
                </p>
                {result.push && result.push.status !== "skipped" && (
                  <p className="text-muted-foreground">
                    Push alerts: {result.push.deliveredCount} of {result.push.deviceCount} delivered (
                    {result.push.status.replaceAll("_", " ")}).
                  </p>
                )}
                {result.warning && <p className="text-amber-400">{result.warning}</p>}
              </div>
            )}

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-3 rounded-2xl border border-border bg-card p-1">
                <TabsTrigger value="publish" className="gap-1.5 rounded-xl text-xs font-bold">
                  <Send className="h-3.5 w-3.5" />
                  Publish
                </TabsTrigger>
                <TabsTrigger value="releases" className="gap-1.5 rounded-xl text-xs font-bold">
                  <Database className="h-3.5 w-3.5" />
                  Releases ({releases.length})
                </TabsTrigger>
                <TabsTrigger value="fleet" className="gap-1.5 rounded-xl text-xs font-bold">
                  <Users className="h-3.5 w-3.5" />
                  Users
                </TabsTrigger>
              </TabsList>

              {/* ── TAB 1: PUBLISH UPDATE / ANNOUNCEMENT ───────────── */}
              <TabsContent value="publish" className="mt-4 space-y-4">
                <Card className="rounded-2xl border-border bg-card">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Push New Release or Broadcast</CardTitle>
                    <CardDescription className="text-xs">
                      Publishing an App Update immediately updates the database so every user on an older build receives the update prompt.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form onSubmit={publish} className="space-y-4">
                      <RadioGroup
                        value={mode}
                        onValueChange={(value) => {
                          setMode(value as PublishMode);
                          setError(null);
                          setResult(null);
                        }}
                        className="grid grid-cols-2 gap-2.5"
                        aria-label="Post type"
                      >
                        <Label
                          htmlFor="post-type-update"
                          className={`flex cursor-pointer items-center gap-2 rounded-xl border p-3 text-xs font-semibold transition-colors ${
                            mode === "update"
                              ? "border-primary bg-primary/10 text-foreground"
                              : "border-border bg-background/50 text-muted-foreground"
                          }`}
                        >
                          <RadioGroupItem id="post-type-update" value="update" />
                          App Update
                        </Label>
                        <Label
                          htmlFor="post-type-announcement"
                          className={`flex cursor-pointer items-center gap-2 rounded-xl border p-3 text-xs font-semibold transition-colors ${
                            mode === "announcement"
                              ? "border-primary bg-primary/10 text-foreground"
                              : "border-border bg-background/50 text-muted-foreground"
                          }`}
                        >
                          <RadioGroupItem id="post-type-announcement" value="announcement" />
                          Announcement
                        </Label>
                      </RadioGroup>

                      {mode === "update" && (
                        <>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <Label htmlFor="release-version-name" className="text-xs">
                                Version Name
                              </Label>
                              <Input
                                id="release-version-name"
                                value={versionName}
                                onChange={(e) => setVersionName(e.target.value)}
                                placeholder="1.2.15"
                                maxLength={32}
                                required
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="release-version-code" className="text-xs">
                                Build / Version Code
                              </Label>
                              <Input
                                id="release-version-code"
                                type="number"
                                min={1}
                                step={1}
                                value={versionCode}
                                onChange={(e) => setVersionCode(e.target.value)}
                                placeholder="31"
                                required
                              />
                            </div>
                          </div>
                          <p className="-mt-2 text-[11px] text-muted-foreground">
                            Match the exact <code className="font-mono text-primary">versionCode</code> inside your built <code className="font-mono">hutaotik.apk</code> so users who update won&apos;t get prompted again.
                          </p>

                          <div className="space-y-1.5">
                            <Label htmlFor="release-title" className="text-xs">
                              Headline (optional)
                            </Label>
                            <Input
                              id="release-title"
                              value={releaseTitle}
                              onChange={(e) => setReleaseTitle(e.target.value)}
                              placeholder="e.g. Live Download Progress & UI Fixes"
                              maxLength={120}
                            />
                          </div>
                        </>
                      )}

                      <div className="space-y-1.5">
                        <Label htmlFor="release-changelog" className="text-xs">
                          {mode === "update" ? "What's new (Changelog)" : "Announcement message"}
                        </Label>
                        <Textarea
                          id="release-changelog"
                          value={changelog}
                          onChange={(e) => setChangelog(e.target.value)}
                          maxLength={5000}
                          rows={4}
                          placeholder={
                            mode === "update"
                              ? "- Added live download progress bar\n- Fixed GCash menu layout\n- Improved Pinterest & Instagram downloads"
                              : "Write an announcement for the HutaoTik lobby…"
                          }
                          required
                        />
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <Label htmlFor="release-download-url" className="text-xs">
                            {mode === "update" ? "APK Download Link (HTTPS)" : "Link (optional)"}
                          </Label>
                          {mode === "update" && downloadUrl.trim() && (
                            <Badge
                              variant="outline"
                              className={`text-[10px] ${
                                directApkPreview
                                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                                  : "border-amber-500/40 bg-amber-500/10 text-amber-400"
                              }`}
                            >
                              {directApkPreview ? "Direct APK · In-app installer" : "Share link · Opens browser"}
                            </Badge>
                          )}
                        </div>
                        <Input
                          id="release-download-url"
                          type="url"
                          inputMode="url"
                          autoCapitalize="none"
                          value={downloadUrl}
                          onChange={(e) => setDownloadUrl(e.target.value)}
                          placeholder={
                            mode === "update"
                              ? "https://github.com/.../releases/download/v1.2.15/hutaotik.apk"
                              : "https://..."
                          }
                          required={mode === "update"}
                        />
                        <p className="text-[11px] text-muted-foreground">
                          {mode === "update"
                            ? "Tip: Direct .apk links (like GitHub Releases) download inside HutaoTik with a live progress bar and open Android's installer automatically. Google Drive / MediaFire links open in the browser."
                            : "Optional HTTPS link rendered as clickable text in the lobby."}
                        </p>
                      </div>

                      {mode === "update" ? (
                        <div className="space-y-3 rounded-xl border border-border bg-background/60 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <label htmlFor="mandatory-update-switch" className="cursor-pointer">
                              <span className="block text-xs font-semibold text-foreground">
                                Force / Mandatory Update
                              </span>
                              <span className="block text-[11px] text-muted-foreground">
                                Hide &ldquo;Later&rdquo; so users must update before continuing.
                              </span>
                            </label>
                            <Switch
                              id="mandatory-update-switch"
                              checked={isMandatory}
                              onCheckedChange={setIsMandatory}
                            />
                          </div>

                          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                            <div className="space-y-1">
                              <Label htmlFor="min-supported-code" className="text-[11px] text-muted-foreground">
                                Force below build # (optional)
                              </Label>
                              <Input
                                id="min-supported-code"
                                type="number"
                                min={1}
                                value={minSupportedCode}
                                onChange={(e) => setMinSupportedCode(e.target.value)}
                                placeholder="e.g. 28"
                                className="h-9 text-xs"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label htmlFor="release-sha256" className="text-[11px] text-muted-foreground">
                                APK SHA-256 (optional)
                              </Label>
                              <Input
                                id="release-sha256"
                                value={sha256}
                                onChange={(e) => setSha256(e.target.value)}
                                placeholder="64-char hex checksum"
                                maxLength={64}
                                className="h-9 font-mono text-xs"
                              />
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-3 rounded-xl border border-border bg-background/60 p-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <Label className="text-xs">Style</Label>
                              <Select
                                value={announcementColor}
                                onValueChange={(v) => setAnnouncementColor(v as "info" | "warning" | "update")}
                              >
                                <SelectTrigger className="h-9 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="info">Info (Orange)</SelectItem>
                                  <SelectItem value="update">Update (Blue)</SelectItem>
                                  <SelectItem value="warning">Warning (Red)</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            {!announcementPermanent && (
                              <div className="space-y-1.5">
                                <Label className="text-xs">Duration</Label>
                                <Select value={announcementDays} onValueChange={setAnnouncementDays}>
                                  <SelectTrigger className="h-9 text-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="1">1 Day</SelectItem>
                                    <SelectItem value="3">3 Days</SelectItem>
                                    <SelectItem value="7">7 Days</SelectItem>
                                    <SelectItem value="14">14 Days</SelectItem>
                                    <SelectItem value="30">30 Days</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            )}
                          </div>
                          <div className="flex items-center justify-between">
                            <Label htmlFor="ann-perm" className="text-xs">Pin permanently</Label>
                            <Switch
                              id="ann-perm"
                              checked={announcementPermanent}
                              onCheckedChange={setAnnouncementPermanent}
                            />
                          </div>
                        </div>
                      )}

                      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

                      <Button
                        type="submit"
                        disabled={busy}
                        className="h-11 w-full gap-2 rounded-xl font-bold"
                      >
                        {busy ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Publishing…
                          </>
                        ) : mode === "update" ? (
                          <>
                            <ArrowUpCircle className="h-4 w-4" />
                            Publish v{versionName || "?"} to All Users
                          </>
                        ) : (
                          <>
                            <Megaphone className="h-4 w-4" />
                            Publish Lobby Announcement
                          </>
                        )}
                      </Button>
                    </form>
                  </CardContent>
                </Card>

                {/* Live User Prompt Preview */}
                {mode === "update" && (
                  <Card className="rounded-2xl border-border bg-card/70">
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Smartphone className="h-4 w-4 text-primary" />
                        User Update Popup Preview
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="rounded-xl border border-primary/25 bg-background p-4 space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-bold">
                            HutaoTik {versionName || "1.2.15"} is available
                          </p>
                          {isMandatory && (
                            <Badge variant="destructive" className="text-[10px]">
                              Required
                            </Badge>
                          )}
                        </div>
                        {releaseTitle.trim() && (
                          <p className="text-xs font-semibold text-primary">{releaseTitle.trim()}</p>
                        )}
                        <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                          {changelog.trim() || "Install the latest version to get the newest improvements."}
                        </p>
                        <div className="flex gap-2 pt-1">
                          {!isMandatory && (
                            <div className="flex-1 rounded-lg border border-border py-1.5 text-center text-xs text-muted-foreground">
                              Later
                            </div>
                          )}
                          <div className="flex-1 rounded-lg bg-primary py-1.5 text-center text-xs font-bold text-primary-foreground">
                            {directApkPreview ? "Download & Update" : "Open Update Link"}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* ── TAB 2: RELEASES DATABASE ──────────────────────── */}
              <TabsContent value="releases" className="mt-4 space-y-3">
                {loadingDb && releases.length === 0 ? (
                  <div className="flex justify-center py-12">
                    <Loader2 className="h-7 w-7 animate-spin text-primary" />
                  </div>
                ) : releases.length === 0 ? (
                  <Card className="rounded-2xl border-dashed border-border bg-card p-8 text-center">
                    <Database className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
                    <p className="text-sm font-bold">No Releases in Database Yet</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Publish your first update from the Publish tab to notify users.
                    </p>
                  </Card>
                ) : (
                  releases.map((rel, index) => {
                    const isLatestLive = rel.isActive && releases.find((r) => r.isActive)?.id === rel.id;
                    const isDirect = isDirectApkInstallUrl(rel.downloadUrl, `${serverUrl}/`);
                    const isBusy = busyReleaseId === rel.id;

                    return (
                      <Card
                        key={rel.id}
                        className={`rounded-2xl border bg-card transition-opacity ${
                          isLatestLive
                            ? "border-primary/45 shadow-sm shadow-primary/10"
                            : !rel.isActive
                              ? "border-border opacity-70"
                              : "border-border"
                        }`}
                      >
                        <CardContent className="space-y-3 p-4">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-mono text-sm font-extrabold text-foreground">
                                  v{rel.versionName}
                                </span>
                                <Badge variant="outline" className="font-mono text-[10px]">
                                  Build {rel.versionCode}
                                </Badge>
                                {isLatestLive && (
                                  <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-[10px]">
                                    Live
                                  </Badge>
                                )}
                                {!rel.isActive && (
                                  <Badge variant="secondary" className="text-[10px]">
                                    Paused
                                  </Badge>
                                )}
                                {rel.isMandatory && (
                                  <Badge variant="destructive" className="text-[10px]">
                                    Mandatory
                                  </Badge>
                                )}
                              </div>
                              {rel.title && (
                                <p className="mt-1 text-xs font-semibold text-primary">{rel.title}</p>
                              )}
                              <p className="mt-0.5 text-[11px] text-muted-foreground">
                                Published {formatDate(rel.createdAt)} ·{" "}
                                <span className="font-semibold text-foreground">{rel.downloadCount}</span>{" "}
                                download{rel.downloadCount === 1 ? "" : "s"}
                                {index === 0 ? "" : ""}
                              </p>
                            </div>
                          </div>

                          <p className="whitespace-pre-wrap rounded-xl bg-background/60 p-2.5 text-xs leading-relaxed text-foreground/90">
                            {rel.changelog}
                          </p>

                          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            {isDirect ? (
                              <Download className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                            ) : (
                              <Globe className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                            )}
                            <a
                              href={rel.downloadUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="min-w-0 flex-1 truncate underline underline-offset-2 hover:text-primary"
                            >
                              {rel.downloadUrl}
                            </a>
                            <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
                          </div>

                          <div className="flex flex-wrap gap-2 pt-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={isBusy}
                              onClick={() => void toggleReleaseActive(rel)}
                              className="h-8 gap-1.5 rounded-lg text-xs"
                            >
                              {rel.isActive ? (
                                <>
                                  <PauseCircle className="h-3.5 w-3.5 text-amber-400" />
                                  Pause
                                </>
                              ) : (
                                <>
                                  <PlayCircle className="h-3.5 w-3.5 text-emerald-400" />
                                  Resume
                                </>
                              )}
                            </Button>

                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={isBusy}
                              onClick={() => openEditDialog(rel)}
                              className="h-8 gap-1.5 rounded-lg text-xs"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Edit
                            </Button>

                            {rel.isActive && stats?.firebaseConfigured && (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={isBusy}
                                onClick={() => void resendPushForRelease(rel)}
                                className="h-8 gap-1.5 rounded-lg text-xs"
                              >
                                <Bell className="h-3.5 w-3.5 text-primary" />
                                Push
                              </Button>
                            )}

                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={isBusy}
                              onClick={() => setDeleteTarget(rel)}
                              className="ml-auto h-8 gap-1 rounded-lg text-xs text-destructive hover:bg-destructive/15 hover:text-destructive"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Delete
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })
                )}
              </TabsContent>

              {/* ── TAB 3: USERS & FLEET ANALYTICS + BROADCASTS ──── */}
              <TabsContent value="fleet" className="mt-4 space-y-4">
                <Card className="rounded-2xl border-border bg-card">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Users className="h-4 w-4 text-primary" />
                      User Fleet Overview
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Devices check in anonymously when users open HutaoTik, showing who is up to date.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {stats ? (
                      <>
                        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                          <div className="rounded-xl border border-border bg-background/60 p-3">
                            <p className="text-[10px] uppercase text-muted-foreground">Total Devices</p>
                            <p className="mt-0.5 font-mono text-lg font-bold">{stats.totalDevices}</p>
                          </div>
                          <div className="rounded-xl border border-border bg-background/60 p-3">
                            <p className="text-[10px] uppercase text-muted-foreground">Active 7d</p>
                            <p className="mt-0.5 font-mono text-lg font-bold text-primary">
                              {stats.activeLast7Days}
                            </p>
                          </div>
                          <div className="rounded-xl border border-border bg-background/60 p-3">
                            <p className="text-[10px] uppercase text-muted-foreground">Up to Date</p>
                            <p className="mt-0.5 font-mono text-lg font-bold text-emerald-400">
                              {stats.upToDateCount}
                            </p>
                          </div>
                          <div className="rounded-xl border border-border bg-background/60 p-3">
                            <p className="text-[10px] uppercase text-muted-foreground">Outdated</p>
                            <p className="mt-0.5 font-mono text-lg font-bold text-amber-400">
                              {stats.outdatedCount}
                            </p>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                            Installed Versions
                          </p>
                          {stats.versionBreakdown.length === 0 ? (
                            <p className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                              No device check-ins recorded yet. Devices appear here once users open the updated app.
                            </p>
                          ) : (
                            <div className="space-y-2">
                              {stats.versionBreakdown.map((row) => {
                                const pct =
                                  stats.totalDevices > 0
                                    ? Math.round((row.count / stats.totalDevices) * 100)
                                    : 0;
                                const isCurrent =
                                  stats.latestActiveVersionCode !== null &&
                                  row.versionCode >= stats.latestActiveVersionCode;
                                return (
                                  <div
                                    key={row.versionCode}
                                    className="space-y-1.5 rounded-xl border border-border bg-background/60 p-3"
                                  >
                                    <div className="flex items-center justify-between text-xs">
                                      <span className="font-mono font-bold">
                                        v{row.versionName}{" "}
                                        <span className="font-normal text-muted-foreground">
                                          (Build {row.versionCode})
                                        </span>
                                      </span>
                                      <span className="font-mono font-semibold text-muted-foreground">
                                        {row.count} ({pct}%)
                                      </span>
                                    </div>
                                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                                      <div
                                        className={`h-full rounded-full ${isCurrent ? "bg-emerald-500" : "bg-primary"}`}
                                        style={{ width: `${Math.max(pct, 4)}%` }}
                                      />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center justify-between rounded-xl border border-border bg-background/60 p-3 text-xs">
                          <span className="flex items-center gap-2 text-muted-foreground">
                            <Bell className="h-4 w-4 text-primary" />
                            Firebase Push Notifications
                          </span>
                          <Badge
                            variant="outline"
                            className={
                              stats.firebaseConfigured
                                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                                : "border-border text-muted-foreground"
                            }
                          >
                            {stats.firebaseConfigured
                              ? `Active (${stats.pushTokenCount} tokens)`
                              : "App-open mode (no FCM)"}
                          </Badge>
                        </div>
                      </>
                    ) : (
                      <div className="flex justify-center py-6">
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Lobby Announcements Management */}
                <Card className="rounded-2xl border-border bg-card">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Megaphone className="h-4 w-4 text-primary" />
                      Lobby Announcements ({announcements.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2.5">
                    {announcements.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                        No lobby announcements posted.
                      </p>
                    ) : (
                      announcements.map((ann) => (
                        <div
                          key={ann.id}
                          className={`flex items-start justify-between gap-3 rounded-xl border border-border bg-background/60 p-3 ${
                            ann.isActive ? "" : "opacity-60"
                          }`}
                        >
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex items-center gap-1.5">
                              <Badge variant="outline" className="text-[10px] uppercase">
                                {ann.colorType}
                              </Badge>
                              <span className="text-[10px] text-muted-foreground">
                                {ann.isPermanent ? "Permanent" : "Timed"}
                              </span>
                            </div>
                            <p className="whitespace-pre-wrap break-words text-xs">{ann.content}</p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <Switch
                              checked={ann.isActive}
                              onCheckedChange={() => void toggleAnnouncement(ann)}
                              aria-label="Toggle announcement active"
                            />
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              onClick={() => void deleteAnnouncement(ann.id)}
                              className="h-8 w-8 text-destructive hover:bg-destructive/15"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>

      {/* Edit Release Dialog */}
      <Dialog open={editingRelease !== null} onOpenChange={(open) => !open && setEditingRelease(null)}>
        <DialogContent className="max-w-md rounded-2xl border-border bg-card">
          <DialogHeader>
            <DialogTitle>
              Edit Release {editingRelease ? `(Build ${editingRelease.versionCode})` : ""}
            </DialogTitle>
            <DialogDescription>
              Update the release title, download link, changelog, or mandatory requirement.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={saveEditRelease} className="space-y-3">
            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <Label htmlFor="edit-ver-name" className="text-xs">Version Name</Label>
                <Input
                  id="edit-ver-name"
                  value={editVersionName}
                  onChange={(e) => setEditVersionName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-min-code" className="text-xs">Force below build #</Label>
                <Input
                  id="edit-min-code"
                  type="number"
                  min={1}
                  value={editMinSupported}
                  onChange={(e) => setEditMinSupported(e.target.value)}
                  placeholder="Optional"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-title" className="text-xs">Headline</Label>
              <Input
                id="edit-title"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                maxLength={120}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-url" className="text-xs">HTTPS APK Download Link</Label>
              <Input
                id="edit-url"
                type="url"
                value={editDownloadUrl}
                onChange={(e) => setEditDownloadUrl(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-changelog" className="text-xs">Changelog</Label>
              <Textarea
                id="edit-changelog"
                rows={4}
                value={editChangelog}
                onChange={(e) => setEditChangelog(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-sha256" className="text-xs">SHA-256 (optional)</Label>
              <Input
                id="edit-sha256"
                value={editSha256}
                onChange={(e) => setEditSha256(e.target.value)}
                className="font-mono text-xs"
                maxLength={64}
              />
            </div>
            <div className="flex items-center justify-between rounded-xl border border-border bg-background/60 px-3 py-2.5">
              <Label htmlFor="edit-mandatory" className="text-xs">Mandatory Update</Label>
              <Switch
                id="edit-mandatory"
                checked={editMandatory}
                onCheckedChange={setEditMandatory}
              />
            </div>
            <DialogFooter className="gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setEditingRelease(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={savingEdit}>
                {savingEdit ? "Saving…" : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Server URL Settings Dialog */}
      <Dialog open={serverDialogOpen} onOpenChange={setServerDialogOpen}>
        <DialogContent className="max-w-md rounded-2xl border-border bg-card">
          <DialogHeader>
            <DialogTitle>Hutaotik API Server</DialogTitle>
            <DialogDescription>
              Direct passwordless access is enabled via this admin app&apos;s built-in private key. Update the Render server URL here if it ever changes.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={saveServerSettings} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="settings-api-url" className="text-xs">API Base URL</Label>
              <Input
                id="settings-api-url"
                type="url"
                inputMode="url"
                autoCapitalize="none"
                value={serverUrlDraft}
                onChange={(event) => setServerUrlDraft(event.target.value)}
                placeholder={DEFAULT_API_SERVER_URL}
                required
              />
            </div>
            {serverDialogError && (
              <p role="alert" className="text-xs text-destructive">
                {serverDialogError}
              </p>
            )}
            <DialogFooter className="gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setServerDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={savingServerUrl}>
                {savingServerUrl ? "Checking…" : "Save & Reconnect"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Release Confirmation */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete v{deleteTarget?.versionName}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes Build {deleteTarget?.versionCode} from the App Update Database. If you only want to stop users from updating to it, use Pause instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmDeleteRelease()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete Release
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
