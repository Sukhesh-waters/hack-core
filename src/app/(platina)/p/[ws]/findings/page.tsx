import Link from "next/link";
import { PlatinaFormError } from "@/components/platina/form-error";
import { PlatinaPage } from "@/components/platina/page";
import {
  listBrainChunks,
  listDebateTranscripts,
  listFindings,
} from "@/db/queries/platina";
import {
  FINDING_TRANSITIONS,
  FINDING_VERDICT_LABEL,
  type FindingStatus,
  type FindingVerdict,
} from "@/lib/platina/findings";
import {
  OBJECTION_RATE_CEILING,
  objectionRate,
} from "@/lib/platina/objection-rate";
import { reviewFindingAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Platina findings" };

const STATUS_LABEL: Record<string, string> = {
  new: "New",
  needs_decision: "Needs your decision",
  validated: "Validated",
  refuted: "Ruled out",
  dismissed: "Dismissed",
  superseded: "Superseded",
};

const SEVERITY_LABEL: Record<string, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

const TABS: { key: string; label: string; statuses: FindingStatus[] }[] = [
  { key: "all", label: "All", statuses: [] },
  { key: "needs_decision", label: "Needs decision", statuses: ["needs_decision"] },
  { key: "new", label: "New", statuses: ["new"] },
  { key: "validated", label: "Validated", statuses: ["validated"] },
  {
    key: "history",
    label: "History",
    statuses: ["refuted", "dismissed", "superseded"],
  },
];

export default async function FindingsPage({
  params,
  searchParams,
}: {
  params: { ws: string };
  searchParams: { error?: string; status?: string; useCase?: string };
}) {
  const [findings, hypotheses, transcripts] = await Promise.all([
    listFindings(params.ws),
    listBrainChunks(params.ws),
    listDebateTranscripts(params.ws, 20),
  ]);
  const chunkById = new Map(hypotheses.map((c) => [c.id, c]));
  const activeTab = TABS.find((t) => t.key === searchParams.status) ?? TABS[0];
  const useCase = searchParams.useCase ?? "";
  const useCaseFiltered = useCase
    ? findings.filter((f) => f.useCase === useCase)
    : findings;
  const visible =
    activeTab.key === "all"
      ? useCaseFiltered
      : useCaseFiltered.filter((f) =>
          activeTab.statuses.includes(f.status as FindingStatus),
        );

  const rate = objectionRate(transcripts.map((t) => ({ state: t.state })));
  const elevated =
    transcripts.length >= 10 && rate >= OBJECTION_RATE_CEILING;

  return (
    <PlatinaPage
      eyebrow="Platina · Findings"
      title="Findings"
      description="Market changes Platina detected and validated. Contested changes wait for your ruling — a hypothesis never becomes a finding without surviving validation."
    >
      <PlatinaFormError message={searchParams.error} />

      <section
        aria-label="Validation health"
        className="mb-6 flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3"
      >
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Validation health
          </p>
          <p className="mt-0.5 text-sm">
            {transcripts.length === 0
              ? "No validation rounds yet."
              : `${Math.round(rate * 100)}% of the last ${transcripts.length} rounds contested or refuted`}
          </p>
        </div>
        <span
          className={
            elevated
              ? "rounded bg-destructive/10 px-2 py-0.5 font-mono text-[11px] text-destructive"
              : "rounded bg-accent px-2 py-0.5 font-mono text-[11px] text-accent-foreground"
          }
        >
          {elevated
            ? `above the ${OBJECTION_RATE_CEILING * 100}% ceiling`
            : `ceiling ${OBJECTION_RATE_CEILING * 100}%`}
        </span>
      </section>

      <nav className="mb-4 flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card p-1">
        {TABS.map((tab) => {
          const count =
            tab.key === "all"
              ? useCaseFiltered.length
              : useCaseFiltered.filter((f) =>
                  tab.statuses.includes(f.status as FindingStatus),
                ).length;
          return (
            <Link
              key={tab.key}
              href={`/p/${params.ws}/findings?status=${tab.key}${useCase ? `&useCase=${useCase}` : ""}`}
              className={
                tab.key === activeTab.key
                  ? "rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground"
                  : "rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent/60"
              }
            >
              {tab.label} ({count})
            </Link>
          );
        })}
        <form method="GET" className="ml-auto flex items-center gap-1">
          <input type="hidden" name="status" value={activeTab.key} />
          <select
            name="useCase"
            defaultValue={useCase}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-xs"
          >
            <option value="">All use cases</option>
            <option value="competitor_change">Competitor / market</option>
            <option value="event_readiness">Event readiness</option>
            <option value="operational">Operational</option>
          </select>
          <button
            type="submit"
            className="rounded-md border border-border px-2 py-1.5 text-xs"
          >
            Filter
          </button>
        </form>
      </nav>

      {visible.length === 0 ? (
        <div className="rounded-lg border border-border bg-secondary p-5 text-sm text-secondary-foreground">
          {findings.length === 0
            ? "No findings yet. They appear after an approved audit detects a change and the validation pass resolves it. Define a source in Audits to begin."
            : `Nothing in "${activeTab.label}".`}
        </div>
      ) : (
        <ul className="space-y-3">
          {visible.map((f) => {
            const linked = f.brainChunkId
              ? chunkById.get(f.brainChunkId)
              : undefined;
            const actions = (
              FINDING_TRANSITIONS[f.status as FindingStatus] ?? []
            ).filter((to): to is FindingVerdict =>
              ["validated", "refuted", "dismissed", "superseded"].includes(to),
            );
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
                    <span className="font-medium">Review note:</span>{" "}
                    {f.humanRuling}
                  </p>
                ) : null}

                {actions.length > 0 && (
                  <form
                    action={reviewFindingAction}
                    className="mt-3 space-y-2 rounded-md bg-secondary p-3"
                  >
                    <input type="hidden" name="workspaceId" value={params.ws} />
                    <input type="hidden" name="findingId" value={f.id} />
                    <input
                      name="ruling"
                      required
                      placeholder="Review note — this is the audit trail"
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                    <div className="flex gap-2">
                      {actions.map((verdict) => (
                        <button
                          key={verdict}
                          type="submit"
                          name="verdict"
                          value={verdict}
                          className={
                            verdict === "validated"
                              ? "rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground"
                              : "rounded-md border border-border px-3 py-1.5 text-xs"
                          }
                        >
                          {FINDING_VERDICT_LABEL[verdict]}
                        </button>
                      ))}
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
