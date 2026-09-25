import Link from "next/link";
import { PlatinaFormError } from "@/components/platina/form-error";
import { PlatinaPage } from "@/components/platina/page";
import { PendingButton } from "@/components/platina/pending-button";
import { RunProgress } from "@/components/platina/run-progress";
import {
  brandDocCountsQuery,
  brandFindingsQuery,
  listBrands,
  listClientScopeSignals,
  listCompetitorsOf,
  listEvents,
  listScanSpecs,
  listWorkspaceEventParticipants,
} from "@/db/queries/platina";
import { buildCompetitorView, MIN_WHITE_SPACE, type CompetitorCard } from "@/lib/platina/competitor-view";
import { BASELINE_DAYS, RECENT_DAYS } from "@/lib/platina/interest";
import { cn } from "@/lib/utils";
import { addCompetitorUrlAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Competitors" };

const card = "rounded-lg border border-border bg-card p-4";
const heading = "font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground";
const chip = "rounded-full border px-2.5 py-0.5 text-xs";

const ago = (d: Date | null, now: Date) => {
  if (!d) return "never";
  const h = Math.round((now.getTime() - d.getTime()) / 3_600_000);
  return h < 1 ? "within the hour" : h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
};

function CompetitorCardView({ c, now }: { c: CompetitorCard; now: Date }) {
  return (
    <li className={card}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-medium">{c.name}</h3>
          <p className="text-xs text-muted-foreground">
            {c.collected.posts} posts · {c.collected.pages} pages · {c.collected.ads} ads · last collected {ago(c.lastCollectedAt, now)}
          </p>
        </div>
        {c.homepageUrl ? (
          <a href={c.homepageUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline-offset-4 hover:underline">
            Site ↗
          </a>
        ) : null}
      </div>

      {c.topics.length > 0 ? (
        <div className="mt-3">
          <p className={heading}>What they post about</p>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {c.topics.map((t) => (
              <li key={t.topic} className={cn(chip, "border-border")} title={`${t.posts} posts, median ${t.median}× their typical post`}>
                <span className="capitalize">{t.topic}</span> <span className="text-muted-foreground">· {t.posts} · {t.median}×</span>
              </li>
            ))}
          </ul>
          {c.bestPost ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Strongest post: {c.bestPost.value}× their typical, on {c.bestPost.topic}{" "}
              <a href={c.bestPost.url} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-4 hover:underline">
                open ↗
              </a>
            </p>
          ) : null}
        </div>
      ) : null}

      {c.going.length > 0 ? (
        <div className="mt-3">
          <p className={heading}>Where they will be</p>
          <ul className="mt-1 space-y-0.5 text-sm">
            {c.going.map((g) => (
              <li key={g.name}>
                {g.name} <span className="text-xs text-muted-foreground">{g.startsOn ?? "date not announced"}</span>{" "}
                <a href={g.proof} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline-offset-4 hover:underline">
                  proof ↗
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {c.findings.length > 0 ? (
        <div className="mt-3">
          <p className={heading}>What the analysis found</p>
          <ul className="mt-1 space-y-1.5 text-sm">
            {c.findings.map((f) => (
              <li key={`${f.title}-${f.at.toISOString()}`}>
                <span className="font-medium">{f.title}</span>
                <span className="text-muted-foreground"> — {f.summary}</span>{" "}
                <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline-offset-4 hover:underline">
                  source ↗
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-muted-foreground">{c.sources.length} sources watched</summary>
        <ul className="mt-1 space-y-0.5 text-muted-foreground">
          {c.sources.map((s) => (
            <li key={s.name}>
              {s.name} · last read {ago(s.lastSuccessAt, now)}
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}

/**
 * Competitors analysis – pattern layer (C8.2). Public data only (Plane B):
 * what each competitor publishes and how it lands, where they will be, what
 * the analysis found, and the patterns across all of them. Any competitor
 * link can be added and is read at once, step by step.
 */
export default async function CompetitorsPage(props: {
  params: Promise<{ ws: string }>;
  searchParams: Promise<{ tab?: string; add?: string; run?: string; error?: string; added?: string }>;
}) {
  const { ws } = await props.params;
  const sp = await props.searchParams;
  const now = new Date();
  const brands = await listBrands(ws);
  const client = brands.find((b) => b.kind === "own_brand" && b.status === "active");
  if (!client) {
    return (
      <PlatinaPage eyebrow="Watch" title="Competitors analysis – pattern layer" back={{ ws, fallback: `/w/${ws}` }}>
        <p className="text-sm text-muted-foreground">
          Add a client first.{" "}
          <Link href={`/p/${ws}/start`} className="text-primary underline-offset-4 hover:underline">
            Add a client
          </Link>
        </p>
      </PlatinaPage>
    );
  }
  const since = new Date(now.getTime() - (RECENT_DAYS + BASELINE_DAYS) * 86_400_000);
  const competitors = await listCompetitorsOf(ws, client.id);
  const ids = competitors.map((c) => c.id);
  const [specs, docCounts, findings, signals, events, participants] = await Promise.all([
    listScanSpecs(ws),
    ids.length ? brandDocCountsQuery(ws, ids) : Promise.resolve([]),
    ids.length ? brandFindingsQuery(ws, ids) : Promise.resolve([]),
    listClientScopeSignals(ws, client.id, since),
    listEvents(ws),
    listWorkspaceEventParticipants(ws),
  ]);
  const view = buildCompetitorView({
    client: { id: client.id, name: client.name, kind: client.kind, homepageUrl: client.homepageUrl ?? null },
    competitors: competitors.map((c) => ({ id: c.id, name: c.name, kind: c.kind, homepageUrl: c.homepageUrl ?? null })),
    specs: specs.map((s) => ({
      id: s.id,
      name: s.name,
      brandId: s.brandId,
      kind: s.targets[0]?.kind ?? "",
      lastSuccessAt: s.lastSuccessAt,
      enabled: s.enabled,
    })),
    docCounts,
    findings,
    signals,
    events,
    participants,
    now,
  });
  const tab = sp.tab === "patterns" ? "patterns" : "competitors";

  return (
    <PlatinaPage
      eyebrow="Watch · public data"
      title="Competitors analysis – pattern layer"
      // Opened from the InstaMedia sidebar button: Back returns there.
      back={{ ws, fallback: `/w/${ws}` }}
      description={`What ${client.name}'s competitors publish, how it lands with their audience, where they will be, and the patterns across the market. Public pages and posts only — kept apart from ${client.name}'s own knowledge.`}
    >
      <PlatinaFormError message={sp.error} />

      <section aria-label="Add a competitor link" className={card}>
        <form action={addCompetitorUrlAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="workspaceId" value={ws} />
          <label className="min-w-[18rem] flex-1 text-sm">
            <span className="text-xs text-muted-foreground">
              Any competitor link: a page, a news release, a LinkedIn company page, an event page, a LinkedIn or Meta ad-library search
            </span>
            <input
              name="url"
              defaultValue={sp.add ?? ""}
              required
              placeholder="https://www.agilent.com/en/product/…"
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="text-xs text-muted-foreground">About (if the link doesn&apos;t say)</span>
            <select name="brandId" defaultValue="" className="mt-1 block rounded-md border border-border bg-background px-2 py-2 text-sm">
              <option value="">Detect from the link</option>
              {competitors.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value="market">Market (no single company)</option>
            </select>
          </label>
          <PendingButton pendingLabel="Starting…">Read it now</PendingButton>
        </form>
        <p className="mt-2 text-xs text-muted-foreground">
          Web pages are read with Firecrawl (about 1 credit), LinkedIn and ad libraries with Apify; then the AI analyses the text
          and files it here. It is watched weekly after that.
        </p>
      </section>

      {sp.run ? (
        <div className="mt-4">
          <RunProgress ws={ws} runId={sp.run} />
        </div>
      ) : null}

      <nav aria-label="View" className="mt-6 flex gap-2">
        {[
          ["competitors", `Competitors · ${view.cards.length}`],
          ["patterns", "Pattern layer"],
        ].map(([key, label]) => (
          <Link
            key={key}
            href={`/p/${ws}/competitors${key === "patterns" ? "?tab=patterns" : ""}`}
            className={cn(chip, tab === key ? "border-primary text-primary" : "border-border text-muted-foreground")}
          >
            {label}
          </Link>
        ))}
      </nav>

      {tab === "competitors" ? (
        <ul className="mt-4 grid gap-4 lg:grid-cols-2">
          {view.cards.map((c) => (
            <CompetitorCardView key={c.id} c={c} now={now} />
          ))}
        </ul>
      ) : (
        <div className="mt-4 space-y-8">
          <section aria-label="Rising across the market">
            <h2 className={heading}>Rising across the market (engagement vs each company&apos;s typical post)</h2>
            {view.rising.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">Not enough posts yet on any one subject.</p>
            ) : (
              <ul className="mt-3 grid gap-3 md:grid-cols-2">
                {view.rising.map((r) => (
                  <li key={r.topic} className={card}>
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="text-sm font-medium capitalize">{r.topic}</h3>
                      <span className="font-mono text-sm text-primary">{r.value}×</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {r.n} posts{r.change !== null ? ` · ${r.change > 0 ? "+" : ""}${r.change} vs before` : ""}
                      {r.leaders.length ? ` · led by ${r.leaders.join(", ")}` : ""}
                      {r.proof ? (
                        <>
                          {" · "}
                          <a href={r.proof} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-4 hover:underline">
                            strongest post ↗
                          </a>
                        </>
                      ) : null}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="White space">
            <h2 className={heading}>White space · competitors talk about it, {client.name} does not</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Subjects with at least {MIN_WHITE_SPACE} competitor posts and none from {client.name} in the last{" "}
              {RECENT_DAYS + BASELINE_DAYS} days.
            </p>
            {view.theyTalk.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">None: {client.name} posts on every subject its competitors do.</p>
            ) : (
              <ul className="mt-3 grid gap-3 md:grid-cols-2">
                {view.theyTalk.map((w) => (
                  <li key={w.topic} className={card}>
                    <h3 className="text-sm font-medium capitalize">{w.topic}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {w.themPosts} competitor posts ({w.them.map((t) => `${t.name} ${t.posts}`).join(", ")}) · {client.name}: 0
                    </p>
                    <Link
                      href={`/p/${ws}/plan?brand=${client.id}&goal=${encodeURIComponent(`Enter the conversation on ${w.topic}: competitors posted ${w.themPosts} times on it in the last ${RECENT_DAYS + BASELINE_DAYS} days, ${client.name} none.`)}`}
                      className="mt-2 inline-block text-xs text-primary underline-offset-4 hover:underline"
                    >
                      Plan a campaign on it →
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {view.onlyClient.length > 0 ? (
            <section aria-label="Only the client">
              <h2 className={heading}>{client.name} alone on these</h2>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {view.onlyClient.map((w) => (
                  <li key={w.topic} className={cn(chip, "border-primary/40 text-primary")}>
                    <span className="capitalize">{w.topic}</span> · {w.clientPosts} posts
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </PlatinaPage>
  );
}
