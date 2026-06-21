import { useState, useRef, useCallback, useEffect } from "react";
import {
  useAdminLogin,
  useGetAdminSettings,
  getGetAdminSettingsQueryKey,
  useUpdateAdminSettings,
  useAdminListAnnouncements,
  getAdminListAnnouncementsQueryKey,
  useCreateAnnouncement,
  useUpdateAnnouncement,
  useDeleteAnnouncement,
  useListMonitoredAccounts,
  getListMonitoredAccountsQueryKey,
  useAddMonitoredAccount,
  useRemoveMonitoredAccount,
  useToggleMonitoredAccount,
  getGetPublicSettingsQueryKey,
  setExtraHeaders,
  clearExtraHeaders,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, ShieldAlert, Plus, Trash2, Link as LinkIcon, Settings2, Bell,
  MessageSquare, Upload, X, Pin, Clapperboard, ToggleLeft, Download,
  Clock, LockKeyhole, Youtube
} from "lucide-react";
import { SiFacebook } from "react-icons/si";
import { useToast } from "@/hooks/use-toast";

interface ShowcaseVideoAdmin {
  id: number;
  tiktokUrl: string;
  videoId: string;
  title: string;
  authorUsername: string;
  authorDisplayName: string | null;
  authorAvatar: string | null;
  thumbnail: string | null;
  playUrl: string;
  isPinned: boolean;
  pinnedAt: string | null;
  createdAt: string;
}

interface ImageDropZoneProps {
  label: string;
  value: string;
  onChange: (url: string) => void;
  aspect?: "square" | "wide";
}

function ImageDropZone({ label, value, onChange, aspect = "square" }: ImageDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const uploadFile = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Only image files are supported", variant: "destructive" });
      return;
    }
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("image", file);
      const token = localStorage.getItem("admin_token");
      const res = await fetch("/api/admin/upload-image", {
        method: "POST",
        headers: token ? { "x-admin-token": token } : {},
        body: formData,
      });
      if (!res.ok) throw new Error(await res.text());
      const { url } = await res.json() as { url: string };
      onChange(url);
      toast({ title: "Image uploaded" });
    } catch (err: unknown) {
      toast({ title: "Upload failed", description: String(err), variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  }, [onChange, toast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
  }, [uploadFile]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    e.target.value = "";
  };

  const previewClass = aspect === "wide"
    ? "w-full h-24 rounded-md object-cover"
    : "w-12 h-12 rounded-full object-cover";

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div
        role="button"
        tabIndex={0}
        className={`relative border-2 border-dashed rounded-xl p-4 transition-all cursor-pointer flex flex-col items-center justify-center gap-2 min-h-[80px]
          ${isDragging ? "border-primary bg-primary/10" : "border-border hover:border-primary/50 hover:bg-secondary/40"}
          ${isUploading ? "opacity-60 pointer-events-none" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />

        {value ? (
          <div className="flex items-center gap-4 w-full">
            <img
              src={value}
              alt="preview"
              className={previewClass}
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">Image set</p>
              <p className="text-xs text-muted-foreground truncate">{value.startsWith("/api/uploads/") ? "Uploaded file" : value}</p>
            </div>
            <button
              type="button"
              className="shrink-0 p-1 rounded-full hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
              onClick={(e) => { e.stopPropagation(); onChange(""); }}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <>
            {isUploading ? (
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
            ) : (
              <Upload className="w-6 h-6 text-muted-foreground" />
            )}
            <p className="text-sm text-muted-foreground text-center">
              {isUploading ? "Uploading…" : "Drop image here or click to browse"}
            </p>
          </>
        )}
      </div>

      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="or paste URL directly…"
        className="bg-background border-border text-xs"
      />
    </div>
  );
}

export default function Admin() {
  const [password, setPassword] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem("admin_token"));
  const { toast } = useToast();

  const loginMutation = useAdminLogin();
  const queryClient = useQueryClient();

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    loginMutation.mutate({ data: { password } }, {
      onSuccess: (res) => {
        if (res.success && res.token) {
          localStorage.setItem("admin_token", res.token);
          setExtraHeaders({ "x-admin-token": res.token });
          setIsAuthenticated(true);
          toast({ title: "Logged in successfully" });
        } else {
          toast({ title: "Invalid password", variant: "destructive" });
        }
      },
      onError: () => {
        toast({ title: "Login failed", variant: "destructive" });
      }
    });
  };

  const handleLogout = () => {
    localStorage.removeItem("admin_token");
    clearExtraHeaders();
    setIsAuthenticated(false);
  };

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center py-20 animate-in fade-in">
        <Card className="w-full max-w-sm border-border bg-card shadow-xl shadow-primary/5">
          <CardHeader className="text-center space-y-2">
            <div className="w-12 h-12 bg-primary/20 rounded-full flex items-center justify-center mx-auto mb-2 text-primary">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <CardTitle className="font-syne text-2xl">Admin Access</CardTitle>
            <CardDescription>Enter password to access dashboard</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <Input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-background border-border"
              />
              <Button type="submit" className="w-full" disabled={loginMutation.isPending}>
                {loginMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Login
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-syne font-bold">Admin Dashboard</h1>
        <Button variant="outline" onClick={handleLogout}>
          Logout
        </Button>
      </div>

      <Tabs defaultValue="branding" className="w-full">
        <TabsList className="grid grid-cols-3 sm:grid-cols-6 bg-card border border-border rounded-xl p-1 mb-6 gap-1">
          <TabsTrigger value="branding" className="rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-xs">
            <Settings2 className="w-3.5 h-3.5 mr-1 hidden sm:block" />Branding
          </TabsTrigger>
          <TabsTrigger value="social" className="rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-xs">
            <LinkIcon className="w-3.5 h-3.5 mr-1 hidden sm:block" />Social
          </TabsTrigger>
          <TabsTrigger value="announcements" className="rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-xs">
            <MessageSquare className="w-3.5 h-3.5 mr-1 hidden sm:block" />Broadcasts
          </TabsTrigger>
          <TabsTrigger value="monitored" className="rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-xs">
            <Bell className="w-3.5 h-3.5 mr-1 hidden sm:block" />Monitored
          </TabsTrigger>
          <TabsTrigger value="showcase" className="rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-xs">
            <Clapperboard className="w-3.5 h-3.5 mr-1 hidden sm:block" />Showcase
          </TabsTrigger>
          <TabsTrigger value="features" className="rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-xs">
            <ToggleLeft className="w-3.5 h-3.5 mr-1 hidden sm:block" />Features
          </TabsTrigger>
        </TabsList>

        <TabsContent value="branding"><BrandingTab /></TabsContent>
        <TabsContent value="social"><SocialTab /></TabsContent>
        <TabsContent value="announcements"><AnnouncementsTab /></TabsContent>
        <TabsContent value="monitored"><MonitoredTab /></TabsContent>
        <TabsContent value="showcase"><ShowcaseManagerTab /></TabsContent>
        <TabsContent value="features"><FeaturesTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function BrandingTab() {
  const { data: settings, isLoading } = useGetAdminSettings({ query: { queryKey: getGetAdminSettingsQueryKey() } });
  const updateMutation = useUpdateAdminSettings();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    siteTitle: "",
    footerText: "",
    adminName: "",
    logoUrl: "",
    bannerUrl: ""
  });

  if (settings && formData.siteTitle === "" && formData.footerText === "") {
    setFormData({
      siteTitle: settings.siteTitle || "",
      footerText: settings.footerText || "",
      adminName: settings.adminName || "",
      logoUrl: settings.logoUrl || "",
      bannerUrl: settings.bannerUrl || ""
    });
  }

  const handleSave = () => {
    updateMutation.mutate({ data: formData }, {
      onSuccess: () => {
        toast({ title: "Settings saved" });
        queryClient.invalidateQueries({ queryKey: getGetAdminSettingsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetPublicSettingsQueryKey() });
      }
    });
  };

  if (isLoading) return <div className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" /></div>;

  return (
    <div className="grid gap-6">
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle>Site Identity</CardTitle>
          <CardDescription>Basic information for the site</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Site Title</Label>
            <Input value={formData.siteTitle} onChange={e => setFormData({ ...formData, siteTitle: e.target.value })} className="bg-background border-border" />
          </div>
          <div className="space-y-2">
            <Label>Footer Text</Label>
            <Input value={formData.footerText} onChange={e => setFormData({ ...formData, footerText: e.target.value })} className="bg-background border-border" />
          </div>
          <div className="space-y-2">
            <Label>Admin / Creator Name</Label>
            <Input
              value={formData.adminName}
              onChange={e => setFormData({ ...formData, adminName: e.target.value })}
              className="bg-background border-border"
              placeholder="e.g. Hutao"
            />
            <p className="text-xs text-muted-foreground">Shown on the TikTok profile card on the homepage.</p>
          </div>

          <div className="pt-4 space-y-4">
            <h3 className="font-medium">Images</h3>
            <div className="grid md:grid-cols-2 gap-4">
              <ImageDropZone
                label="Logo (1:1 square)"
                value={formData.logoUrl}
                onChange={(url) => setFormData({ ...formData, logoUrl: url })}
                aspect="square"
              />
              <ImageDropZone
                label="Banner (16:9 wide)"
                value={formData.bannerUrl}
                onChange={(url) => setFormData({ ...formData, bannerUrl: url })}
                aspect="wide"
              />
            </div>
          </div>

          <Button onClick={handleSave} disabled={updateMutation.isPending} className="mt-4">
            {updateMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Save Changes
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function SocialTab() {
  const { data: settings, isLoading } = useGetAdminSettings({ query: { queryKey: getGetAdminSettingsQueryKey() } });
  const updateMutation = useUpdateAdminSettings();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    tiktokProfileUrl: "",
    tiktokAvatarUrl: ""
  });

  if (settings && formData.tiktokProfileUrl === "" && settings.tiktokProfileUrl) {
    setFormData({
      tiktokProfileUrl: settings.tiktokProfileUrl || "",
      tiktokAvatarUrl: settings.tiktokAvatarUrl || ""
    });
  }

  const handleSave = () => {
    updateMutation.mutate({ data: formData }, {
      onSuccess: () => {
        toast({ title: "Social links saved" });
        queryClient.invalidateQueries({ queryKey: getGetAdminSettingsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetPublicSettingsQueryKey() });
      }
    });
  };

  if (isLoading) return <div className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" /></div>;

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle>TikTok Profile Integration</CardTitle>
        <CardDescription>Link your main TikTok account to the lobby</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>TikTok Profile URL</Label>
          <Input
            value={formData.tiktokProfileUrl}
            onChange={e => setFormData({ ...formData, tiktokProfileUrl: e.target.value })}
            placeholder="https://tiktok.com/@username"
            className="bg-background border-border"
          />
          <p className="text-xs text-muted-foreground">Visitors clicking your avatar will be taken here.</p>
        </div>
        <ImageDropZone
          label="TikTok Avatar (profile picture)"
          value={formData.tiktokAvatarUrl}
          onChange={(url) => setFormData({ ...formData, tiktokAvatarUrl: url })}
          aspect="square"
        />
        <Button onClick={handleSave} disabled={updateMutation.isPending}>
          {updateMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Save Social Links
        </Button>
      </CardContent>
    </Card>
  );
}

function AnnouncementsTab() {
  const { data: announcements, isLoading } = useAdminListAnnouncements({ query: { queryKey: getAdminListAnnouncementsQueryKey() } });
  const createMutation = useCreateAnnouncement();
  const deleteMutation = useDeleteAnnouncement();
  const updateMutation = useUpdateAnnouncement();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [newAnn, setNewAnn] = useState({
    content: "",
    colorType: "info" as "info" | "warning" | "update",
    durationDays: 7,
    isPermanent: false
  });

  const handleCreate = () => {
    if (!newAnn.content) return;
    createMutation.mutate({ data: newAnn }, {
      onSuccess: () => {
        toast({ title: "Announcement created" });
        setNewAnn({ content: "", colorType: "info", durationDays: 7, isPermanent: false });
        queryClient.invalidateQueries({ queryKey: getAdminListAnnouncementsQueryKey() });
        queryClient.invalidateQueries({ queryKey: ["/api/announcements"] });
      }
    });
  };

  const handleDelete = (id: number) => {
    deleteMutation.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Announcement deleted" });
        queryClient.invalidateQueries({ queryKey: getAdminListAnnouncementsQueryKey() });
        queryClient.invalidateQueries({ queryKey: ["/api/announcements"] });
      }
    });
  };

  const toggleActive = (id: number, current: boolean) => {
    updateMutation.mutate({ id, data: { isActive: !current } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getAdminListAnnouncementsQueryKey() });
        queryClient.invalidateQueries({ queryKey: ["/api/announcements"] });
      }
    });
  };

  return (
    <div className="grid md:grid-cols-[1fr_2fr] gap-6">
      <Card className="bg-card border-border h-fit">
        <CardHeader>
          <CardTitle>New Broadcast</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Message</Label>
            <Textarea
              value={newAnn.content}
              onChange={e => setNewAnn({ ...newAnn, content: e.target.value })}
              placeholder="Enter announcement text..."
              className="bg-background border-border min-h-[100px]"
            />
          </div>
          <div className="space-y-2">
            <Label>Type</Label>
            <Select value={newAnn.colorType} onValueChange={(v: "info" | "warning" | "update") => setNewAnn({ ...newAnn, colorType: v })}>
              <SelectTrigger className="bg-background border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="info">Info (Orange)</SelectItem>
                <SelectItem value="warning">Warning (Red)</SelectItem>
                <SelectItem value="update">Update (Blue)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between">
            <Label>Permanent</Label>
            <Switch checked={newAnn.isPermanent} onCheckedChange={c => setNewAnn({ ...newAnn, isPermanent: c })} />
          </div>
          {!newAnn.isPermanent && (
            <div className="space-y-2">
              <Label>Duration</Label>
              <Select value={newAnn.durationDays.toString()} onValueChange={(v) => setNewAnn({ ...newAnn, durationDays: parseInt(v) })}>
                <SelectTrigger className="bg-background border-border">
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
          <Button onClick={handleCreate} disabled={createMutation.isPending || !newAnn.content} className="w-full mt-2">
            <Plus className="w-4 h-4 mr-2" /> Add Announcement
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <h3 className="font-medium text-lg">Active & Recent Broadcasts</h3>
        {isLoading ? (
          <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : announcements?.length === 0 ? (
          <div className="text-center p-8 border border-dashed border-border rounded-xl text-muted-foreground">No announcements found.</div>
        ) : (
          <div className="grid gap-3">
            {announcements?.map(ann => (
              <Card key={ann.id} className={`border-border bg-card ${!ann.isActive ? 'opacity-60' : ''}`}>
                <CardContent className="p-4 flex items-center justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`w-3 h-3 rounded-full ${ann.colorType === 'info' ? 'bg-primary' : ann.colorType === 'warning' ? 'bg-destructive' : 'bg-blue-500'}`} />
                      <span className="text-xs font-bold uppercase text-muted-foreground">{ann.colorType}</span>
                      {ann.isPermanent ? (
                        <span className="text-xs bg-secondary px-2 rounded-full">Permanent</span>
                      ) : (
                        <span className="text-xs bg-secondary px-2 rounded-full">Until {new Date(ann.expiresAt!).toLocaleDateString()}</span>
                      )}
                    </div>
                    <p className="text-sm">{ann.content}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="flex items-center gap-2">
                      <Label className="text-xs text-muted-foreground">Active</Label>
                      <Switch checked={ann.isActive} onCheckedChange={() => toggleActive(ann.id, ann.isActive)} />
                    </div>
                    <Button variant="ghost" size="icon" className="text-destructive hover:bg-destructive/20 hover:text-destructive" onClick={() => handleDelete(ann.id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MonitoredTab() {
  const { data: accounts, isLoading } = useListMonitoredAccounts({ query: { queryKey: getListMonitoredAccountsQueryKey() } });
  const addMutation = useAddMonitoredAccount();
  const removeMutation = useRemoveMonitoredAccount();
  const toggleMutation = useToggleMonitoredAccount();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [newAcc, setNewAcc] = useState({ tiktokUrl: "", username: "" });

  const handleAdd = () => {
    if (!newAcc.tiktokUrl || !newAcc.username) return;
    addMutation.mutate({ data: newAcc }, {
      onSuccess: () => {
        toast({ title: "Account added to monitoring" });
        setNewAcc({ tiktokUrl: "", username: "" });
        queryClient.invalidateQueries({ queryKey: getListMonitoredAccountsQueryKey() });
      },
      onError: (err: unknown) => {
        toast({ title: "Failed to add account", description: (err as { error?: { error?: string } }).error?.error, variant: "destructive" });
      }
    });
  };

  const handleRemove = (id: number) => {
    removeMutation.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Account removed" });
        queryClient.invalidateQueries({ queryKey: getListMonitoredAccountsQueryKey() });
      }
    });
  };

  const handleToggle = (id: number, current: boolean) => {
    toggleMutation.mutate({ id, data: { notificationsEnabled: !current } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListMonitoredAccountsQueryKey() });
      }
    });
  };

  return (
    <div className="grid md:grid-cols-[1fr_2fr] gap-6">
      <Card className="bg-card border-border h-fit">
        <CardHeader>
          <CardTitle>Add Account</CardTitle>
          <CardDescription>Monitor a TikTok account for new posts</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Username</Label>
            <Input
              value={newAcc.username}
              onChange={e => setNewAcc({ ...newAcc, username: e.target.value })}
              placeholder="e.g. hutaotik"
              className="bg-background border-border"
            />
          </div>
          <div className="space-y-2">
            <Label>Profile URL</Label>
            <Input
              value={newAcc.tiktokUrl}
              onChange={e => setNewAcc({ ...newAcc, tiktokUrl: e.target.value })}
              placeholder="https://tiktok.com/@username"
              className="bg-background border-border"
            />
          </div>
          <Button onClick={handleAdd} disabled={addMutation.isPending || !newAcc.username || !newAcc.tiktokUrl} className="w-full">
            {addMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
            Add Account
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <h3 className="font-medium text-lg">Monitored Accounts</h3>
        {isLoading ? (
          <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : accounts?.length === 0 ? (
          <div className="text-center p-8 border border-dashed border-border rounded-xl text-muted-foreground">No monitored accounts yet.</div>
        ) : (
          <div className="grid gap-3">
            {accounts?.map(acc => (
              <Card key={acc.id} className="border-border bg-card overflow-hidden">
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    {/* Avatar */}
                    <div className="w-14 h-14 rounded-full bg-secondary border-2 border-border shrink-0 overflow-hidden">
                      {acc.avatarUrl
                        ? <img src={acc.avatarUrl} alt={acc.username} className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center font-bold text-lg text-muted-foreground">{acc.username.substring(0, 2).toUpperCase()}</div>
                      }
                    </div>
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-bold text-sm leading-tight">{acc.displayName || `@${acc.username}`}</p>
                        <span className="text-xs text-muted-foreground">@{acc.username}</span>
                      </div>
                      {acc.bio && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">{acc.bio}</p>
                      )}
                    </div>
                    {/* Controls */}
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="flex flex-col items-center gap-1">
                        <Bell className={`w-3.5 h-3.5 ${acc.notificationsEnabled ? 'text-primary' : 'text-muted-foreground'}`} />
                        <Switch
                          checked={acc.notificationsEnabled}
                          onCheckedChange={() => handleToggle(acc.id, acc.notificationsEnabled)}
                          className="scale-75"
                        />
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:bg-destructive/20 hover:text-destructive w-8 h-8"
                        onClick={() => handleRemove(acc.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ShowcaseManagerTab() {
  const [videos, setVideos] = useState<ShowcaseVideoAdmin[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [maxPins, setMaxPins] = useState<number>(3);
  const [savingMax, setSavingMax] = useState(false);
  const { data: adminSettings } = useGetAdminSettings({ query: { queryKey: getGetAdminSettingsQueryKey() } });
  const updateMutation = useUpdateAdminSettings();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    if (adminSettings?.maxShowcasePins !== undefined) {
      setMaxPins(adminSettings.maxShowcasePins);
    }
  }, [adminSettings?.maxShowcasePins]);

  const loadVideos = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/showcase");
      if (res.ok) setVideos(await res.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadVideos(); }, []);

  const handleDelete = async (id: number) => {
    const token = localStorage.getItem("admin_token");
    const res = await fetch(`/api/admin/showcase/${id}`, {
      method: "DELETE",
      headers: token ? { "x-admin-token": token } : {},
    });
    if (res.ok) {
      setVideos(prev => prev ? prev.filter(v => v.id !== id) : []);
      toast({ title: "Video deleted" });
    } else {
      toast({ title: "Delete failed", variant: "destructive" });
    }
  };

  const handlePin = async (id: number, isPinned: boolean) => {
    const token = localStorage.getItem("admin_token");
    const res = await fetch(`/api/admin/showcase/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...(token ? { "x-admin-token": token } : {}) },
      body: JSON.stringify({ isPinned }),
    });
    if (res.ok) {
      await loadVideos();
      toast({ title: isPinned ? "Video pinned" : "Video unpinned" });
    } else {
      toast({ title: "Failed to update pin", variant: "destructive" });
    }
  };

  const handleSaveMaxPins = async () => {
    setSavingMax(true);
    updateMutation.mutate({ data: { maxShowcasePins: maxPins } }, {
      onSuccess: () => {
        toast({ title: `Max pins set to ${maxPins}` });
        queryClient.invalidateQueries({ queryKey: getGetAdminSettingsQueryKey() });
      },
      onSettled: () => setSavingMax(false),
    });
  };

  const pinnedCount = videos?.filter(v => v.isPinned).length ?? 0;

  return (
    <div className="space-y-6">
      {/* Max pins setting */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Pin className="w-4 h-4 text-primary" />
            Pin Settings
          </CardTitle>
          <CardDescription>Control how many videos can be pinned to the top</CardDescription>
        </CardHeader>
        <CardContent className="flex items-end gap-4">
          <div className="space-y-2">
            <Label>Maximum Pinned Videos</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                max={20}
                value={maxPins}
                onChange={e => setMaxPins(Math.max(1, parseInt(e.target.value) || 1))}
                className="bg-background border-border w-24 text-center"
              />
              <span className="text-xs text-muted-foreground">
                ({pinnedCount} currently pinned)
              </span>
            </div>
          </div>
          <Button onClick={handleSaveMaxPins} disabled={savingMax} variant="outline">
            {savingMax ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Save
          </Button>
        </CardContent>
      </Card>

      {/* Video list */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-lg">All Showcase Videos</h3>
          <Badge variant="outline" className="bg-secondary/50 border-border">
            {videos?.length ?? 0} Videos
          </Badge>
        </div>

        {loading ? (
          <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : !videos || videos.length === 0 ? (
          <div className="text-center p-8 border border-dashed border-border rounded-xl text-muted-foreground">
            No showcase videos yet.
          </div>
        ) : (
          <div className="grid gap-3">
            {videos.map(video => (
              <Card key={video.id} className={`border-border bg-card ${video.isPinned ? "border-primary/40" : ""}`}>
                <CardContent className="p-3 flex items-center gap-3">
                  {/* Thumbnail */}
                  <div className="w-16 h-16 rounded-lg bg-secondary border border-border overflow-hidden shrink-0">
                    {video.thumbnail
                      ? <img src={video.thumbnail} alt={video.title} className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center"><Clapperboard className="w-6 h-6 text-muted-foreground" /></div>
                    }
                  </div>
                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold line-clamp-1">{video.title}</p>
                    <p className="text-xs text-muted-foreground">@{video.authorUsername}</p>
                    {video.isPinned && (
                      <Badge className="mt-1 text-[10px] px-1.5 h-4 bg-primary/20 text-primary border-primary/30">
                        <Pin className="w-2.5 h-2.5 mr-0.5" /> Pinned
                      </Badge>
                    )}
                  </div>
                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className={`w-8 h-8 ${video.isPinned ? "text-primary hover:text-primary/80" : "text-muted-foreground hover:text-primary"}`}
                      title={video.isPinned ? "Unpin" : "Pin to top"}
                      onClick={() => handlePin(video.id, !video.isPinned)}
                    >
                      <Pin className="w-4 h-4" fill={video.isPinned ? "currentColor" : "none"} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="w-8 h-8 text-destructive hover:bg-destructive/20"
                      title="Delete"
                      onClick={() => handleDelete(video.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  enabled: boolean;
  onToggle: (value: boolean) => void;
  isLoading?: boolean;
}

function FeatureCard({ icon, title, description, enabled, onToggle, isLoading }: FeatureCardProps) {
  return (
    <Card className={`border-border bg-card transition-all ${!enabled ? "opacity-70" : ""}`}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-colors ${enabled ? "bg-primary/20 text-primary" : "bg-secondary text-muted-foreground"}`}>
              {icon}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="font-semibold text-sm">{title}</p>
                {!enabled && (
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
                    <LockKeyhole className="w-2.5 h-2.5" /> Disabled
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
            </div>
          </div>
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin text-primary mt-1 shrink-0" />
          ) : (
            <Switch
              checked={enabled}
              onCheckedChange={onToggle}
              className="shrink-0 mt-0.5"
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function FeaturesTab() {
  const { data: settings, isLoading } = useGetAdminSettings({ query: { queryKey: getGetAdminSettingsQueryKey() } });
  const updateMutation = useUpdateAdminSettings();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [pending, setPending] = useState<string | null>(null);

  const handleToggle = (field: string, value: boolean) => {
    setPending(field);
    updateMutation.mutate(
      { data: { [field]: value } },
      {
        onSuccess: () => {
          const label = value ? "enabled" : "disabled";
          toast({ title: `Feature ${label}` });
          queryClient.invalidateQueries({ queryKey: getGetAdminSettingsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetPublicSettingsQueryKey() });
        },
        onError: () => {
          toast({ title: "Failed to update feature", variant: "destructive" });
        },
        onSettled: () => setPending(null),
      }
    );
  };

  if (isLoading) {
    return <div className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" /></div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold text-lg mb-1">Feature Toggles</h3>
        <p className="text-sm text-muted-foreground">Disable features to hide them from users. A lock icon will appear on the nav and page when disabled.</p>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <FeatureCard
          icon={<Download className="w-5 h-5" />}
          title="Video Downloads"
          description="Users can paste TikTok links and download videos in HD, Normal, Low or MP3."
          enabled={settings?.downloadsEnabled ?? true}
          onToggle={(v) => handleToggle("downloadsEnabled", v)}
          isLoading={pending === "downloadsEnabled"}
        />
        <FeatureCard
          icon={<Bell className="w-5 h-5" />}
          title="Post Alerts"
          description="Get notified when monitored TikTok accounts post new videos."
          enabled={settings?.alertsEnabled ?? true}
          onToggle={(v) => handleToggle("alertsEnabled", v)}
          isLoading={pending === "alertsEnabled"}
        />
        <FeatureCard
          icon={<Clock className="w-5 h-5" />}
          title="Download History"
          description="Track previously downloaded videos with thumbnails and quality info."
          enabled={settings?.historyEnabled ?? true}
          onToggle={(v) => handleToggle("historyEnabled", v)}
          isLoading={pending === "historyEnabled"}
        />
        <FeatureCard
          icon={<Clapperboard className="w-5 h-5" />}
          title="Edits Showcase"
          description="Community showcase where users share their TikTok edits."
          enabled={settings?.showcaseEnabled ?? true}
          onToggle={(v) => handleToggle("showcaseEnabled", v)}
          isLoading={pending === "showcaseEnabled"}
        />
        <FeatureCard
          icon={<Youtube className="w-5 h-5" />}
          title="YouTube Downloads"
          description="Users can paste YouTube links and download videos or extract MP3 audio."
          enabled={settings?.youtubeEnabled ?? true}
          onToggle={(v) => handleToggle("youtubeEnabled", v)}
          isLoading={pending === "youtubeEnabled"}
        />
        <FeatureCard
          icon={<SiFacebook className="w-5 h-5" />}
          title="Facebook Downloads"
          description="Users can paste Facebook video links and download HD, SD, or MP3 audio."
          enabled={settings?.facebookEnabled ?? true}
          onToggle={(v) => handleToggle("facebookEnabled", v)}
          isLoading={pending === "facebookEnabled"}
        />
      </div>
    </div>
  );
}
