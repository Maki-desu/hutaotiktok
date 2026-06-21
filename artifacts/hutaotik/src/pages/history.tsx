import { useListDownloadHistory, getListDownloadHistoryQueryKey, useGetPublicSettings, getGetPublicSettingsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import { Loader2, History as HistoryIcon, Download, LockKeyhole } from "lucide-react";

export default function History() {
  const { data: publicSettings } = useGetPublicSettings({
    query: { queryKey: getGetPublicSettingsQueryKey() },
  });
  const { data: history, isLoading } = useListDownloadHistory({
    query: { queryKey: getListDownloadHistoryQueryKey() }
  });

  const isEnabled = publicSettings?.historyEnabled !== false;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="relative space-y-6 animate-in fade-in duration-500">
      {/* Feature-disabled overlay */}
      {!isEnabled && (
        <div className="absolute inset-0 z-30 flex items-center justify-center rounded-2xl backdrop-blur-sm bg-background/60 min-h-[200px]">
          <div className="w-20 h-20 rounded-full bg-card border-2 border-border flex items-center justify-center shadow-xl">
            <LockKeyhole className="w-9 h-9 text-muted-foreground" />
          </div>
        </div>
      )}

      {!history || history.length === 0 ? (
        <div className="text-center py-20 border border-border border-dashed rounded-xl bg-secondary/20">
          <div className="w-16 h-16 bg-secondary rounded-full flex items-center justify-center mx-auto mb-4">
            <HistoryIcon className="w-8 h-8 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-syne font-bold mb-2">No Download History</h2>
          <p className="text-muted-foreground text-sm max-w-sm mx-auto">
            Videos you download will appear here so you can keep track of them.
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-syne font-bold">Download History</h1>
            <Badge variant="outline" className="bg-secondary/50 border-border">
              {history.length} Records
            </Badge>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {history.map((record) => (
              <Card key={record.id} className="border-border bg-card overflow-hidden hover:border-primary/30 transition-colors group">
                <CardContent className="p-0 flex h-32">
                  <div className="w-24 h-full bg-secondary shrink-0 relative">
                    {record.thumbnail ? (
                      <img src={record.thumbnail} alt={record.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Download className="w-6 h-6 text-muted-foreground" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/20 group-hover:bg-transparent transition-colors" />
                  </div>
                  <div className="flex-1 p-4 flex flex-col justify-between overflow-hidden">
                    <div>
                      <h3 className="font-bold text-sm line-clamp-1 mb-1">{record.title || "Untitled Video"}</h3>
                      <p className="text-xs text-muted-foreground truncate">@{record.authorUsername}</p>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <Badge variant="secondary" className="text-[10px] px-2 py-0 h-5 bg-background border-border">
                        {record.quality.toUpperCase()}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        {formatDistanceToNow(new Date(record.downloadedAt), { addSuffix: true })}
                      </span>
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
