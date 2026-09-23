"use client";

import { useState, useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, Globe, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GlassCard } from "@/components/glass-card";
import { ingestKnowledgeUrl, type IngestState } from "@/app/(app)/w/[ws]/brand-gene/knowledge-actions";

function IngestButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="h-9 gap-1.5 text-xs font-semibold">
      {pending ? (
        <>
          <Loader2 className="size-3.5 animate-spin" /> Reading & indexing…
        </>
      ) : (
        <>
          <Plus className="size-3.5" /> Ingest & index
        </>
      )}
    </Button>
  );
}

/**
 * Paste-a-URL on the Knowledge base page. Since C7.0 it runs the same guarded
 * ingest as Brand Gene -> Knowledge (safe fetch, Firecrawl reader, embeddings,
 * the client's-own-pages check); the old unchecked scraper is gone.
 */
export function LiveUrlIngester({
  workspaceId,
  clients,
  defaultClientId,
}: {
  workspaceId: string;
  clients: { id: string; name: string }[];
  defaultClientId?: string;
}) {
  const [clientId, setClientId] = useState(defaultClientId ?? clients[0]?.id ?? "");
  const [state, formAction] = useActionState<IngestState, FormData>(ingestKnowledgeUrl, undefined);
  const clientName = clients.find((c) => c.id === clientId)?.name ?? "this client";

  return (
    <GlassCard className="p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Globe className="size-4 text-primary" />
        <span className="label-mono text-xs text-foreground">Client knowledge ingest</span>
      </div>
      <p className="text-xs text-muted-foreground/70">
        Paste one of the client&apos;s own pages (their site, their LinkedIn page) to read it into their knowledge
        base. Competitors&apos; pages are refused here; track them in Platina as public sources.
      </p>

      <form action={formAction} className="space-y-2 pt-1">
        <div className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="workspaceId" value={workspaceId} />
          {clients.length > 1 ? (
            <select
              name="clientId"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              aria-label="Client"
              className="h-9 rounded-md border border-input bg-background px-3 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          ) : (
            <input type="hidden" name="clientId" value={clientId} />
          )}
          <div className="flex-1 min-w-[240px]">
            <Input name="url" type="text" placeholder="https://brand.com/about" required className="h-9 text-xs" aria-label="Page address" />
          </div>
          <IngestButton />
        </div>
        {state?.refusal?.suggestion ? (
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" name="confirmOwn" value="yes" className="h-3.5 w-3.5 accent-primary" />
            Belongs to {clientName}: add it to their own sites and pages
          </label>
        ) : null}
      </form>

      {state?.error ? (
        <p className="text-xs text-destructive">{state.error}</p>
      ) : state ? (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary p-2.5 text-xs">
          <CheckCircle2 className="size-4 shrink-0 text-primary" />
          <span>{state.notice ?? "Read and indexed into the client's knowledge base."}</span>
        </div>
      ) : null}
    </GlassCard>
  );
}
