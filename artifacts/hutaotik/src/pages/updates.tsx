import { SiDiscord } from "react-icons/si";
import { Button } from "@/components/ui/button";

const DISCORD_INVITE_URL = "https://discord.gg/wu6ndP3Qgf";

export default function Updates() {
  return (
    <div className="mx-auto max-w-2xl animate-in fade-in duration-500">
      <section className="rounded-2xl border border-indigo-400/30 bg-card p-6 text-center shadow-lg shadow-indigo-950/10 sm:p-8">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-500/15 text-indigo-400">
          <SiDiscord className="h-7 w-7" />
        </div>
        <h1 className="text-2xl font-syne font-bold">Hutao Updates Discord</h1>
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
