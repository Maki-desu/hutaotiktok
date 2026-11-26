import { useRef, useState, type FormEvent } from "react";
import { ArrowUpCircle, Bell, Check, FileArchive, ShieldCheck, Smartphone, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const CURRENT_VERSION_CODE = 17;

export default function PublishPreview() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [versionName, setVersionName] = useState("1.2.4");
  const [versionCode, setVersionCode] = useState(String(CURRENT_VERSION_CODE + 1));
  const [changelog, setChangelog] = useState("Bug fixes and improvements.");
  const [apk, setApk] = useState<File | null>(null);
  const [published, setPublished] = useState(false);
  const [error, setError] = useState("");

  const publishDemo = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setPublished(false);

    if (Number(versionCode) <= CURRENT_VERSION_CODE) {
      setError(`Version code must be greater than ${CURRENT_VERSION_CODE}.`);
      return;
    }
    if (!/^[0-9A-Za-z.-]{1,32}$/.test(versionName)) {
      setError("Version name can use letters, numbers, dots, and hyphens (up to 32 characters).");
      return;
    }
    if (!apk) {
      setError("Choose the Hutaotik APK file first.");
      return;
    }
    if (!apk.name.toLowerCase().endsWith(".apk")) {
      setError("Choose a .apk file.");
      return;
    }

    setPublished(true);
  };

  const reset = () => {
    setPublished(false);
    setError("");
    setApk(null);
    if (fileInput.current) fileInput.current.value = "";
  };

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground md:px-8">
      <div className="mx-auto max-w-6xl space-y-8">
        <header className="space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            <ShieldCheck className="h-4 w-4" />
            INTERACTIVE PREVIEW · NO REAL UPLOAD
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight md:text-4xl">Publish a Hutaotik update</h1>
          <p className="max-w-2xl text-muted-foreground">
            Try the release form and see what users will see. This preview does not contact the server,
            send notifications, or publish the selected file.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5 text-primary" />
                Release details
              </CardTitle>
              <CardDescription>
                The current Hutaotik baseline is version code {CURRENT_VERSION_CODE}. New releases need a higher code.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-5" onSubmit={publishDemo}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="preview-version-name">Version name</Label>
                    <Input
                      id="preview-version-name"
                      value={versionName}
                      onChange={(event) => setVersionName(event.target.value)}
                      placeholder="1.2.4"
                      maxLength={32}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="preview-version-code">Version code</Label>
                    <Input
                      id="preview-version-code"
                      type="number"
                      min={CURRENT_VERSION_CODE + 1}
                      step="1"
                      value={versionCode}
                      onChange={(event) => setVersionCode(event.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="preview-changelog">What changed?</Label>
                  <Textarea
                    id="preview-changelog"
                    rows={4}
                    maxLength={5000}
                    value={changelog}
                    onChange={(event) => setChangelog(event.target.value)}
                    placeholder="Summarize this release for users."
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="preview-apk">Hutaotik APK</Label>
                  <input
                    ref={fileInput}
                    id="preview-apk"
                    type="file"
                    accept="*/*"
                    className="flex min-h-11 w-full cursor-pointer rounded-md border border-input bg-background px-3 py-2 text-sm file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:font-semibold file:text-primary-foreground"
                    onChange={(event) => {
                      setError("");
                      setPublished(false);
                      setApk(event.currentTarget.files?.[0] ?? null);
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    Select the Hutaotik release APK, not Hutaotik Admin. Maximum upload size on the API is 500 MiB.
                  </p>
                  {apk && (
                    <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-3 text-sm">
                      <FileArchive className="h-4 w-4 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1 truncate">{apk.name}</span>
                      <span className="shrink-0 text-muted-foreground">{(apk.size / 1024 / 1024).toFixed(1)} MiB</span>
                    </div>
                  )}
                </div>

                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

                {published ? (
                  <div role="status" className="flex gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
                    <Check className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
                    <div className="space-y-1">
                      <p className="font-semibold">Preview published successfully</p>
                      <p className="text-sm text-muted-foreground">
                        Demo only: no APK was uploaded and no users were notified.
                      </p>
                    </div>
                  </div>
                ) : (
                  <Button type="submit" className="w-full gap-2">
                    <ArrowUpCircle className="h-4 w-4" />
                    Preview publish
                  </Button>
                )}
                {published && (
                  <Button type="button" variant="outline" className="w-full" onClick={reset}>
                    Try another release
                  </Button>
                )}
              </form>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Smartphone className="h-5 w-5 text-primary" />
                  What Hutaotik users see
                </CardTitle>
                <CardDescription>
                  When the app checks the server and finds a newer version, it shows this update prompt.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="mx-auto max-w-sm rounded-[2rem] border-4 border-muted bg-background p-3 shadow-lg">
                  <div className="mx-auto mb-4 h-1.5 w-16 rounded-full bg-muted" />
                  <div className="rounded-xl border bg-card p-5 shadow-sm">
                    <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <ArrowUpCircle className="h-6 w-6" />
                    </div>
                    <h2 className="text-lg font-bold">Hutaotik {versionName || "1.2.4"} is available</h2>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                      {changelog || "Install the latest version to get the newest improvements."}
                    </p>
                    <div className="mt-5 grid grid-cols-2 gap-2">
                      <div className="rounded-md border px-3 py-2 text-center text-sm">Later</div>
                      <div className="rounded-md bg-primary px-3 py-2 text-center text-sm font-semibold text-primary-foreground">
                        Download and update
                      </div>
                    </div>
                  </div>
                  <div className="mx-auto mt-4 h-1 w-20 rounded-full bg-muted" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex gap-3 p-5">
                <Bell className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div className="space-y-1">
                  <p className="font-semibold">How notification delivery works</p>
                  <p className="text-sm text-muted-foreground">
                    Users with the updater-enabled Hutaotik app see the prompt when they open the app. Push alerts
                    while the app is closed require Firebase setup and user permission. Android always asks users to
                    confirm the installation.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </main>
  );
}
