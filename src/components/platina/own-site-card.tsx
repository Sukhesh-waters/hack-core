import { PendingButton } from "@/components/platina/pending-button";
import type { OwnSiteSummary } from "@/lib/platina/own-site";

type FailedPage = { url: string; error: string | null };

/**
 * The client's own website as first-party knowledge (C6 L1): how much of it
 * is read, what failed and why, and a "read now" button. Server component.
 */
export function OwnSiteCard({
  workspaceId,
  brandId,
  name,
  homepageUrl,
  summary,
  chunks,
  mappedAt,
  mapError,
  failed,
  action,
  now,
}: {
  workspaceId: string;
  brandId: string;
  name: string;
  homepageUrl: string | null;
  summary: OwnSiteSummary;
  chunks: number;
  mappedAt: Date | null;
  mapError: string | null;
  failed: FailedPage[];
  action: (formData: FormData) => Promise<void>;
  now: Date;
}) {
  const days = (d: Date | null) => {
    if (!d) return "never";
    const h = Math.floor((now.getTime() - d.getTime()) / 3_600_000);
    return h < 1 ? "within the hour" : h < 48 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`;
  };
  const pct = summary.total > 0 ? Math.round((summary.read / summary.total) * 100) : 0;

  return (
    <section aria-label="Website knowledge" className="mb-8 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-medium">What {name}&apos;s own website says</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            First-party knowledge: plans cite it as {name}&apos;s own data, never mixed with public signals.
          </p>
        </div>
        {homepageUrl ? (
          <form action={action}>
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <input type="hidden" name="brandId" value={brandId} />
            <PendingButton pendingLabel="Starting…">Read site now</PendingButton>
          </form>
        ) : null}
      </div>

      {!homepageUrl ? (
        <p className="mt-3 text-sm text-muted-foreground">Set {name}&apos;s website to read it.</p>
      ) : summary.total === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {mapError
            ? `Could not list the site's pages: ${mapError}`
            : "Not read yet. It is read daily at 05:00 UTC, or now with the button."}
        </p>
      ) : (
        <>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
            <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
            <div>
              <dt className="text-xs text-muted-foreground">Pages read</dt>
              <dd className="font-medium">
                {summary.read} / {summary.total}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Waiting</dt>
              <dd className="font-medium">{summary.queued}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Changed, to re-read</dt>
              <dd className="font-medium">{summary.changed}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Passages stored</dt>
              <dd className="font-medium">{chunks}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Last read</dt>
              <dd className="font-medium">{days(summary.lastReadAt)}</dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">
            Site listed {days(mappedAt)}. Unchanged pages are checked by headers only and cost nothing;
            {summary.queued > 0 ? " the rest are read over the next days within the daily limit." : " only changed pages are read again."}
            {mapError ? ` Last listing failed: ${mapError}` : ""}
          </p>
          {failed.length > 0 ? (
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-destructive">
                {summary.failed} page{summary.failed === 1 ? "" : "s"} could not be read
              </summary>
              <ul className="mt-2 space-y-1 text-xs">
                {failed.map((f) => (
                  <li key={f.url}>
                    <span className="break-all">{f.url}</span>
                    <span className="block text-muted-foreground">{f.error ?? "unknown reason"}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
    </section>
  );
}
