import Link from "next/link";
import { after } from "next/server";
import { PlatinaFormError } from "@/components/platina/form-error";
import { PlatinaPage } from "@/components/platina/page";
import { OpportunityBrief } from "@/components/platina/opportunity-brief";
import { PendingButton } from "@/components/platina/pending-button";
import { SuggestionFeedback } from "@/components/platina/suggestion-feedback";
import { BASELINE_DAYS, RECENT_DAYS } from "@/lib/platina/interest";
import { type Campaign, type Proof } from "@/lib/platina/opportunities";
import { loadOpportunities } from "@/lib/platina/opportunities-load";
import { type LearnedCampaign } from "@/lib/platina/opportunity-learning";
import { campaignSuggestion } from "@/lib/platina/suggestions";
import { recordShown } from "@/lib/platina/suggestions-record";
import { cn } from "@/lib/utils";
import { suggestionFeedbackAction } from "../learning/actions";
import { createPlanAction } from "../plan/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Opportunities" };

const card = "rounded-lg border border-border bg-card p-4";
const heading = "font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground";
const chip = "rounded-full border px-2.5 py-0.5 text-xs";

function ProofLinks({ proofs }: { proofs: Proof[] }) {
  if (proofs.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {proofs.map((p, i) =>
        p.url ? (
          <li key={`${p.url}-${i}`}>
            <a
              href={p.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline-offset-4 hover:underline"
            >
              {p.label} ↗
            </a>
          </li>
        ) : (
          <li key={`${p.label}-${i}`} className="text-muted-foreground">
            {p.label}
          </li>
        ),
      )}
    </ul>
  );
}

function CampaignCard({ c, ws, clientId }: { c: LearnedCampaign; ws: string; clientId: string }) {
  const logHref = `/p/${ws}/results/new?${new URLSearchParams({ brand: clientId, opp: c.key, topic: c.creativeTopic })}`;
  return (
    <li className={card}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-sm font-medium">{c.title}</h3>
        <span className="flex shrink-0 gap-2">
          <span className={cn(chip, "border-border text-muted-foreground")}>
            {c.channel === "online" ? "Online" : "In person"}
          </span>
          {c.learned.explore ? (
            <span className={cn(chip, "border-border text-muted-foreground")} title="No results yet: kept in view so the loop keeps learning">
              Trying something new
            </span>
          ) : c.learned.movement !== "none" ? (
            <span className={cn(chip, "border-primary/40 text-primary")}>
              {c.learned.movement === "up" ? "Raised by your results" : "Lowered by your results"}
            </span>
          ) : null}
          {c.timing ? (
            <span
              className={cn(
                chip,
                c.timing.startsWith("short")
                  ? "border-brand-amber/40 text-brand-amber"
                  : "border-primary/40 text-primary",
              )}
            >
              {c.timing}
            </span>
          ) : null}
        </span>
      </div>
      {c.place || c.dates || c.startBy ? (
        <p className="mt-1 text-xs text-foreground">
          {[c.dates, c.place].filter(Boolean).join(" · ")}
          {c.startBy ? (
            <span className={cn("ml-2 font-medium", c.startBy === "now" ? "text-brand-amber" : "text-primary")}>
              {c.startBy === "now" ? "Start preparing now" : `Start preparing by ${c.startBy}`}
            </span>
          ) : null}
        </p>
      ) : null}
      {c.factors.length > 0 ? (
        <dl className="mt-2 flex flex-wrap gap-1.5" aria-label="What this rank rests on">
          {c.factors.map((f) => (
            <div key={f.label} className="rounded border border-border px-1.5 py-0.5 text-[11px]">
              <dt className="inline text-muted-foreground">{f.label}: </dt>
              <dd className="inline font-medium">{f.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
        {c.why.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
      <ProofLinks proofs={c.proofs} />
      {c.learned.lines.length > 0 ? (
        <div className="mt-2 rounded-md border border-border bg-muted/30 p-2 text-xs">
          <p className="font-medium">Your results (first-party, kept apart from the public proof above)</p>
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            {c.learned.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <form action={createPlanAction} className="mt-3 flex flex-wrap items-center gap-3">
        <input type="hidden" name="workspaceId" value={ws} />
        <input type="hidden" name="brandId" value={clientId} />
        <input type="hidden" name="useCase" value={c.plan.useCase} />
        <input type="hidden" name="opportunityKey" value={c.key} />
        {c.plan.useCase === "event" ? (
          <>
            <input type="hidden" name="eventName" value={c.plan.eventName} />
            <input type="hidden" name="eventDate" value={c.plan.eventDate} />
          </>
        ) : (
          <input type="hidden" name="goal" value={c.plan.goal} />
        )}
        <PendingButton pendingLabel="Planning…">
          {c.plan.useCase === "event" ? "Plan backwards from the date" : "Plan this campaign"}
        </PendingButton>
        <Link href={logHref} className="text-xs text-primary underline-offset-4 hover:underline">
          Log a creative for it
        </Link>
      </form>
      <OpportunityBrief ws={ws} clientId={clientId} opportunityKey={c.key} />
      <SuggestionFeedback
        action={suggestionFeedbackAction}
        ws={ws}
        back={`/p/${ws}/opportunities`}
        subjectKey={c.key}
        inputs={campaignSuggestion(c, null, "rules").inputs}
      />
    </li>
  );
}

/**
 * The suggestion page (campaign intelligence C5), in the owner's order:
 * what people are interested in (with proof) -> campaigns to run (online and
 * in person, with proof) -> plans -> creative, collapsed at the bottom.
 * Reads stored signals and events only — no model call on page load.
 */
export default async function OpportunitiesPage(
  props: {
    params: Promise<{ ws: string }>;
    searchParams: Promise<{ client?: string; error?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  // One loader shared with the AI brief route, so both see the same campaigns.
  const data = await loadOpportunities(params.ws, searchParams.client);
  const { clients, client } = data;

  if (!client || !data.campaigns) {
    return (
      <PlatinaPage eyebrow="Campaign intelligence" title="Opportunities">
        <p className="text-sm text-muted-foreground">
          Add a client first.{" "}
          <Link href={`/p/${params.ws}/start`} className="text-primary underline-offset-4 hover:underline">
            Add a client
          </Link>
        </p>
      </PlatinaPage>
    );
  }

  const { competitors, signals, learning, insights, campaigns } = data;
  // C8.5: every card shown goes into the suggestion ledger, after the page is
  // sent (never slows or breaks it), once per inputs and once a day as "shown".
  const weightsVersion = learning.stats.some((st) => st.status === "ok") ? `learning:${new Date().toISOString().slice(0, 10)}` : "rules";
  const shown = [...campaigns.events, ...campaigns.topics].map((c) => campaignSuggestion(c, client.region ?? null, weightsVersion));
  after(() => recordShown(params.ws, client.id, shown));
  const measured = insights.filter((i) => i.status === "ok");
  const thin = insights.filter((i) => i.status === "insufficient");
  const all: Campaign[] = [...campaigns.events, ...campaigns.topics];
  const clientPlans = data.plans.slice(0, 5);
  const posts = new Set(signals.filter((s) => s.signalKind === "interest").map((s) => s.sourceUrl)).size;

  return (
    <PlatinaPage
      eyebrow="Campaign intelligence"
      title={`Opportunities for ${client.name}`}
      description="What the market is engaging with right now, then the campaigns worth running because of it. Every number is measured and linked to where it came from; creative comes last."
    >
      <PlatinaFormError message={searchParams.error} />
      {clients.length > 1 ? (
        <nav aria-label="Client" className="mb-6 flex flex-wrap gap-2">
          {clients.map((c) => (
            <Link
              key={c.id}
              href={`/p/${params.ws}/opportunities?client=${c.id}`}
              className={cn(
                chip,
                c.id === client.id ? "border-primary text-primary" : "border-border text-muted-foreground",
              )}
            >
              {c.name}
            </Link>
          ))}
        </nav>
      ) : null}

      {/* 1. Interest */}
      <section aria-label="What people are interested in now">
        <h2 className={heading}>1 · What people are interested in now</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          From {posts} posts by {client.name} and {competitors.length} competitor
          {competitors.length === 1 ? "" : "s"} over the last {RECENT_DAYS + BASELINE_DAYS} days. 1.0× is a
          company&apos;s typical post, so big and small companies compare fairly. Paid ads are not
          counted as interest.
        </p>
        {measured.length === 0 ? (
          <p className={cn(card, "mt-3 text-sm text-muted-foreground")}>
            Not enough posts on any one subject yet to say what people prefer. It fills in as weekly
            collection adds history.
          </p>
        ) : (
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {measured.map((i) => (
              <li key={i.topic} className={card}>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-medium capitalize">{i.topic}</h3>
                  <span className={cn(chip, "border-border text-muted-foreground")}>
                    {i.origin === "client_topic" ? `${client.name} sells this` : "Market theme"}
                  </span>
                </div>
                <p className="mt-1 text-sm">{i.headline}.</p>
                <ProofLinks proofs={i.proofs} />
              </li>
            ))}
          </ul>
        )}
        {thin.length > 0 ? (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              {thin.length} more subject{thin.length === 1 ? "" : "s"} seen, not enough posts yet to rank
            </summary>
            <ul className="mt-2 space-y-1 pl-4 text-muted-foreground">
              {thin.map((i) => (
                <li key={i.topic}>
                  <span className="capitalize text-foreground">{i.topic}</span> — {i.headline}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      {/* 2. Campaigns */}
      <section aria-label="Campaigns to run" className="mt-10">
        <h2 className={heading}>2 · Campaigns to run</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {learning.results === 0 ? (
            <>
              Ordered by the rules below. Once you log creatives and confirm their reviews on{" "}
              <Link href={`/p/${params.ws}/results?brand=${client.id}`} className="text-primary underline-offset-4 hover:underline">
                Results
              </Link>
              , {client.name}&apos;s own results re-rank this list.
            </>
          ) : (
            <>
              Re-ranked by {learning.results} confirmed result{learning.results === 1 ? "" : "s"} of {client.name}&apos;s own (a
              value needs {learning.config.minN} before it moves anything).{" "}
              <Link href={`/p/${params.ws}/results?brand=${client.id}`} className="text-primary underline-offset-4 hover:underline">
                See what they teach
              </Link>
            </>
          )}
        </p>
        <div className="mt-3 grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="text-sm font-medium">Events — in person and online</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Ordered by time to prepare, then {client.region ? `${client.region}` : "your region"}, then how
              many competitors will be there.
            </p>
            {campaigns.events.length === 0 ? (
              <p className={cn(card, "mt-3 text-sm text-muted-foreground")}>
                No upcoming events with a stated date yet. Event pages are read weekly.
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {campaigns.events.map((c) => (
                  <CampaignCard key={c.key} c={c} ws={params.ws} clientId={client.id} />
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="text-sm font-medium">Online — subjects the audience engages with</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Only subjects with enough posts, above the typical post.
            </p>
            {campaigns.topics.length === 0 ? (
              <p className={cn(card, "mt-3 text-sm text-muted-foreground")}>
                No subject has enough evidence yet to recommend a campaign on it.
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {campaigns.topics.map((c) => (
                  <CampaignCard key={c.key} c={c} ws={params.ws} clientId={client.id} />
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* 3. Plans */}
      <section aria-label="Plans" className="mt-10">
        <h2 className={heading}>3 · Plans for {client.name}</h2>
        {clientPlans.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            None yet — start one from a campaign above, or{" "}
            <Link href={`/p/${params.ws}/plan?brand=${client.id}`} className="text-primary underline-offset-4 hover:underline">
              write a brief
            </Link>
            .
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
            {clientPlans.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/p/${params.ws}/plan/${p.id}`}
                  className="flex items-center justify-between gap-4 px-4 py-3 text-sm hover:bg-accent/50"
                >
                  <span className="truncate font-medium">{p.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {p.verdict ? `Result: ${p.verdict}` : "No result yet"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 4. Creative — last, on demand */}
      <section aria-label="Creative ideas" className="mt-10">
        <details className={card}>
          <summary className="cursor-pointer text-sm font-medium">
            4 · Creative ideas{" "}
            <span className="font-normal text-muted-foreground">(scripts and directions, drafted when you ask)</span>
          </summary>
          {all.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Creative follows a campaign — none to draft for yet.</p>
          ) : (
            <ul className="mt-3 space-y-1 text-sm">
              {all.map((c) => (
                <li key={c.key}>
                  <Link
                    href={`/p/${params.ws}/solutions/new?topic=${encodeURIComponent(c.creativeTopic)}`}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    Draft directions for: {c.creativeTopic}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </details>
      </section>
    </PlatinaPage>
  );
}
