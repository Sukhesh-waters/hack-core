import Link from "next/link";
import { PlatinaFormError } from "@/components/platina/form-error";
import { IdeaRun } from "@/components/platina/idea-run";
import { PlatinaPage } from "@/components/platina/page";
import { consolidatableBrainQuery, countIdeasSince, learningSnapshotsQuery } from "@/db/queries/platina-learning";
import { DECISION_WEIGHT } from "@/lib/platina/credit";
import { DAILY_IDEA_CAP, TRIGGER_LABEL } from "@/lib/platina/idea-engine";
import { loadTriggers } from "@/lib/platina/idea-load";
import { learnedPatterns, loadLearning, runConsolidation } from "@/lib/platina/learning-engine";
import { describePublicStat } from "@/lib/platina/learning-public";
import { cn } from "@/lib/utils";
import { consolidateAction, restoreInsightAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Learning" };

const card = "rounded-lg border border-border bg-card p-4";
const heading = "font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground";
const chip = "rounded-full border px-2 py-0 text-[11px]";
const link = "text-primary underline-offset-4 hover:underline";
const pct = (x: number) => `${Math.round(x * 100)}%`;

const KIND_LABEL: Record<string, string> = { opportunity: "Opportunity", brief: "Campaign brief", idea: "Idea" };
const STATUS_TONE: Record<string, string> = {
  open: "border-border text-muted-foreground",
  accepted: "border-primary/40 text-primary",
  planned: "border-emerald-500/50 text-emerald-700 dark:text-emerald-400",
  dismissed: "border-destructive/40 text-destructive",
};

/**
 * The learning engine (C8.5, ask A5): ideas triggered by today's data, what
 * the engine has learnt (the client's own public posts, and people's
 * decisions and results on every suggestion), the ledger where every
 * suggestion can be traced, and the monthly consolidation.
 */
export default async function LearningPage(props: {
  params: Promise<{ ws: string }>;
  searchParams: Promise<{ kind?: string; status?: string; dry?: string; consolidated?: string; error?: string; noted?: string }>;
}) {
  const { ws } = await props.params;
  const sp = await props.searchParams;
  const now = new Date();
  const dayStart = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const [view, triggers, snapshots, ideasToday, brain] = await Promise.all([
    loadLearning(ws, now),
    loadTriggers(ws, now),
    learningSnapshotsQuery(ws),
    countIdeasSince(ws, dayStart),
    consolidatableBrainQuery(ws),
  ]);
  if (!view.client) {
    return (
      <PlatinaPage eyebrow="Learn" title="Learning">
        <p className="text-sm text-muted-foreground">
          Add a client first.{" "}
          <Link href={`/p/${ws}/start`} className={link}>
            Add a client
          </Link>
        </p>
      </PlatinaPage>
    );
  }
  const client = view.client;
  const dry = sp.dry ? await runConsolidation(ws, { apply: false, now }) : null;
  const patterns = learnedPatterns(view);
  const publicOk = view.publicStats.filter((s) => s.status === "ok").sort((a, b) => b.mean - a.mean);
  const publicThin = view.publicStats.filter((s) => s.status !== "ok").sort((a, b) => b.n - a.n).slice(0, 6);
  const laneOk = view.learned.features.filter((s) => s.status === "ok").sort((a, b) => b.mean - a.mean);
  const trustOk = view.learned.trust.filter((t) => t.status === "ok");
  const eventsBy = new Map<string, number>();
  for (const e of view.events) if (e.kind !== "shown") eventsBy.set(e.suggestionId, (eventsBy.get(e.suggestionId) ?? 0) + 1);
  const shownBy = new Map<string, number>();
  for (const e of view.events) if (e.kind === "shown") shownBy.set(e.suggestionId, (shownBy.get(e.suggestionId) ?? 0) + 1);
  const ledger = view.suggestions.filter((s) => (!sp.kind || s.kind === sp.kind) && (!sp.status || s.status === sp.status)).slice(0, 60);
  const archived = brain.filter((b) => b.status === "archived");
  const filterHref = (k?: string, st?: string) => {
    const q = new URLSearchParams({ ...(k ? { kind: k } : {}), ...(st ? { status: st } : {}) }).toString();
    return `/p/${ws}/learning${q ? `?${q}` : ""}#ledger`;
  };

  return (
    <PlatinaPage
      eyebrow="Learn"
      title="Learning"
      description={`How Platina learns for ${client.name}: ideas drafted when something in the live data crosses a threshold, what worked (its own public posts, and what people did with each suggestion), and a ledger where every suggestion can be traced back to its evidence.`}
    >
      <PlatinaFormError message={sp.error} />
      {sp.noted ? <p className="mb-3 text-sm text-primary">Noted. The learning engine counts it from now on.</p> : null}
      {sp.consolidated ? <p className="mb-3 text-sm text-primary">Consolidated {sp.consolidated}. The digest is below.</p> : null}

      <section aria-label="Ideas from today's data" className={card}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className={heading}>Ideas from today&apos;s data</h2>
          <p className="text-xs text-muted-foreground">
            {ideasToday} of {DAILY_IDEA_CAP} ideas drafted today · about 80% follow what has worked, 20% try something new
          </p>
        </div>
        {triggers.triggers.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Nothing in today&apos;s data crosses a trigger threshold yet.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {triggers.triggers.slice(0, 5).map((t) => (
              <li key={t.key} className="rounded-md border border-border p-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-primary">{TRIGGER_LABEL[t.kind]}</p>
                <p className="font-medium">{t.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{t.facts[0]?.text}</p>
                <IdeaRun ws={ws} triggerKey={t.key} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="What it has learnt" className="mt-6 grid gap-3 lg:grid-cols-3">
        <div className={card}>
          <h2 className={heading}>{client.name}&apos;s own posts (public data)</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            A post worked when it beat {client.name}&apos;s typical engagement. Needs {view.config.minN} posts on a subject before it counts.
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {publicOk.map((s) => (
              <li key={s.value}>{describePublicStat(s, client.name, view.config.minN)}</li>
            ))}
            {publicOk.length === 0 ? <li className="text-muted-foreground">No subject has enough posts yet.</li> : null}
          </ul>
          {publicThin.length > 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">Still gathering: {publicThin.map((s) => `${s.value} (${s.n})`).join(", ")}.</p>
          ) : null}
        </div>
        <div className={card}>
          <h2 className={heading}>From decisions and results</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Planned or useful counts {pct(DECISION_WEIGHT)} of a measured result; a result counts in full. Fades with a {view.config.halfLifeDays}-day half-life.
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {laneOk.slice(0, 8).map((s) => (
              <li key={`${s.feature}:${s.value}`}>
                <span className="text-muted-foreground">{s.feature}</span> {s.value}: taken up {pct(s.mean)} over {s.n}
              </li>
            ))}
            {laneOk.length === 0 ? (
              <li className="text-muted-foreground">
                {view.learned.credits.length} decisions so far; a feature needs {view.config.minN} before it moves anything.
              </li>
            ) : null}
          </ul>
        </div>
        <div className={card}>
          <h2 className={heading}>Trust in sources</h2>
          <p className="mt-1 text-xs text-muted-foreground">Credit flows back to each source a suggestion rested on; &quot;a fact is wrong&quot; lowers it.</p>
          <ul className="mt-2 space-y-1 text-sm">
            {[...trustOk].sort((a, b) => b.mean - a.mean).slice(0, 4).map((t) => (
              <li key={t.ref} className="truncate" title={t.label}>
                {pct(t.mean)} · {t.label}
              </li>
            ))}
            {trustOk.length === 0 ? (
              <li className="text-muted-foreground">{view.learned.trust.length} sources credited; none past the evidence threshold yet.</li>
            ) : null}
          </ul>
          {patterns.length > 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">The idea engine uses {patterns.length} learned patterns.</p>
          ) : null}
        </div>
      </section>

      <section aria-label="Ledger" id="ledger" className="mt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className={heading}>Ledger · {view.suggestions.length} suggestions recorded</h2>
          <nav aria-label="Filter" className="flex flex-wrap gap-1.5 text-xs">
            {[undefined, "opportunity", "brief", "idea"].map((k) => (
              <Link key={k ?? "all"} href={filterHref(k, sp.status)} className={cn(chip, sp.kind === k ? "border-primary text-primary" : "border-border")}>
                {k ? KIND_LABEL[k] : "All"}
              </Link>
            ))}
            <span className="px-1 text-muted-foreground">·</span>
            {[undefined, "open", "accepted", "planned", "dismissed"].map((st) => (
              <Link key={st ?? "any"} href={filterHref(sp.kind, st)} className={cn(chip, sp.status === st ? "border-primary text-primary" : "border-border")}>
                {st ?? "Any status"}
              </Link>
            ))}
          </nav>
        </div>
        {ledger.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Nothing recorded yet: open Opportunities, or draft ideas above.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-card">
            {ledger.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <span className={cn(chip, "border-border")}>{KIND_LABEL[s.kind] ?? s.kind}</span>
                <Link href={`/p/${ws}/learning/${s.id}`} className="min-w-0 flex-1 truncate hover:underline">
                  {s.title}
                </Link>
                {s.explore ? <span className={cn(chip, "border-amber-500/50 text-amber-700 dark:text-amber-400")}>new direction</span> : null}
                <span className={cn(chip, STATUS_TONE[s.status] ?? "border-border")}>{s.status}</span>
                <span className="text-xs text-muted-foreground">
                  {s.inputs.length} inputs · shown {shownBy.get(s.id) ?? 0} d · {eventsBy.get(s.id) ?? 0} decisions ·{" "}
                  {new Date(s.createdAt).toISOString().slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Monthly consolidation" id="consolidation" className={cn(card, "mt-6")}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className={heading}>Monthly consolidation</h2>
          <p className="text-xs text-muted-foreground">Runs on the 1st at 02:00 UTC; once a month.</p>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <form action={consolidateAction}>
            <input type="hidden" name="workspaceId" value={ws} />
            <input type="hidden" name="mode" value="dry" />
            <button type="submit" className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent">
              Dry run: show what it would change
            </button>
          </form>
          <form action={consolidateAction}>
            <input type="hidden" name="workspaceId" value={ws} />
            <input type="hidden" name="mode" value="apply" />
            <button type="submit" className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground">
              Run now
            </button>
          </form>
        </div>
        {dry ? (
          <div className="mt-3 rounded-md border border-border p-3 text-sm">
            <p className="font-medium">
              Dry run for {dry.month}
              {dry.alreadyDone ? " (already consolidated this month: Run now would change nothing)" : ""}
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
              {dry.digest.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            {dry.plan.merges.slice(0, 5).map((m) => (
              <div key={m.keepId} className="mt-2 text-xs">
                <p>
                  <span className="font-medium">Keep:</span> {m.keep.slice(0, 180)}
                </p>
                {m.absorbed.map((a) => (
                  <p key={a} className="text-muted-foreground">
                    merge in: {a.slice(0, 160)}
                  </p>
                ))}
              </div>
            ))}
          </div>
        ) : null}
        {snapshots.length > 0 ? (
          <ul className="mt-3 space-y-3">
            {snapshots.slice(0, 6).map((s) => (
              <li key={s.id}>
                <p className="text-sm font-medium">What we learnt in {s.month}</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
                  {(((s.digest as { lines?: string[] }).lines) ?? []).map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">No month consolidated yet.</p>
        )}
        {archived.length > 0 ? (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-xs text-primary">{archived.length} retired insights (can be restored)</summary>
            <ul className="mt-2 space-y-1">
              {archived.map((a) => (
                <li key={a.id} className="flex items-start gap-2">
                  <form action={restoreInsightAction}>
                    <input type="hidden" name="workspaceId" value={ws} />
                    <input type="hidden" name="chunkId" value={a.id} />
                    <button type="submit" className="rounded border border-border px-1.5 text-xs hover:bg-accent">
                      Restore
                    </button>
                  </form>
                  <span className="text-muted-foreground">{a.content.slice(0, 160)}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>
    </PlatinaPage>
  );
}
