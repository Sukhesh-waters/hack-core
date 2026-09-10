"use client";

import { useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { CheckCircle2, Globe, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GlassCard } from "@/components/glass-card";
import { crawlAndIngestUrlAction, type CrawlActionState } from "@/app/(app)/w/[ws]/kb/crawl-action";

function IngestButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      disabled={pending}
      className="h-9 gap-1.5 bg-brand-teal text-xs font-semibold text-slate-950 hover:bg-brand-teal/90"
    >
      {pending ? (
        <>
          <Loader2 className="size-3.5 animate-spin" /> Crawling & Indexing…
        </>
      ) : (
        <>
          <Plus className="size-3.5" /> Ingest & Index
        </>
      )}
    </Button>
  );
}

export function LiveUrlIngester({
  workspaceId,
  clients,
  defaultClientId,
}: {
  workspaceId: string;
  clients: { id: string; name: string }[];
  defaultClientId?: string;
}) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const [state, formAction] = useFormState<CrawlActionState | undefined, FormData>(
    crawlAndIngestUrlAction,
    undefined,
  );

  return (
    <GlassCard className="p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Globe className="size-4 text-brand-teal" />
        <span className="label-mono text-xs text-foreground">
          Live Web & Social Knowledge Ingest
        </span>
      </div>
      <p className="text-xs text-muted-foreground/70">
        Paste any client webpage, blog article, or case study URL to crawl, segment, and index into the brand knowledge base.
      </p>

      <form ref={formRef} action={formAction} className="flex flex-wrap items-center gap-2 pt-1">
        <input type="hidden" name="workspaceId" value={workspaceId} />

        {clients.length > 1 ? (
          <select
            name="clientId"
            defaultValue={defaultClientId ?? clients[0]?.id}
            className="h-9 rounded-md border border-input bg-background px-3 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="hidden"
            name="clientId"
            value={clients[0]?.id ?? defaultClientId ?? ""}
          />
        )}

        <div className="flex-1 min-w-[240px]">
          <Input
            name="url"
            type="url"
            placeholder="https://brand.com/about or blog article..."
            required
            className="h-9 text-xs"
          />
        </div>

        <IngestButton />
      </form>

      {state?.error ? (
        <p className="text-xs text-destructive">{state.error}</p>
      ) : null}

      {state?.ok ? (
        <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-2.5 text-xs text-emerald-400">
          <CheckCircle2 className="size-4 shrink-0" />
          <span>
            Successfully ingested and segmented {state.chunkCount} knowledge chunks into the brand memory.
          </span>
        </div>
      ) : null}
    </GlassCard>
  );
}
