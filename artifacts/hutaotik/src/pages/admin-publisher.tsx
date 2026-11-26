import { useState, type FormEvent } from "react";
import { apiUrl, saveAdminApiUrl } from "@/lib/api-url";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

type PublishResult = {
  release: { versionName: string; versionCode: number };
  push: {
    status: "sent" | "partial" | "not_configured" | "failed";
    deviceCount: number;
    deliveredCount: number;
  };
  warning?: string;
};
type PublishMode = "update" | "announcement";
type PublishFeedback = {
  message: string;
  push?: PublishResult["push"];
  warning?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
          "This Render API does not have the app-update publishing endpoint yet. Deploy the latest Hutaotik API code to Render, then try again. Normal announcements use a separate endpoint.",
        );
      }
      if (response.status === 503) {
        throw new Error(
          "The Hutaotik API is suspended or unavailable (HTTP 503). In Render, resume the hutaotiktok-api service and wait until it is live, then try again.",
        );
      }
      throw new Error(
        `The API check received a website page (HTTP ${response.status}) from ${response.url}. Enter only the Render service base URL: https://hutaotiktok-mja6.onrender.com. The app adds the API path automatically.`,
      );
    }
    if (response.status === 503) {
      throw new Error(
        "The Hutaotik API is unavailable (HTTP 503). In Render, resume the hutaotiktok-api service and try again when it is live.",
      );
    }
    if (cause instanceof SyntaxError) {
      throw new Error("The API server returned an invalid JSON response.");
    }
    throw cause;
  }

  if (!isRecord(data)) {
    throw new Error("The API server returned an unexpected response.");
  }
  return data;
}

export default function AdminPublisher() {
  const [token, setToken] = useState(() => localStorage.getItem("hutaotik_release_admin_token") ?? "");
  const [serverUrl, setServerUrl] = useState(
    () => import.meta.env.VITE_API_URL?.trim() || localStorage.getItem("hutaotik_admin_api_url") || "",
  );
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<PublishMode>("update");
  const [changelog, setChangelog] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PublishFeedback | null>(null);

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
        throw new Error("This URL is not the Hutaotik API service. Check the Render web service URL and try again.");
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
      const response = await fetch(
        apiUrl(isUpdate ? "/api/admin/app-updates" : "/api/admin/announcements"),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-admin-token": token,
          },
          body: JSON.stringify(
            isUpdate
            ? {
                changelog: content,
                downloadUrl: link,
                }
              : {
                  content: link ? `${content}\n\n${link}` : content,
                  colorType: "info",
                  durationDays: 7,
                  isPermanent: false,
                },
          ),
        },
      );
      const data = await readApiResponse(response);
      if (response.status === 401) {
        localStorage.removeItem("hutaotik_release_admin_token");
        setToken("");
        throw new Error("Your admin session expired. Sign in again.");
      }
      if (!response.ok) {
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : "The release could not be published.",
        );
      }
      if (isUpdate) {
        const published = data as PublishResult;
        setResult({
          message: `Version ${published.release.versionName} published.`,
          push: published.push,
          warning: published.warning,
        });
      } else {
        setResult({ message: "Announcement published to the Hutaotik lobby." });
      }
      setChangelog("");
      setDownloadUrl("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The post could not be published.");
    } finally {
      setBusy(false);
    }
  };

  const signOut = () => {
    localStorage.removeItem("hutaotik_release_admin_token");
    setToken("");
    setResult(null);
  };

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground">
      <div className="mx-auto max-w-xl space-y-6">
        <header>
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-primary">Release Console</p>
          <h1 className="mt-2 text-3xl font-extrabold">Hutaotik Admin</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Publish an app update or a regular announcement to the Hutaotik lobby.
          </p>
        </header>

        {!token ? (
          <Card>
            <CardHeader>
              <CardTitle>Admin sign-in</CardTitle>
              <CardDescription>Use the admin password configured on the Hutaotik API server.</CardDescription>
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
                    placeholder="https://api.example.com"
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
                <Button type="submit" disabled={busy} className="w-full">
                  {busy ? "Signing in..." : "Sign in"}
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle>New post</CardTitle>
                <CardDescription>
                  Choose an update prompt or a regular lobby announcement.
                </CardDescription>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={signOut}>Sign out</Button>
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
                  className="grid grid-cols-2 gap-3"
                  aria-label="Post type"
                >
                  <Label
                    htmlFor="post-type-update"
                    className="flex cursor-pointer items-center gap-2 rounded-lg border p-3"
                  >
                    <RadioGroupItem id="post-type-update" value="update" />
                    App update
                  </Label>
                  <Label
                    htmlFor="post-type-announcement"
                    className="flex cursor-pointer items-center gap-2 rounded-lg border p-3"
                  >
                    <RadioGroupItem id="post-type-announcement" value="announcement" />
                    Normal announcement
                  </Label>
                </RadioGroup>
                <div className="space-y-2">
                  <Label htmlFor="release-changelog">
                    {mode === "update" ? "Update announcement" : "Announcement"}
                  </Label>
                  <Textarea
                    id="release-changelog"
                    value={changelog}
                    onChange={(event) => setChangelog(event.target.value)}
                    maxLength={5000}
                    rows={4}
                    placeholder={
                      mode === "update"
                        ? "Write the message users will see in the update prompt."
                        : "Write an announcement for the Hutaotik lobby."
                    }
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="release-download-url">
                    {mode === "update" ? "Update download link" : "Link (optional)"}
                  </Label>
                  <Input
                    id="release-download-url"
                    type="url"
                    inputMode="url"
                    autoCapitalize="none"
                    value={downloadUrl}
                    onChange={(event) => setDownloadUrl(event.target.value)}
                    placeholder="https://drive.google.com/... or https://mediafire.com/..."
                    required={mode === "update"}
                  />
                  <p className="text-xs text-muted-foreground">
                    {mode === "update"
                      ? "Paste a public HTTPS link, such as Google Drive, MediaFire, or a direct APK link. Shared links open in your browser. The app version is assigned automatically."
                      : "Add a public HTTPS link to make it clickable in the lobby announcement."}
                  </p>
                </div>
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                {result && (
                  <div role="status" className="space-y-1 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
                    <p className="font-semibold">{result.message}</p>
                    {result.push && (
                      <p className="text-muted-foreground">
                        Push alerts: {result.push.deliveredCount} of {result.push.deviceCount} delivered
                        ({result.push.status.replaceAll("_", " ")}).
                      </p>
                    )}
                    {result.warning && <p className="text-amber-500">{result.warning}</p>}
                  </div>
                )}
                <Button type="submit" disabled={busy} className="w-full">
                  {busy ? "Publishing..." : mode === "update" ? "Publish app update" : "Publish announcement"}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
