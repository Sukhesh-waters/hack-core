import Link from "next/link";
import { notFound } from "next/navigation";
import { PlatinaFormError } from "@/components/platina/form-error";
import { PlatinaPage } from "@/components/platina/page";
import { PendingButton } from "@/components/platina/pending-button";
import { REVIEW_FACTORS, type ReviewWhy } from "@/db/platina-schema";
import { getBrand, getPlan } from "@/db/queries/platina";
import { getCreative, getReviewForCreative, listMetricsForCreatives } from "@/db/queries/platina-learning";
import { learningConfig, phaseEvidence } from "@/lib/platina/learning-service";
import { describeFacts, engagementRate, pct, suggestVerdict } from "@/lib/platina/review";
import { addNumbersAction, confirmReviewAction, draftReviewAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Creative" };

const field = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
const NUMBER_INPUTS = [
  ["impressions", "Impressions"],
  ["reach", "Reach"],
  ["clicks", "Clicks"],
  ["engagements", "Engagements"],
  ["saves", "Saves"],
  ["shares", "Shares / reposts"],
  ["videoViews", "Video views"],
  ["leads", "Leads"],
  ["spend", "Spend"],
] as const;
const VERDICT_TEXT = { worked: "Worked", mixed: "Mixed", failed: "Failed" } as const;

export default async function CreativePage({
  params,
  searchParams,
}: {
  params: { ws: string; id: string };
  searchParams: { error?: string; added?: string; saved?: string; confirmed?: string; demoted?: string; promoted?: string };
}) {
  const creative = await getCreative(params.ws, params.id);
  if (!creative) notFound();
  const [metrics, review, config, brand, plan, evidence] = await Promise.all([
    listMetricsForCreatives(params.ws, [creative.id]),
    getReviewForCreative(params.ws, creative.id),
    learningConfig(params.ws),
    creative.brandId ? getBrand(params.ws, creative.brandId) : Promise.resolve(null),
    creative.planId ? getPlan(params.ws, creative.planId) : Promise.resolve(null),
    phaseEvidence(params.ws, creative),
  ]);
  const phase = plan && creative.phaseId ? plan.plan.phases.find((p) => p.id === creative.phaseId) : null;
  const publicEvidence = evidence.filter((e) => e.plane === "B");
  const suggested = review ? suggestVerdict(review.facts) : null;
  const verdict = review?.verdict ?? suggested ?? "";
  const whyRows: (ReviewWhy | null)[] = [...(review?.why ?? []), null, null, null, null].slice(0, Math.max(4, review?.why.length ?? 0));

  return (
    <PlatinaPage
      eyebrow={brand ? `${brand.name} · creative` : "Creative"}
      title={creative.title}
      description={[creative.channel, creative.format, creative.topic, creative.hookType ? `${creative.hookType} hook` : null]
        .filter(Boolean)
        .join(" · ")}
    >
      <PlatinaFormError message={searchParams.error} />
      {searchParams.added ? (
        <p className="mb-4 rounded-md border border-border bg-card p-3 text-sm">
          Logged. Add its numbers as they come in; the review opens after {config.reviewAfterDays} days of numbers.
        </p>
      ) : null}
      {searchParams.confirmed ? (
        <p className="mb-4 rounded-md border border-primary/40 bg-primary/5 p-3 text-sm">
          Confirmed and learned: the lesson is stored as first-party knowledge
          {Number(searchParams.demoted) > 0 ? `, ${searchParams.demoted} public insight(s) marked down` : ""}
          {Number(searchParams.promoted) > 0 ? `, ${searchParams.promoted} public insight(s) strengthened` : ""}.{" "}
          <Link href={`/p/${params.ws}/opportunities`} className="underline underline-offset-4">
            See Opportunities
          </Link>
        </p>
      ) : null}

      <section className="mb-6 grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">What we expected, and why</p>
          <p className="mt-1">{creative.hypothesis}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Where it came from</p>
          <p className="mt-1">
            {plan ? (
              <>
                Plan{" "}
                <Link href={`/p/${params.ws}/plan/${plan.id}`} className="text-primary underline-offset-4 hover:underline">
                  {plan.title}
                </Link>
                {phase ? `, phase "${phase.name}"` : ""}
              </>
            ) : creative.opportunityKey ? (
              `Opportunity: ${creative.opportunityKey.replace(/^(topic|event):/, "")}`
            ) : (
              "Logged on its own"
            )}
            {creative.postedAt ? ` · posted ${creative.postedAt.toISOString().slice(0, 10)}` : " · not posted yet"}
          </p>
          {creative.url ? (
            <a href={creative.url} className="mt-1 block break-all text-xs text-primary underline-offset-4 hover:underline">
              {creative.url}
            </a>
          ) : null}
        </div>
      </section>

      <h2 className="font-display text-lg font-medium">Numbers over time</h2>
      {metrics.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No numbers yet.</p>
      ) : (
        <div className="mt-2 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2 text-right">Impr.</th>
                <th className="px-3 py-2 text-right">Reach</th>
                <th className="px-3 py-2 text-right">Clicks</th>
                <th className="px-3 py-2 text-right">Eng.</th>
                <th className="px-3 py-2 text-right">Rate</th>
                <th className="px-3 py-2 text-right">Leads</th>
                <th className="px-3 py-2">Source</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((m) => (
                <tr key={m.id} className="border-t border-border">
                  <td className="px-3 py-2">{m.capturedAt.toISOString().slice(0, 10)}</td>
                  <td className="px-3 py-2 text-right">{m.impressions ?? "—"}</td>
                  <td className="px-3 py-2 text-right">{m.reach ?? "—"}</td>
                  <td className="px-3 py-2 text-right">{m.clicks ?? "—"}</td>
                  <td className="px-3 py-2 text-right">{m.engagements ?? "—"}</td>
                  <td className="px-3 py-2 text-right">{pct(engagementRate(m))}</td>
                  <td className="px-3 py-2 text-right">{m.leads ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{m.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form action={addNumbersAction} className="mt-3 rounded-lg border border-border bg-card p-4">
        <input type="hidden" name="workspaceId" value={params.ws} />
        <input type="hidden" name="creativeId" value={creative.id} />
        <p className="text-sm font-medium">Add numbers</p>
        <p className="text-xs text-muted-foreground">Leave a box empty when you don&apos;t have that number: empty means not measured, never zero.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-5">
          <label className="text-xs">
            Date
            <input type="date" name="capturedAt" className={`mt-1 ${field}`} />
          </label>
          {NUMBER_INPUTS.map(([name, label]) => (
            <label key={name} className="text-xs">
              {label}
              <input name={name} inputMode="decimal" className={`mt-1 ${field}`} />
            </label>
          ))}
        </div>
        <div className="mt-3">
          <PendingButton pendingLabel="Saving…">Save numbers</PendingButton>
        </div>
      </form>

      <section id="review" aria-label="Review" className="mt-8 rounded-lg border border-border bg-card p-4">
        <h2 className="font-display text-lg font-medium">Review: what, why, how</h2>
        {!review ? (
          <div className="mt-2 text-sm text-muted-foreground">
            {metrics.length === 0
              ? "Opens once it has numbers."
              : `Opens by itself after ${config.reviewAfterDays} days of numbers, or now:`}
            {metrics.length > 0 ? (
              <form action={draftReviewAction} className="mt-2">
                <input type="hidden" name="workspaceId" value={params.ws} />
                <input type="hidden" name="creativeId" value={creative.id} />
                <PendingButton pendingLabel="Drafting…">Review now</PendingButton>
              </form>
            ) : null}
          </div>
        ) : (
          <>
            <div className="mt-2 rounded-md bg-muted/40 p-3 text-sm">
              <p className="text-xs text-muted-foreground">Measured (computed, not written by the AI)</p>
              <ul className="mt-1 list-disc pl-5">
                {describeFacts(review.facts, config.minN).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {suggested ? (
                <p className="mt-1 text-xs">The numbers point to: {VERDICT_TEXT[suggested]}.</p>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">The numbers alone can&apos;t say whether it worked; you decide.</p>
              )}
            </div>

            {review.status === "confirmed" ? (
              <div className="mt-3 space-y-2 text-sm">
                <p>
                  <span className="font-medium">{VERDICT_TEXT[review.verdict ?? "mixed"]}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    · confirmed {review.confirmedAt?.toISOString().slice(0, 10)}
                    {review.draftedBy === "human" ? " · edited by the team" : " · AI draft accepted"}
                  </span>
                </p>
                <p>
                  <span className="text-xs text-muted-foreground">What happened</span>
                  <br />
                  {review.what}
                </p>
                {review.why.length > 0 ? (
                  <ul className="list-disc pl-5">
                    {review.why.map((w, i) => (
                      <li key={i}>
                        <span className="font-medium">
                          {w.factor} {w.effect}
                        </span>
                        : {w.reason}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <p>
                  <span className="text-xs text-muted-foreground">Next time</span>
                  <br />
                  {review.how}
                </p>
                {review.keep ? (
                  <p>
                    <span className="text-xs text-muted-foreground">Keep</span>
                    <br />
                    {review.keep}
                  </p>
                ) : null}
              </div>
            ) : (
              <form action={confirmReviewAction} className="mt-3 space-y-3 text-sm">
                <input type="hidden" name="workspaceId" value={params.ws} />
                <input type="hidden" name="creativeId" value={creative.id} />
                {review.draftError ? (
                  <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">{review.draftError}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">Drafted by the AI from the numbers above. Edit anything; nothing is learned until you confirm.</p>
                )}
                <label className="block">
                  Did it work?
                  <select name="verdict" defaultValue={verdict} required className={`mt-1 ${field} sm:w-48`}>
                    <option value="" disabled>
                      Choose
                    </option>
                    <option value="worked">Worked</option>
                    <option value="mixed">Mixed</option>
                    <option value="failed">Failed</option>
                  </select>
                </label>
                <label className="block">
                  What happened
                  <textarea name="what" rows={2} required defaultValue={review.what ?? ""} className={`mt-1 ${field}`} />
                </label>
                <fieldset>
                  <legend>Why: what helped or hurt (a likely cause, not proof)</legend>
                  <div className="mt-1 space-y-2">
                    {whyRows.map((w, i) => (
                      <div key={i} className="grid gap-2 sm:grid-cols-[9rem_8rem_1fr]">
                        <select name={`factor_${i}`} defaultValue={w?.factor ?? ""} className={field} aria-label="Factor">
                          <option value="">Factor</option>
                          {REVIEW_FACTORS.map((f) => (
                            <option key={f}>{f}</option>
                          ))}
                        </select>
                        <select name={`effect_${i}`} defaultValue={w?.effect ?? ""} className={field} aria-label="Effect">
                          <option value="">Effect</option>
                          <option value="helped">helped</option>
                          <option value="hurt">hurt</option>
                          <option value="neutral">neutral</option>
                        </select>
                        <input name={`reason_${i}`} defaultValue={w?.reason ?? ""} placeholder="Because…" className={field} aria-label="Reason" />
                      </div>
                    ))}
                  </div>
                </fieldset>
                <label className="block">
                  How: the one change to make next time
                  <textarea name="how" rows={2} required defaultValue={review.how ?? ""} className={`mt-1 ${field}`} />
                </label>
                <label className="block">
                  Keep: what to repeat
                  <input name="keep" defaultValue={review.keep ?? ""} className={`mt-1 ${field}`} />
                </label>
                {publicEvidence.length > 0 ? (
                  <fieldset className="rounded-md border border-border p-3">
                    <legend className="px-1">Trace it back</legend>
                    <p className="text-xs text-muted-foreground">
                      The plan phase rested on these public insights. On confirm, a failed result marks the ticked ones
                      down (out of future plans) and a win strengthens them. Untick any the result says nothing about.
                    </p>
                    <ul className="mt-2 space-y-1">
                      {publicEvidence.map((e) => (
                        <li key={e.id}>
                          <label className="flex gap-2">
                            <input type="checkbox" name="backtrack" value={e.id} defaultChecked />
                            <span className="text-xs">{e.content.replace(/\s+/g, " ").slice(0, 220)}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </fieldset>
                ) : null}
                <div className="flex flex-wrap items-center gap-3">
                  <PendingButton pendingLabel="Learning…">Confirm and learn</PendingButton>
                </div>
              </form>
            )}
            {review.status === "draft" ? (
              <form action={draftReviewAction} className="mt-2">
                <input type="hidden" name="workspaceId" value={params.ws} />
                <input type="hidden" name="creativeId" value={creative.id} />
                <button type="submit" className="text-xs text-muted-foreground underline underline-offset-4">
                  Redraft with the latest numbers
                </button>
              </form>
            ) : null}
          </>
        )}
      </section>
    </PlatinaPage>
  );
}
