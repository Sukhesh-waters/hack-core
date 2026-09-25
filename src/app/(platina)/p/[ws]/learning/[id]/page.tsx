import Link from "next/link";
import { notFound } from "next/navigation";
import { PlatinaPage } from "@/components/platina/page";
import { SuggestionFeedback } from "@/components/platina/suggestion-feedback";
import { suggestionByIdQuery } from "@/db/queries/platina-learning";
import { creditOf } from "@/lib/platina/credit";
import { loadLearning } from "@/lib/platina/learning-engine";
import { cn } from "@/lib/utils";
import { suggestionFeedbackAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Suggestion trace" };

const card = "rounded-lg border border-border bg-card p-4";
const heading = "font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground";
const chip = "rounded-full border px-2 py-0 text-[11px]";
const PLANE: Record<string, { label: string; tone: string }> = {
  A: { label: "own page", tone: "border-primary/40 text-primary" },
  B: { label: "public", tone: "border-border text-muted-foreground" },
  C: { label: "learned", tone: "border-amber-500/50 text-amber-700 dark:text-amber-400" },
};
const EVENT_LABEL: Record<string, string> = {
  shown: "shown",
  opened: "opened",
  accepted: "marked useful",
  planned: "planned",
  dismissed: "dismissed",
  result: "result",
};
const pct = (x: number) => `${Math.round(x * 100)}%`;

/**
 * One suggestion, traced end to end (C8.5): the inputs it rested on (with
 * plane and weight), what it said, what people did with it, the results, and
 * the credit each event sent back to each input and feature.
 */
export default async function SuggestionTracePage(props: { params: Promise<{ ws: string; id: string }> }) {
  const { ws, id } = await props.params;
  const [[s], view] = await Promise.all([suggestionByIdQuery(ws, id), loadLearning(ws)]);
  if (!s) notFound();
  const events = view.events.filter((e) => e.suggestionId === s.id);
  const shownDays = events.filter((e) => e.kind === "shown").length;
  const decisions = events.filter((e) => e.kind !== "shown");
  const ledgerS = { id: s.id, title: s.title, inputs: s.inputs, features: s.features };
  const trust = new Map(view.learned.trust.map((t) => [t.ref, t]));
  const body = s.body as Record<string, unknown>;
  const lines = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === "string") : typeof v === "string" && v ? [v] : []);

  return (
    <PlatinaPage eyebrow="Learn · trace" title={s.title} description={`${s.kind} · recorded ${new Date(s.createdAt).toISOString().slice(0, 16).replace("T", " ")} UTC · status ${s.status}`}>
      <p className="mb-4 text-sm">
        <Link href={`/p/${ws}/learning#ledger`} className="text-primary underline-offset-4 hover:underline">
          ← Ledger
        </Link>
      </p>

      <div className="grid gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr]">
        <section className={card} aria-label="Inputs">
          <h2 className={heading}>1 · Inputs it rested on</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {s.inputs.map((i) => {
              const t = trust.get(i.ref);
              return (
                <li key={i.ref}>
                  <span className={cn(chip, PLANE[i.plane]?.tone)}>{PLANE[i.plane]?.label ?? i.plane}</span>{" "}
                  <span className="font-mono text-[11px] text-muted-foreground">{pct(i.weight)}</span>{" "}
                  {i.url ? (
                    <a href={i.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                      {i.label}
                    </a>
                  ) : (
                    i.label
                  )}
                  <p className="text-xs text-muted-foreground">
                    trust {t ? `${pct(t.mean)} over ${t.n} (${t.status === "ok" ? "counts" : "still gathering"})` : "no decisions yet"}
                  </p>
                </li>
              );
            })}
            {s.inputs.length === 0 ? <li className="text-muted-foreground">No linked inputs.</li> : null}
          </ul>
        </section>
        <div className="hidden items-center text-muted-foreground lg:flex">→</div>
        <section className={card} aria-label="Suggestion">
          <h2 className={heading}>2 · The suggestion</h2>
          <p className="mt-2 font-medium">{s.title}</p>
          {s.explore ? <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">Tried something new on purpose (the explore share).</p> : null}
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {["hook", "goal", "why", "whyNow", "fit", "salesAngle", "pattern"].flatMap((k) =>
              lines(body[k]).map((l) => (
                <li key={`${k}:${l}`}>
                  <span className="text-foreground">{k === "whyNow" ? "why now" : k === "salesAngle" ? "sales angle" : k}:</span> {l}
                </li>
              )),
            )}
          </ul>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-2 text-xs">
            {Object.entries(s.features)
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd>{String(v)}</dd>
                </div>
              ))}
            <dt className="text-muted-foreground">weights</dt>
            <dd>{s.weightsVersion}</dd>
            {s.promptVersion ? (
              <>
                <dt className="text-muted-foreground">prompt</dt>
                <dd>{s.promptVersion}</dd>
              </>
            ) : null}
          </dl>
        </section>
        <div className="hidden items-center text-muted-foreground lg:flex">→</div>
        <section className={card} aria-label="What happened">
          <h2 className={heading}>3 · What happened, and the credit sent back</h2>
          <p className="mt-2 text-xs text-muted-foreground">Shown on {shownDays} day{shownDays === 1 ? "" : "s"}.</p>
          <ol className="mt-2 space-y-3 text-sm">
            {decisions.map((e) => {
              const c = creditOf(ledgerS, e);
              return (
                <li key={e.id}>
                  <p>
                    <span className="font-medium">{EVENT_LABEL[e.kind] ?? e.kind}</span>
                    {e.reason ? ` · ${e.reason.replace(/_/g, " ")}` : ""}
                    {e.reward !== null ? ` · reward ${e.reward}` : ""}{" "}
                    <span className="text-xs text-muted-foreground">{e.createdAt.toISOString().slice(0, 10)}</span>
                  </p>
                  {c ? (
                    <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                      <li>
                        {c.why}; counts {pct(c.weight)} of a result
                      </li>
                      {c.inputs.map((i) => (
                        <li key={i.ref}>
                          → {i.label.slice(0, 60)}: {i.alpha > 0 ? `+${i.alpha} for` : ""}
                          {i.beta > 0 ? `+${i.beta} against` : ""}
                        </li>
                      ))}
                      {c.features.map((f) => (
                        <li key={`${f.feature}:${f.value}`}>
                          → {f.feature} &quot;{f.value}&quot;: {f.alpha > 0 ? `+${f.alpha} for` : ""}
                          {f.beta > 0 ? `+${f.beta} against` : ""}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
            {decisions.length === 0 ? <li className="text-muted-foreground">No decision or result yet.</li> : null}
          </ol>
        </section>
      </div>

      <section className={cn(card, "mt-4")} aria-label="Decide">
        <h2 className={heading}>Your call</h2>
        <SuggestionFeedback action={suggestionFeedbackAction} ws={ws} back={`/p/${ws}/learning/${s.id}`} suggestionId={s.id} inputs={s.inputs} />
      </section>
    </PlatinaPage>
  );
}
