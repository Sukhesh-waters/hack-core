import {
  listKnowledgeSources,
  similarKnowledgeChunksQuery,
} from "@/db/queries/knowledge";
import { getSourceRegistry } from "@/db/queries/sources";
import { GlassCard } from "@/components/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { routeAI } from "@/lib/ai/router";
import { runWithAiCost } from "@/lib/ai/usage-context";
import { firecrawlConfigured } from "@/lib/scrape/firecrawl";
import { IngestForm } from "./ingest-form";
import { IngestedSourcesList, SourcesCard } from "./sources-list";

async function SearchResults({
  workspaceId,
  clientId,
  query,
}: {
  workspaceId: string;
  clientId: string;
  query: string;
}) {
  const [embedding] = await runWithAiCost(
    { workspaceId, purpose: "knowledge-search" },
    () => routeAI({ kind: "embed", texts: [query] }),
  );
  const results = await similarKnowledgeChunksQuery(
    workspaceId,
    clientId,
    embedding,
  );

  if (results.length === 0) {
    return (
      <p className="mt-3 text-sm text-muted-foreground/70">
        No matches yet — ingest a few reference URLs above, or try a
        different phrase.
      </p>
    );
  }

  return (
    <ul className="mt-3 space-y-3">
      {results.map((result) => (
        <li key={result.id} className="rounded-lg border border-border p-3">
          <p className="text-sm text-foreground">
            {result.content.slice(0, 200)}
            {result.content.length > 200 ? "…" : ""}
          </p>
          <p className="mt-2 font-mono text-xs text-muted-foreground/70">
            {result.sourceTitle ?? result.sourceUrl} · chunk {result.chunkIndex}
          </p>
        </li>
      ))}
    </ul>
  );
}

export async function KnowledgeTab({
  workspaceId,
  clientId,
  query,
}: {
  workspaceId: string;
  clientId: string;
  query?: string;
}) {
  const [sources, registry] = await Promise.all([
    listKnowledgeSources(workspaceId, clientId),
    getSourceRegistry(workspaceId, clientId),
  ]);

  const trimmedQuery = query?.trim();

  return (
    <div className="mt-8 space-y-6">
      <GlassCard className="p-6">
        <p className="label-mono text-muted-foreground/70">Ingested reference material</p>
        <p className="mt-2 text-xs text-muted-foreground/70">
          Pages you paste in here seed this client&apos;s own reference
          vault — declared material, not public pattern data. Never cited as
          performance truth.
        </p>
        <IngestForm
          workspaceId={workspaceId}
          clientId={clientId}
          siteAvailable={firecrawlConfigured()}
        />
        <IngestedSourcesList sources={sources} />
      </GlassCard>

      <GlassCard className="p-6">
        <p className="label-mono text-muted-foreground/70">
          Search this client&apos;s vault
        </p>
        <form method="GET" className="mt-3 flex gap-2">
          <input type="hidden" name="client" value={clientId} />
          <input type="hidden" name="tab" value="knowledge" />
          <Input
            name="q"
            defaultValue={query ?? ""}
            placeholder="Search ingested reference material…"
          />
          <Button type="submit">Search</Button>
        </form>
        {trimmedQuery && trimmedQuery.length > 2 ? (
          <SearchResults
            workspaceId={workspaceId}
            clientId={clientId}
            query={trimmedQuery}
          />
        ) : null}
      </GlassCard>

      <GlassCard className="p-6">
        <p className="label-mono text-muted-foreground/70">
          Baseline & pattern provenance
        </p>
        <SourcesCard registry={registry} />
      </GlassCard>
    </div>
  );
}
