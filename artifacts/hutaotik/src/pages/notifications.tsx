import {
  useListNotifications,
  getListNotificationsQueryKey,
  useMarkNotificationRead,
  useGetUnreadNotificationCount,
  getGetUnreadNotificationCountQueryKey,
  useGetPublicSettings,
  getGetPublicSettingsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BellOff, Loader2, ExternalLink, CheckCheck, LockKeyhole } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";

export default function Notifications() {
  const queryClient = useQueryClient();

  const { data: publicSettings } = useGetPublicSettings({
    query: { queryKey: getGetPublicSettingsQueryKey() },
  });

  const { data: notifications, isLoading } = useListNotifications({
    query: {
      queryKey: getListNotificationsQueryKey(),
      refetchInterval: 15_000,
    },
  });

  const markReadMutation = useMarkNotificationRead();
  const isEnabled = publicSettings?.alertsEnabled !== false;

  const handleMarkRead = (id: number) => {
    markReadMutation.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetUnreadNotificationCountQueryKey() });
        },
      },
    );
  };

  const handleOpen = (id: number, url: string, isRead: boolean) => {
    if (!isRead) handleMarkRead(id);
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noreferrer noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-in fade-in duration-500 relative">
      {/* Feature-disabled overlay */}
      {!isEnabled && (
        <div className="absolute inset-0 z-30 flex items-center justify-center rounded-2xl backdrop-blur-sm bg-background/60 min-h-[200px]">
          <div className="w-20 h-20 rounded-full bg-card border-2 border-border flex items-center justify-center shadow-xl">
            <LockKeyhole className="w-9 h-9 text-muted-foreground" />
          </div>
        </div>
      )}

      {(!notifications || notifications.length === 0) ? (
        <div className="text-center py-20 border border-border border-dashed rounded-2xl bg-secondary/10">
          <div className="w-16 h-16 bg-secondary rounded-full flex items-center justify-center mx-auto mb-4">
            <BellOff className="w-8 h-8 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-syne font-bold mb-2">No Notifications Yet</h2>
          <p className="text-muted-foreground text-sm max-w-xs mx-auto">
            Add accounts to monitor in the Admin panel. You'll be notified here within 1 minute of a new post.
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-syne font-bold">Post Notifications</h1>
              {notifications.filter((n) => !n.isRead).length > 0 && (
                <p className="text-sm text-primary font-medium mt-0.5">
                  {notifications.filter((n) => !n.isRead).length} new notification{notifications.filter((n) => !n.isRead).length > 1 ? "s" : ""}
                </p>
              )}
            </div>
            {notifications.filter((n) => !n.isRead).length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-primary text-xs gap-1.5"
                onClick={() => notifications.filter((n) => !n.isRead).forEach((n) => handleMarkRead(n.id))}
              >
                <CheckCheck className="w-3.5 h-3.5" />
                Mark all read
              </Button>
            )}
          </div>

          <div className="grid gap-3">
            {notifications.map((notif) => (
              <Card
                key={notif.id}
                className={`border-border bg-card transition-all duration-200 overflow-hidden cursor-pointer group
                  ${!notif.isRead ? "border-primary/40 shadow-[0_0_20px_rgba(249,115,22,0.12)]" : "opacity-70 hover:opacity-90"}`}
                onClick={() => handleOpen(notif.id, notif.videoUrl, notif.isRead)}
              >
                <CardContent className="p-0">
                  <div className="flex items-stretch">
                    {!notif.isRead && <div className="w-1 shrink-0 bg-primary rounded-l-xl" />}
                    <div className="flex items-center gap-4 px-4 py-4 flex-1 min-w-0">
                      <div className="relative shrink-0">
                        <div className="w-14 h-14 rounded-full overflow-hidden border-2 border-border bg-secondary">
                          {notif.avatarUrl ? (
                            <img src={notif.avatarUrl} alt={notif.username} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center font-bold text-lg text-muted-foreground">
                              {notif.username.substring(0, 2).toUpperCase()}
                            </div>
                          )}
                        </div>
                        {!notif.isRead && (
                          <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-primary border-2 border-background animate-pulse" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-foreground text-sm leading-snug">{notif.videoTitle}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatDistanceToNow(new Date(notif.createdAt), { addSuffix: true })}
                        </p>
                      </div>
                      <div className="shrink-0 flex flex-col items-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5 text-xs border-border group-hover:border-primary/50 group-hover:text-primary transition-colors"
                          onClick={(e) => { e.stopPropagation(); handleOpen(notif.id, notif.videoUrl, notif.isRead); }}
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          View Post
                        </Button>
                        {!notif.isRead && (
                          <button
                            className="text-[10px] text-muted-foreground hover:text-primary transition-colors"
                            onClick={(e) => { e.stopPropagation(); handleMarkRead(notif.id); }}
                          >
                            Dismiss
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
