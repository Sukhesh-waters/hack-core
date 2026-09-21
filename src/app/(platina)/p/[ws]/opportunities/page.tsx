import Link from "next/link";
import { PlatinaFormError } from "@/components/platina/form-error";
import { PlatinaPage } from "@/components/platina/page";
import { PendingButton } from "@/components/platina/pending-button";
import {
  listBrands,
  listClientScopeSignals,
  listCompetitorsOf,
  listEvents,
  listPlansWithVerdict,
  listWorkspaceEventParticipants,
} from "@/db/queries/platina";
import { BASELINE_DAYS, clientTopics, RECENT_DAYS, topicMomentum } from "@/lib/platina/interest";
import {
  buildCampaigns,
  buildInsights,
  type Campaign,
  type Proof,
} from "@/lib/platina/opportunities";
import { cn } from "@/lib/utils";
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

function CampaignCard({ c, ws, clientId }: { c: Campaign; ws: string; clientId: string }) {
  return (
    <li className={card}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-sm font-medium">{c.title}</h3>
        <span className="flex shrink-0 gap-2">
          <span className={cn(chip, "border-border text-muted-foreground")}>
            {c.channel === "online" ? "Online" : "In person"}
          </span>
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
      <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
        {c.why.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
      <ProofLinks proofs={c.proofs} />
      <form action={createPlanAction} className="mt-3">
        <input type="hidden" name="workspaceId" value={ws} />
        <input type="hidden" name="brandId" value={clientId} />
        <input type="hidden" name="useCase" value={c.plan.useCase} />
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
      </form>
    </li>
  );
}

/**
 * The suggestion page (campaign intelligence C5), in the owner's order:
 * what people are interested in (with proof) -> campaigns to run (online and
 * in person, with proof) -> plans -> creative, collapsed at the bottom.
 * Reads stored signals and events only — no model call on page load.
 */
export default async function OpportunitiesPage({
  params,
  searchParams,
}: {
  params: { ws: string };
  searchParams: { client?: string; error?: string };
}) {
  // Two database rounds, not four: everything that does not depend on the
  // chosen client first, then the client's competitors and signals together.
  const [brands, events, participants, plans] = await Promise.all([
    listBrands(params.ws),
    listEvents(params.ws),
    listWorkspaceEventParticipants(params.ws),
    listPlansWithVerdict(params.ws),
  ]);
  const clients = brands.filter((b) => b.kind === "own_brand");
  const client = clients.find((c) => c.id === searchParams.client) ?? clients[0];

  if (!client) {
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

  const now = new Date();
  const since = new Date(now.getTime() - (RECENT_DAYS + BASELINE_DAYS) * 86_400_000);
  const [competitors, signals] = await Promise.all([
    listCompetitorsOf(params.ws, client.id),
    listClientScopeSignals(params.ws, client.id, since),
  ]);

  const input = {
    client: {
      id: client.id,
      name: client.name,
      region: client.region ?? null,
      topics: clientTopics(client.profile ?? null, client.name),
    },
    competitors: competitors.map((c) => ({ id: c.id, name: c.name })),
    momentum: topicMomentum(signals, now),
    proofOwner: new Map(signals.map((s) => [s.sourceUrl, s.brandId])),
    events: events.map((e) => ({
      ...e,
      participants: participants.filter((p) => p.eventId === e.id),
    })),
    now,
  };
  const insights = buildInsights(input);
  const measured = insights.filter((i) => i.status === "ok");
  const thin = insights.filter((i) => i.status === "insufficient");
  const campaigns = buildCampaigns(input);
  const all = [...campaigns.events, ...campaigns.topics];
  const clientPlans = plans.filter((p) => p.brandId === client.id).slice(0, 5);
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
