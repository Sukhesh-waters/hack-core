import { PlatinaFormError } from "@/components/platina/form-error";
import { PlatinaPage } from "@/components/platina/page";
import {
  listActiveClaimsRules,
  listBrandChunks,
  claimsRulesQuery,
} from "@/db/queries/platina";
import { claimsDnaFromRules } from "@/lib/platina/claims-gate";
import { auditCopyAgainstStandard } from "@/lib/platina/drift";
import {
  addClaimsRuleAction,
  archiveClaimsRuleAction,
  recordDriftFindingAction,
} from "../../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Platina admin — claims" };

export default async function AdminClaimsPage({
  params,
  searchParams,
}: {
  params: { ws: string };
  searchParams: { copy?: string; error?: string };
}) {
  const [rules, allRules, standard] = await Promise.all([
    listActiveClaimsRules(params.ws),
    claimsRulesQuery(params.ws),
    listBrandChunks(params.ws),
  ]);
  const { dna, source } = claimsDnaFromRules(rules);

  const copy = searchParams.copy ?? "";
  // The audit runs on GET and writes nothing — recording a finding is a
  // separate, explicit action.
  const audit = copy
    ? await auditCopyAgainstStandard({
        copy,
        standardChunks: standard.map((c) => c.content),
        dna,
      })
    : null;

  return (
    <PlatinaPage
      eyebrow="Platina · Admin"
      title="Claims and terminology"
      description="Deterministic screening runs first — a deterministic failure stays a failure regardless of any model opinion. The drift pass then compares copy with the approved standard and cites exact lines."
    >
      <PlatinaFormError message={searchParams.error} />

      <section aria-label="Rules" className="mb-8">
        <h2 className="font-display text-lg font-medium">Rules</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {source === "workspace"
            ? `${rules.length} active workspace rules.`
            : "Default rule lists are in effect — approve workspace rules below to replace them."}
        </p>
        {allRules.length > 0 && (
          <ul className="mt-3 space-y-1">
            {allRules.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm"
              >
                <span>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {r.kind === "banned_term" ? "banned" : "regulated"}
                  </span>{" "}
                  {r.term}
                  {!r.active && (
                    <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                      archived
                    </span>
                  )}
                </span>
                {r.active && (
                  <form action={archiveClaimsRuleAction}>
                    <input type="hidden" name="workspaceId" value={params.ws} />
                    <input type="hidden" name="ruleId" value={r.id} />
                    <button
                      type="submit"
                      className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      Archive
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        <form
          action={addClaimsRuleAction}
          className="mt-3 flex flex-wrap gap-2 rounded-lg border border-border bg-card p-3"
        >
          <input type="hidden" name="workspaceId" value={params.ws} />
          <select
            name="kind"
            className="rounded-md border border-input bg-background px-2 py-1.5 text-xs"
          >
            <option value="banned_term">Banned term</option>
            <option value="regulated_claim">Regulated claim</option>
          </select>
          <input
            name="term"
            required
            placeholder="e.g. guaranteed"
            className="min-w-48 flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-xs"
          />
          <input
            name="note"
            placeholder="Note (optional)"
            className="min-w-40 flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-xs"
          />
          <button
            type="submit"
            className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground"
          >
            Approve rule
          </button>
        </form>
      </section>

      <section aria-label="Audit copy">
        <h2 className="font-display text-lg font-medium">
          Audit copy against the standard
        </h2>
        <form className="mt-3 rounded-lg border border-border bg-card p-4" method="GET">
          <textarea
            name="copy"
            defaultValue={copy}
            rows={5}
            placeholder="Paste marketing copy"
            className="w-full rounded-md border border-input bg-background p-3 text-sm"
          />
          <button
            type="submit"
            className="mt-3 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
          >
            Screen and audit
          </button>
        </form>

        {audit && (
          <div className="mt-4 space-y-3">
            <div className="rounded-lg border border-border bg-card p-4 text-sm">
              <p className="font-medium">
                Claims:{" "}
                {audit.claims.verdict === "passed"
                  ? "passed"
                  : "flagged (deterministic)"}
              </p>
              {audit.claims.violations.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {audit.claims.violations.map((v, i) => (
                    <li key={i}>
                      <span className="font-mono text-xs">{v.rule}</span> —{" "}
                      {v.why}
                      <span className="text-muted-foreground">
                        {" "}
                        · “{v.excerpt}”
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-lg border border-border bg-card p-4 text-sm">
              <p className="font-medium">
                Drift:{" "}
                {audit.drift.state === "not_run"
                  ? "not run (no approved standard on record, or the model was unavailable — the claims verdict above stands)"
                  : audit.drift.state === "clean"
                    ? "none — the copy conforms to the standard"
                    : `${audit.drift.mismatches.length} exact mismatch(es)`}
              </p>
              {audit.drift.state === "drifted" && (
                <>
                  <ul className="mt-2 space-y-2">
                    {audit.drift.mismatches.map((m, i) => (
                      <li key={i} className="rounded-md bg-secondary p-2 text-xs">
                        <p>{m.why}</p>
                        <p className="mt-1 text-muted-foreground">
                          copy: “{m.copyExcerpt}” · standard: “
                        {m.standardLine}”
                        </p>
                      </li>
                    ))}
                  </ul>
                  <form action={recordDriftFindingAction} className="mt-3">
                    <input type="hidden" name="workspaceId" value={params.ws} />
                    <input type="hidden" name="copy" value={copy} />
                    <button
                      type="submit"
                      className="rounded-md border border-border px-3 py-1.5 text-xs"
                    >
                      Record as a drift finding
                    </button>
                  </form>
                </>
              )}
            </div>
          </div>
        )}
      </section>
    </PlatinaPage>
  );
}
