import { ArrowDown } from "lucide-react";
import {
  clampPercent,
  formatProgressDetail,
  type DownloadProgressState,
} from "@/lib/download-progress";

interface DownloadProgressCardProps {
  title: string;
  progress: DownloadProgressState;
  className?: string;
}

export function DownloadProgressCard({
  title,
  progress,
  className = "px-4 pb-4",
}: DownloadProgressCardProps) {
  const percent = clampPercent(progress.percent);
  const detail = formatProgressDetail(progress);

  return (
    <div className={`${className} animate-bounce-pop`}>
      <div className="bg-primary/10 border border-primary/30 rounded-xl p-3 flex flex-col gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
            <ArrowDown className="w-5 h-5 text-primary animate-bounce" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-foreground leading-tight flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">{title}</span>
              <span className="shrink-0 text-primary font-mono font-bold text-sm tabular-nums">
                {percent}%
              </span>
            </p>
            <p className="text-[11px] text-muted-foreground truncate mt-0.5">{detail}</p>
          </div>
        </div>
        <div className="w-full bg-secondary/80 h-2 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-[width] duration-200 ease-out ${
              percent <= 2
                ? "bg-gradient-to-r from-primary/50 via-primary to-primary/50 animate-pulse"
                : "bg-primary"
            }`}
            style={{ width: `${Math.max(percent, 4)}%` }}
          />
        </div>
      </div>
    </div>
  );
}
