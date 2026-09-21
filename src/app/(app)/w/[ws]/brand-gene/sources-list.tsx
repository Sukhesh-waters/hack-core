import type { getSourceRegistry } from "@/db/queries/sources";
import type { knowledgeSourcesQuery } from "@/db/queries/knowledge";
import { Badge } from "@/components/ui/badge";
import { importJobDisplayStatus } from "@/lib/import-pipeline";
import { ingestDisplayStatus } from "@/lib/knowledge-ingest";

const STATUS_STYLE: Record<string, string> = {
  ready: "border-brand-teal/40 text-brand-teal",
  failed: "border-destructive/40 text-destructive",
  pending: "border-brand-amber/40 text-brand-amber",
  interrupted: "border-destructive/40 text-destructive",
};

type KnowledgeSourceRow = Awaited<ReturnType<typeof knowledgeSourcesQuery>>[number];

export function IngestedSourcesList({
  sources,
}: {
  sources: KnowledgeSourceRow[];
}) {
  if (sources.length === 0) {
    return (
      <p className="mt-4 text-sm text-muted-foreground/70">
        Nothing ingested yet — paste a URL above to seed this client&apos;s
        own reference vault.
      </p>
    );
  }
  return (
    <ul className="mt-4 space-y-2">
      {sources.map((source) => {
        const status = ingestDisplayStatus(source);
        return (
        <li
          key={source.id}
          className="flex items-center justify-between gap-3 text-sm"
        >
          <span className="flex items-center gap-2 max-w-[18rem] truncate text-muted-foreground">
            {source.sourceKind === "asset" ? (
              <span className="rounded bg-brand-teal/10 border border-brand-teal/30 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-brand-teal shrink-0">
                FILE
              </span>
            ) : null}
            <span className="truncate">{source.title ?? source.url}</span>
          </span>
          <span className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={
                STATUS_STYLE[status] ?? "border-border text-muted-foreground/70"
              }
            >
              {status === "pending"
                ? "Ingesting…"
                : status === "ready"
                  ? `${source.chunkCount} chunks`
                  : status === "interrupted"
                    ? "Interrupted"
                    : "Failed"}
            </Badge>
            {status === "failed" && source.error ? (
              <span
                className="max-w-[16rem] truncate text-xs text-muted-foreground/70"
                title={source.error}
              >
                {source.error}
              </span>
            ) : status === "interrupted" ? (
              <span className="text-xs text-muted-foreground/70">
                Stopped before finishing — paste the URL again.
              </span>
            ) : null}
          </span>
        </li>
        );
      })}
    </ul>
  );
}

type SourceRegistry = Awaited<ReturnType<typeof getSourceRegistry>>;

/** Moved verbatim from the old clients/[clientId]/brand route. */
export function SourcesCard({ registry }: { registry: SourceRegistry }) {
  const empty =
    registry.csvJobs.length === 0 &&
    registry.accounts.length === 0 &&
    registry.patternPostCount === 0;
  if (empty) {
    return (
      <p className="mt-3 text-sm text-muted-foreground/70">
        Nothing ingested yet — the declared vault above already powers
        ideation. Add CSV history, connect an account, or run a pattern scan
        whenever you want a sharper baseline.
      </p>
    );
  }
  return (
    <ul className="mt-3 space-y-2">
      {registry.csvJobs.map((job) => {
        const display = importJobDisplayStatus(job);
        return (
          <li
            key={job.id}
            className="flex items-center justify-between text-sm"
          >
            <span className="max-w-sm truncate text-muted-foreground">
              CSV · {job.filename}
            </span>
            <span className="flex items-center gap-2">
              {display === "stalled" ? (
                <Badge
                  variant="outline"
                  className="border-destructive/40 text-destructive"
                >
                  STALLED
                </Badge>
              ) : display === "failed" ? (
                <Badge
                  variant="outline"
                  className="border-destructive/40 text-destructive"
                >
                  FAILED
                </Badge>
              ) : display === "processing" ? (
                <Badge
                  variant="outline"
                  className="border-brand-amber/40 text-brand-amber"
                >
                  PROCESSING
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="border-brand-teal/40 text-brand-teal"
                >
                  BASELINE
                </Badge>
              )}
              <span className="font-mono text-xs text-muted-foreground/70">
                {display === "stalled"
                  ? "import interrupted"
                  : `${job.rowCount} rows`}{" "}
                · {job.createdAt.toLocaleDateString()}
              </span>
            </span>
          </li>
        );
      })}
      {registry.accounts.map((account) => (
        <li
          key={account.id}
          className="flex items-center justify-between text-sm"
        >
          <span className="text-muted-foreground">
            Connected account · {account.provider}
          </span>
          <span className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="border-brand-teal/40 text-brand-teal"
            >
              BASELINE
            </Badge>
            <span className="font-mono text-xs text-muted-foreground/70">
              {account.status}
              {account.lastPullAt
                ? ` · pulled ${account.lastPullAt.toLocaleDateString()}`
                : " · never pulled"}
            </span>
          </span>
        </li>
      ))}
      {registry.patternPostCount > 0 ? (
        <li className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Public pattern scans</span>
          <span className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="border-brand-purple/40 text-brand-purple"
            >
              PATTERN · INSPIRATION ONLY
            </Badge>
            <span className="font-mono text-xs text-muted-foreground/70">
              {registry.patternPostCount} posts
            </span>
          </span>
        </li>
      ) : null}
    </ul>
  );
}
