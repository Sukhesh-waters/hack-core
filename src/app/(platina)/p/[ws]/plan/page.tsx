import Link from "next/link";
import { PlatinaFormError } from "@/components/platina/form-error";
import { PlatinaPage } from "@/components/platina/page";
import { PendingButton } from "@/components/platina/pending-button";
import {
  listBrands,
  listFindings,
  listPlansWithVerdict,
} from "@/db/queries/platina";
import { BRIEF_MAX_CHARS } from "@/lib/platina/plan/brief";
import { readPlanFreshness } from "@/lib/platina/plan/freshness-read";
import { cn } from "@/lib/utils";
import { createPlanAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Plan a campaign" };

const VERDICT_LABEL: Record<string, { label: string; classes: string }> = {
  worked: { label: "Worked", classes: "border-brand-success/40 text-brand-success" },
  mixed: { label: "Mixed", classes: "border-brand-amber/40 text-brand-amber" },
  failed: { label: "Failed", classes: "border-destructive/40 text-destructive" },
};

const input =
  "mt-1 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm";
const card = "rounded-lg border border-border bg-card p-4";

export default async function PlanPage({
  params,
  searchParams,
}: {
  params: { ws: string };
  searchParams: { error?: string; from?: string; brand?: string };
}) {
  const [plans, findings, brands] = await Promise.all([
    listPlansWithVerdict(params.ws),
    listFindings(params.ws),
    listBrands(params.ws),
  ]);
  const clients = brands.filter((b) => b.kind === "own_brand");
  // Freshness for the newest few only — cheap reads, no model calls.
  const freshness = await Promise.all(
    plans.slice(0, 5).map((p) =>
      readPlanFreshness({ workspaceId: params.ws, brandId: p.brandId, createdAt: p.createdAt }),
    ),
  );

  const fromId = searchParams.from?.startsWith("finding:")
    ? searchParams.from.slice("finding:".length)
    : null;
  const moves = findings
    .filter(
      (f) =>
        f.useCase === "competitor_change" &&
        ["new", "needs_decision", "validated"].includes(f.status),
    )
    .sort((a, b) => (a.id === fromId ? -1 : b.id === fromId ? 1 : 0))
    .slice(0, 5);

  const clientSelect = (required = false) => (
    <label className="block text-sm font-medium">
      Client{required ? "" : " (optional)"}
      <select
        name="brandId"
        required={required}
        defaultValue={searchParams.brand ?? ""}
        className={input}
      >
        {required ? null : <option value="">Whole workspace</option>}
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <PlatinaPage
      eyebrow="Campaign planning"
      title="Plan a campaign"
      description="Start from what is actually happening. Each plan is built from what we have collected, says what it rests on, and tells you when new evidence arrives."
    >
      <PlatinaFormError message={searchParams.error} />

      <div className="grid gap-4 md:grid-cols-2">
        <section className={cn(card, "md:col-span-2")} aria-label="A competitor moved">
          <h2 className="font-medium">A competitor moved</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Turn something we saw into a response plan for that client.
          </p>
          {moves.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              No competitor moves yet. They appear here as collection finds and validates them.{" "}
              <Link href={`/p/${params.ws}/brands`} className="text-primary underline-offset-4 hover:underline">
                See what we are watching
              </Link>
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-border">
              {moves.map((f) => (
                <li key={f.id} className="flex items-start justify-between gap-4 py-3">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{f.title}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{f.summary}</span>
                  </span>
                  <form action={createPlanAction} className="shrink-0">
                    <input type="hidden" name="workspaceId" value={params.ws} />
                    <input type="hidden" name="useCase" value="finding" />
                    <input type="hidden" name="findingId" value={f.id} />
                    <PendingButton pendingLabel="Planning…">
                      {f.id === fromId ? "Plan this response" : "Plan a response"}
                    </PendingButton>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={card} aria-label="An event is coming">
          <h2 className="font-medium">An event is coming</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            We plan backwards so the campaign peaks on the day.
          </p>
          <form action={createPlanAction} className="mt-3 space-y-3">
            <input type="hidden" name="workspaceId" value={params.ws} />
            <input type="hidden" name="useCase" value="event" />
            <label className="block text-sm font-medium">
              Event
              <input name="eventName" required placeholder="Analytica 2027" className={input} />
            </label>
            <label className="block text-sm font-medium">
              Date
              <input name="eventDate" type="date" required className={input} />
            </label>
            {clientSelect()}
            <PendingButton pendingLabel="Planning…">Plan backwards from the date</PendingButton>
          </form>
        </section>

        <section className={card} aria-label="A client campaign">
          <h2 className="font-medium">A client campaign</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Uses only what we have collected for that client and its competitors.
          </p>
          {clients.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Add a client first.{" "}
              <Link href={`/p/${params.ws}/start`} className="text-primary underline-offset-4 hover:underline">
                Add a client
              </Link>
            </p>
          ) : (
            <form action={createPlanAction} className="mt-3 space-y-3">
              <input type="hidden" name="workspaceId" value={params.ws} />
              <input type="hidden" name="useCase" value="client" />
              {clientSelect(true)}
              <label className="block text-sm font-medium">
                Goal
                <input
                  name="goal"
                  required
                  maxLength={200}
                  placeholder="Win back lapsed subscribers before the holidays"
                  className={input}
                />
              </label>
              <PendingButton pendingLabel="Planning…">Plan for this client</PendingButton>
            </form>
          )}
        </section>

        <section className={cn(card, "md:col-span-2")} aria-label="Write your own brief">
          <h2 className="font-medium">Or write your own brief</h2>
          <form action={createPlanAction} className="mt-3 space-y-3">
            <input type="hidden" name="workspaceId" value={params.ws} />
            <input type="hidden" name="useCase" value="brief" />
            <label className="block text-sm font-medium">
              Two lines: what you are promoting and who it is for
              <textarea
                name="brief"
                rows={2}
                required
                maxLength={BRIEF_MAX_CHARS}
                placeholder={"Launch our new espresso subscription.\nTarget: home baristas in the UK, 25-40."}
                className={input}
              />
            </label>
            {clients.length > 0 ? clientSelect() : null}
            <PendingButton pendingLabel="Planning…">Plan this campaign</PendingButton>
          </form>
        </section>
      </div>

      <section className="mt-10">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          Your plans
        </h2>
        {plans.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No plans yet. Pick a situation above to make the first one.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
            {plans.map((plan, i) => {
              const verdict = plan.verdict ? VERDICT_LABEL[plan.verdict] : null;
              const fresh = freshness[i];
              return (
                <li key={plan.id}>
                  <Link
                    href={`/p/${params.ws}/plan/${plan.id}`}
                    className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-accent/50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{plan.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {plan.origin ? `${plan.origin.label} · ` : ""}
                        {plan.brief.replace(/\s+/g, " ")}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {fresh && fresh.count > 0 ? (
                        <span
                          className={cn(
                            "rounded-full border px-2.5 py-0.5 text-xs",
                            fresh.level === "replan"
                              ? "border-brand-amber/40 text-brand-amber"
                              : "border-border text-muted-foreground",
                          )}
                        >
                          {fresh.count} new signal{fresh.count === 1 ? "" : "s"}
                        </span>
                      ) : null}
                      <span
                        className={cn(
                          "rounded-full border px-2.5 py-0.5 text-xs",
                          verdict ? verdict.classes : "border-border text-muted-foreground",
                        )}
                      >
                        {verdict ? verdict.label : "No result yet"}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </PlatinaPage>
  );
}
