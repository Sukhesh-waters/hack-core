import Link from "next/link";
import { PlatinaFormError } from "@/components/platina/form-error";
import { PlatinaPage } from "@/components/platina/page";
import { PendingButton } from "@/components/platina/pending-button";
import { listBrands } from "@/db/queries/platina";
import {
  listCreatives,
  listLearningEvents,
  listMetricsForCreatives,
  listReviews,
} from "@/db/queries/platina-learning";
import { describeStat, FEATURE_LABEL } from "@/lib/platina/learning";
import { learningState } from "@/lib/platina/learning-service";
import { pct, times } from "@/lib/platina/review";
import { STAGE_LABEL, summariseCreatives, type CreativeStage } from "@/lib/platina/results-view";
import { importNumbersAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Results" };

const STAGE_TONE: Record<CreativeStage, string> = {
  no_numbers: "text-muted-foreground",
  measuring: "text-muted-foreground",
  review_waiting: "font-medium text-primary",
  learned: "text-foreground",
};

const EVENT_LABEL: Record<string, string> = {
  lesson: "Lesson stored",
  demote: "Insight marked down",
  promote: "Insight strengthened",
};

export default async function ResultsPage(
  props: {
    params: Promise<{ ws: string }>;
    searchParams: Promise<{ brand?: string; error?: string; imported?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const now = new Date();
  const brands = (await listBrands(params.ws)).filter((b) => b.kind === "own_brand");
  const brandId = brands.some((b) => b.id === searchParams.brand) ? searchParams.brand! : null;
  const [creatives, learning, events] = await Promise.all([
    listCreatives(params.ws, brandId),
    learningState(params.ws, brandId, now),
    listLearningEvents(params.ws, 12),
  ]);
  const ids = creatives.map((c) => c.id);
  const [metrics, reviews] = await Promise.all([listMetricsForCreatives(params.ws, ids), listReviews(params.ws, ids)]);
  const summaries = new Map(
    summariseCreatives({
      creatives,
      metrics,
      reviews: reviews.map((r) => ({ creativeId: r.creativeId, status: r.status, verdict: r.verdict })),
      minN: learning.config.minN,
      reviewAfterDays: learning.config.reviewAfterDays,
      now,
    }).map((s) => [s.id, s]),
  );
  const nameOf = new Map(brands.map((b) => [b.id, b.name]));
  const waiting = creatives.filter((c) => summaries.get(c.id)?.stage === "review_waiting");
  const ok = learning.stats.filter((s) => s.status === "ok");
  const building = learning.stats.filter((s) => s.status !== "ok").slice(0, 8);
  const count = (stage: CreativeStage) => creatives.filter((c) => summaries.get(c.id)?.stage === stage).length;
  const newHref = `/p/${params.ws}/results/new${brandId ? `?brand=${brandId}` : ""}`;

  return (
    <PlatinaPage
      eyebrow="Learning loop"
      title="Results"
      description="Every creative you post, its numbers, and what it taught us. Confirmed reviews change what Opportunities ranks first and what plans cite."
    >
      <PlatinaFormError message={searchParams.error} />
      {searchParams.imported ? (
        <p className="mb-4 rounded-md border border-border bg-card p-3 text-sm">
          Imported {searchParams.imported} measurement{searchParams.imported === "1" ? "" : "s"}. Reviews open by
          themselves once a creative has run {learning.config.reviewAfterDays} days.
        </p>
      ) : null}

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Client" className="flex flex-wrap gap-2 text-sm">
          <Link
            href={`/p/${params.ws}/results`}
            className={`rounded-full border px-3 py-1 ${brandId ? "border-border text-muted-foreground" : "border-primary text-primary"}`}
          >
            All clients
          </Link>
          {brands.map((b) => (
            <Link
              key={b.id}
              href={`/p/${params.ws}/results?brand=${b.id}`}
              className={`rounded-full border px-3 py-1 ${brandId === b.id ? "border-primary text-primary" : "border-border text-muted-foreground"}`}
            >
              {b.name}
            </Link>
          ))}
        </nav>
        <Link href={newHref} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">
          Log a creative
        </Link>
      </div>

      <dl className="mb-8 grid gap-3 sm:grid-cols-4">
        {(["no_numbers", "measuring", "review_waiting", "learned"] as const).map((stage) => (
          <div key={stage} className="rounded-lg border border-border bg-card p-4">
            <dt className="text-xs text-muted-foreground">{STAGE_LABEL[stage]}</dt>
            <dd className="mt-1 text-2xl font-medium">{count(stage)}</dd>
          </div>
        ))}
      </dl>

      {waiting.length > 0 ? (
        <section aria-label="Reviews waiting" className="mb-8 rounded-lg border border-primary/40 bg-primary/5 p-4">
          <h2 className="font-display text-lg font-medium">Reviews waiting for you</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Nothing is learned until a person confirms: the AI drafts what, why and how; you decide.
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            {waiting.map((c) => (
              <li key={c.id}>
                <Link href={`/p/${params.ws}/results/${c.id}#review`} className="text-primary underline-offset-4 hover:underline">
                  {c.title}
                </Link>
                <span className="text-muted-foreground"> · {c.channel} · {c.format}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-label="What results are teaching" className="mb-8 grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="font-display text-lg font-medium">What your results are teaching</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            From {learning.results} confirmed review{learning.results === 1 ? "" : "s"}. A value needs{" "}
            {learning.config.minN} results before it moves any ranking; older results fade (half-life{" "}
            {learning.config.halfLifeDays} days). {Math.round(learning.config.exploreShare * 100)}% of suggestions are
            kept for trying something new.
          </p>
          {ok.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Nothing has enough results yet to change a ranking. Log creatives and confirm their reviews.
            </p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {ok.map((s) => (
                <li key={`${s.feature}:${s.value}`} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 text-xs text-muted-foreground">{FEATURE_LABEL[s.feature]}</span>
                  <span className="flex-1">{describeStat(s, learning.config.minN)}</span>
                  <span className="h-2 w-20 shrink-0 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <span className="block h-full bg-primary" style={{ width: `${Math.round(s.mean * 100)}%` }} />
                  </span>
                </li>
              ))}
            </ul>
          )}
          {building.length > 0 ? (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-muted-foreground">Still collecting ({building.length})</summary>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {building.map((s) => (
                  <li key={`${s.feature}:${s.value}`}>{describeStat(s, learning.config.minN)}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="font-display text-lg font-medium">What changed, and why</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Every lesson stored and every insight a result marked down or strengthened, with its cause.
          </p>
          {events.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No changes yet.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {events.map((e) => {
                const d = e.detail as { creative?: string; insight?: string | null; verdict?: string; reason?: string };
                return (
                  <li key={e.id}>
                    <span className="font-medium">{EVENT_LABEL[e.kind] ?? e.kind}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      · {d.creative ?? "a creative"}
                      {d.verdict ? ` (${d.verdict})` : ""}
                    </span>
                    {d.insight ? <span className="block text-xs text-muted-foreground">“{d.insight}”, {d.reason}</span> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <h2 className="font-display text-lg font-medium">Creatives</h2>
      {creatives.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          None logged yet.{" "}
          <Link href={newHref} className="text-primary underline-offset-4 hover:underline">
            Log the first one
          </Link>
          , or start from a plan phase or an opportunity.
        </p>
      ) : (
        <div className="mt-2 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Creative</th>
                <th className="px-4 py-2">Posted</th>
                <th className="px-4 py-2 text-right">Impressions</th>
                <th className="px-4 py-2 text-right">Engagement</th>
                <th className="px-4 py-2 text-right">vs usual</th>
                <th className="px-4 py-2">Stage</th>
              </tr>
            </thead>
            <tbody>
              {creatives.map((c) => {
                const s = summaries.get(c.id)!;
                return (
                  <tr key={c.id} className="border-t border-border">
                    <td className="px-4 py-2">
                      <Link href={`/p/${params.ws}/results/${c.id}`} className="font-medium underline-offset-4 hover:underline">
                        {c.title}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        {[c.brandId ? nameOf.get(c.brandId) : null, c.channel, c.format, c.topic].filter(Boolean).join(" · ")}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{c.postedAt ? c.postedAt.toISOString().slice(0, 10) : "not yet"}</td>
                    <td className="px-4 py-2 text-right">{s.latest?.impressions ?? s.latest?.reach ?? "—"}</td>
                    <td className="px-4 py-2 text-right">{s.rate === null ? "—" : pct(s.rate)}</td>
                    <td className="px-4 py-2 text-right">{s.index === null ? "—" : times(s.index)}</td>
                    <td className={`px-4 py-2 ${STAGE_TONE[s.stage]}`}>
                      {s.stage === "learned" && s.verdict ? `Learned: ${s.verdict}` : STAGE_LABEL[s.stage]}
                      {s.reviewInDays ? <span className="block text-xs text-muted-foreground">review in {s.reviewInDays} d</span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <section aria-label="Import numbers" className="mt-8 rounded-lg border border-border bg-card p-4">
        <h2 className="font-display text-lg font-medium">Paste numbers from a spreadsheet</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          LinkedIn page analytics export (Post link, Created date, Impressions, Clicks, Reactions, Comments, Reposts)
          works as is. Or use: creative, captured_at, impressions, reach, clicks, engagements, saves, shares,
          video_views, leads, spend. Each row must match a logged creative by its link or id. An empty cell means
          not measured, never zero.
        </p>
        <form action={importNumbersAction} className="mt-3">
          <input type="hidden" name="workspaceId" value={params.ws} />
          <textarea
            name="sheet"
            required
            rows={5}
            placeholder={"creative,captured_at,impressions,engagements\nhttps://www.linkedin.com/feed/update/urn:li:activity:...,2026-09-20,2400,64"}
            className="w-full rounded-md border border-input bg-background p-3 font-mono text-xs"
          />
          <div className="mt-2">
            <PendingButton pendingLabel="Importing…">Import numbers</PendingButton>
          </div>
        </form>
      </section>
    </PlatinaPage>
  );
}
