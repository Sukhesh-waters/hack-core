import Link from "next/link";
import { PlatinaFormError } from "@/components/platina/form-error";
import { PlatinaPage } from "@/components/platina/page";
import { listBrainChunks, listFindings } from "@/db/queries/platina";
import { ruleFindingAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Platina findings" };

const STATUS_LABEL: Record<string, string> = {
  new: "New",
  needs_decision: "Needs your decision",
  validated: "Validated",
  refuted: "Ruled out",
};

const SEVERITY_LABEL: Record<string, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

/**
 * Governed findings from the validation pass, with the derived-hypothesis
 * store below as provenance. Technical identifiers live in the expandable
 * panel per the copy glossary.
 */
export default async function FindingsPage({
  params,
  searchParams,
}: {
  params: { ws: string };
  searchParams: { error?: string };
}) {
  const [findings, hypotheses] = await Promise.all([
    listFindings(params.ws),
    listBrainChunks(params.ws),
  ]);
  const chunkById = new Map(hypotheses.map((c) => [c.id, c]));

  return (
    <PlatinaPage
      eyebrow="Platina · Findings"
      title="Findings"
      description="Market changes Platina detected and validated. Contested changes wait for your ruling — a hypothesis never becomes a finding without surviving validation."
    >
      <PlatinaFormError message={searchParams.error} />

      {findings.length === 0 ? (
        <div className="rounded-lg border border-border bg-secondary p-5 text-sm text-secondary-foreground">
          No findings yet. They appear after an approved audit detects a change
          and the validation pass resolves it. Define a source in Audits to
          begin.
        </div>
      ) : (
        <ul className="space-y-3">
          {findings.map((f) => {
            const linked = f.brainChunkId
              ? chunkById.get(f.brainChunkId)
              : undefined;
            return (
              <li
                key={f.id}
                className="rounded-lg border border-border bg-card p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium">{f.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {f.summary}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="rounded bg-secondary px-2 py-0.5 font-mono text-[11px] text-secondary-foreground">
                      {SEVERITY_LABEL[f.severity] ?? f.severity}
                    </span>
                    <span
                      className={
                        f.status === "needs_decision"
                          ? "rounded bg-destructive/10 px-2 py-0.5 font-mono text-[11px] text-destructive"
                          : "rounded bg-accent px-2 py-0.5 font-mono text-[11px] text-accent-foreground"
                      }
                    >
                      {STATUS_LABEL[f.status] ?? f.status}
                    </span>
                  </div>
                </div>

                {f.strongestObjection ? (
                  <p className="mt-2 border-l-2 border-border pl-3 text-sm text-muted-foreground">
                    Strongest objection: {f.strongestObjection}
                  </p>
                ) : null}

                {f.humanRuling ? (
                  <p className="mt-2 text-sm">
                    <span className="font-medium">Ruling:</span> {f.humanRuling}
                  </p>
                ) : null}

                {f.status === "needs_decision" && (
                  <form
                    action={ruleFindingAction}
                    className="mt-3 space-y-2 rounded-md bg-secondary p-3"
                  >
                    <input type="hidden" name="workspaceId" value={params.ws} />
                    <input type="hidden" name="findingId" value={f.id} />
                    <input
                      name="ruling"
                      required
                      placeholder="Why — this note is the audit trail"
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        name="verdict"
                        value="validated"
                        className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground"
                      >
                        Validate
                      </button>
                      <button
                        type="submit"
                        name="verdict"
                        value="refuted"
                        className="rounded-md border border-border px-3 py-1.5 text-xs"
                      >
                        Rule out
                      </button>
                    </div>
                  </form>
                )}

                {(f.status === "new" || f.status === "validated") && (
                  <div className="mt-3">
                    <Link
                      href={`/p/${params.ws}/solutions/new?findingId=${f.id}`}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      Draft a solution from this finding →
                    </Link>
                  </div>
                )}

                <details className="mt-2">
                  <summary className="cursor-pointer font-mono text-[11px] text-muted-foreground">
                    Technical provenance
                  </summary>
                  <dl className="mt-2 grid grid-cols-2 gap-2 rounded-md bg-secondary p-3 font-mono text-[11px] text-secondary-foreground md:grid-cols-4">
                    <div>
                      <dt className="uppercase">signal</dt>
                      <dd className="truncate">{f.signalDocumentId ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="uppercase">transcript</dt>
                      <dd className="truncate">{f.transcriptId ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="uppercase">hypothesis</dt>
                      <dd className="truncate">{f.brainChunkId ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="uppercase">confidence</dt>
                      <dd>{linked ? linked.confidence.toFixed(2) : "—"}</dd>
                    </div>
                  </dl>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </PlatinaPage>
  );
}
