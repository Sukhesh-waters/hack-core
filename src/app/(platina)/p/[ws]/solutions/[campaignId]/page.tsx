import Link from "next/link";
import { notFound } from "next/navigation";
import { PlatinaFormError } from "@/components/platina/form-error";
import { PlatinaPage } from "@/components/platina/page";
import { listWorkspaceMembers } from "@/db/queries/memberships";
import {
  getCampaign,
  getReceipt,
  hasClaimsException,
  listActiveClaimsRules,
  listGateEventsForSubject,
  listSolutionTasks,
} from "@/db/queries/platina";
import { claimsDnaFromRules, claimsGate } from "@/lib/platina/claims-gate";
import { readinessFor } from "@/lib/platina/readiness";
import {
  BOARD_COLUMN_LABEL,
  BOARD_COLUMNS,
  blockersFor,
  type BoardStatus,
} from "@/lib/platina/tasks";
import {
  addTaskAction,
  claimsExceptionAction,
  materializeEventTasksAction,
  moveTaskAction,
  publishCampaignAction,
} from "../../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Platina — solution" };

const TABS = [
  { key: "summary", label: "Summary" },
  { key: "board", label: "Work board" },
  { key: "calendar", label: "Calendar" },
  { key: "claims", label: "Claims" },
  { key: "history", label: "Decision history" },
  { key: "export", label: "Export" },
] as const;

const GATE_LABEL: Record<string, string> = {
  declare: "Brand standard confirmed",
  confirm: "Audit scope approved",
  approve: "Direction approved",
  publish: "Ready for external execution",
};

export default async function SolutionDetailPage({
  params,
  searchParams,
}: {
  params: { ws: string; campaignId: string };
  searchParams: { tab?: string; error?: string };
}) {
  const { ws, campaignId } = params;
  const campaign = await getCampaign(ws, campaignId);
  if (!campaign) notFound();

  const [receipt, tasks, members, claimsException, gateEvents, rules] =
    await Promise.all([
      campaign.receiptId
        ? getReceipt(ws, campaign.receiptId)
        : Promise.resolve(null),
      listSolutionTasks(ws, campaignId),
      listWorkspaceMembers(ws),
      hasClaimsException(ws, campaignId),
      listGateEventsForSubject(ws, campaignId),
      listActiveClaimsRules(ws),
    ]);
  const receiptEvents = receipt
    ? await listGateEventsForSubject(ws, receipt.id)
    : [];
  const allEvents = [...gateEvents, ...receiptEvents].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );

  const claims = claimsGate({
    contentPlan: campaign.contentPlan,
    taskTitles: tasks.map((t) => t.title),
    hasException: claimsException,
    dna: claimsDnaFromRules(rules).dna,
  });
  const blockers = blockersFor(tasks);
  const readiness = readinessFor(
    {
      eventAnchor: campaign.eventAnchor,
      eventLabel: campaign.eventLabel,
      tasks,
    },
    new Date(),
  );
  const tab = TABS.find((t) => t.key === searchParams.tab)?.key ?? "summary";
  const tabHref = (key: string) =>
    `/p/${ws}/solutions/${campaignId}?tab=${key}`;

  return (
    <PlatinaPage
      eyebrow="Platina · Solutions"
      title={campaign.title}
      description={receipt ? `Hypothesis: ${receipt.hypothesis}` : undefined}
    >
      <PlatinaFormError message={searchParams.error} />

      <nav className="mb-6 flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={tabHref(t.key)}
            className={
              t.key === tab
                ? "rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground"
                : "rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent/60"
            }
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "summary" && (
        <section aria-label="Summary" className="space-y-4">
          <dl className="grid gap-3 rounded-lg border border-border bg-card p-4 text-sm md:grid-cols-2">
            <div>
              <dt className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Expected outcome
              </dt>
              <dd>{receipt?.expectedOutcome ?? "—"}</dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Measurement
              </dt>
              <dd>{receipt?.measurementMethod ?? "—"}</dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Strongest uncertainty
              </dt>
              <dd>{receipt?.strongestUncertainty ?? "—"}</dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Review due
              </dt>
              <dd className="font-mono">
                {receipt ? receipt.reviewAt.toISOString().slice(0, 10) : "—"}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Event anchor
              </dt>
              <dd>
                {campaign.eventAnchor
                  ? `${campaign.eventLabel ?? "Event"} — ${campaign.eventAnchor.toISOString().slice(0, 10)}`
                  : "None"}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Status
              </dt>
              <dd>{campaign.status}</dd>
            </div>
          </dl>

          <section
            aria-label="Event readiness"
            className="rounded-lg border border-border bg-card p-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Event readiness
              </h2>
              {readiness.hasAnchor && (
                <span className="font-mono text-[11px] text-muted-foreground">
                  {readiness.postEvent
                    ? "event passed"
                    : `${readiness.daysToEvent} days to event`}
                </span>
              )}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {readiness.phases.map((p) => (
                <div
                  key={p.phase}
                  className="rounded-md bg-secondary p-3 text-center"
                >
                  <p className="font-mono text-[10px] uppercase text-secondary-foreground">
                    {p.phase === "pre"
                      ? "Pre-event"
                      : p.phase === "at"
                        ? "At event"
                        : "Post-event"}
                  </p>
                  <p className="mt-1 font-display text-lg">
                    {p.done}/{p.total}
                  </p>
                </div>
              ))}
            </div>
            {readiness.gaps.length > 0 ? (
              <ul className="mt-3 list-inside list-disc text-sm text-muted-foreground">
                {readiness.gaps.map((gap) => (
                  <li key={gap}>{gap}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                No readiness gaps — every phase has planned work and nothing is
                overdue.
              </p>
            )}
          </section>

          {campaign.status === "draft" && (
            <div className="rounded-lg border border-border bg-card p-4">
              {blockers.blocked || claims.blocksApproval ? (
                <div className="text-sm">
                  <p className="font-medium">Final approval is blocked</p>
                  <ul className="mt-1 list-inside list-disc text-muted-foreground">
                    {blockers.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                    {claims.blocksApproval && (
                      <li>
                        Claims review flags this solution — resolve on the
                        Claims tab or record a named exception.
                      </li>
                    )}
                  </ul>
                </div>
              ) : (
                <form action={publishCampaignAction}>
                  <input type="hidden" name="workspaceId" value={ws} />
                  <input type="hidden" name="campaignId" value={campaignId} />
                  <button
                    type="submit"
                    className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
                  >
                    Approve — ready for external execution
                  </button>
                </form>
              )}
            </div>
          )}
        </section>
      )}

      {tab === "board" && (
        <section aria-label="Work board">
          <form
            action={addTaskAction}
            className="mb-4 flex flex-wrap gap-2 rounded-lg border border-border bg-card p-3"
          >
            <input type="hidden" name="workspaceId" value={ws} />
            <input type="hidden" name="campaignId" value={campaignId} />
            <input
              name="title"
              required
              placeholder="New task"
              className="min-w-48 flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-xs"
            />
            <select
              name="assigneeId"
              className="rounded-md border border-input bg-background px-2 py-1.5 text-xs"
            >
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name ?? m.email}
                </option>
              ))}
            </select>
            <input
              name="dueDate"
              type="date"
              className="rounded-md border border-input bg-background px-2 py-1.5 text-xs"
            />
            <select
              name="eventPhase"
              className="rounded-md border border-input bg-background px-2 py-1.5 text-xs"
            >
              <option value="">No phase</option>
              <option value="pre">Pre-event</option>
              <option value="at">At event</option>
              <option value="post">Post-event</option>
            </select>
            <button
              type="submit"
              className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground"
            >
              Add task
            </button>
          </form>

          {campaign.eventAnchor && (
            <form action={materializeEventTasksAction} className="mb-4">
              <input type="hidden" name="workspaceId" value={ws} />
              <input type="hidden" name="campaignId" value={campaignId} />
              <button
                type="submit"
                className="rounded-md border border-border px-3 py-1.5 text-xs"
              >
                Materialize pre/at/post event tasks
              </button>
            </form>
          )}

          <div className="grid gap-3 md:grid-cols-5">
            {BOARD_COLUMNS.map((column) => {
              const columnTasks = tasks.filter((t) => t.status === column);
              return (
                <div
                  key={column}
                  className="rounded-lg border border-border bg-secondary/50 p-2"
                >
                  <p className="px-1 pb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {BOARD_COLUMN_LABEL[column]} ({columnTasks.length})
                  </p>
                  <div className="space-y-2">
                    {columnTasks.map((t) => (
                      <div
                        key={t.id}
                        className="rounded-md border border-border bg-card p-2 text-xs"
                      >
                        <p className="font-medium">{t.title}</p>
                        <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                          {t.assigneeId
                            ? (members.find((m) => m.userId === t.assigneeId)
                                ?.name ?? "assigned")
                            : "unassigned"}
                          {t.dueDate
                            ? ` · ${new Date(t.dueDate).toISOString().slice(0, 10)}`
                            : ""}
                          {t.eventPhase ? ` · ${t.eventPhase}` : ""}
                          {t.claimsBlocked ? " · claims" : ""}
                        </p>
                        <div className="mt-1.5 flex gap-1">
                          {BOARD_COLUMNS.filter((c) => c !== column).map(
                            (target) => (
                              <form key={target} action={moveTaskAction}>
                                <input
                                  type="hidden"
                                  name="workspaceId"
                                  value={ws}
                                />
                                <input
                                  type="hidden"
                                  name="campaignId"
                                  value={campaignId}
                                />
                                <input
                                  type="hidden"
                                  name="taskId"
                                  value={t.id}
                                />
                                <input
                                  type="hidden"
                                  name="status"
                                  value={target}
                                />
                                <button
                                  type="submit"
                                  className="rounded border border-border px-1 font-mono text-[9px] text-muted-foreground hover:bg-accent"
                                  title={`Move to ${BOARD_COLUMN_LABEL[target]}`}
                                >
                                  {BOARD_COLUMN_LABEL[target]
                                    .slice(0, 2)
                                    .toLowerCase()}
                                </button>
                              </form>
                            ),
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {tab === "calendar" && (
        <section aria-label="Calendar">
          {campaign.eventAnchor ? (
            <div className="space-y-4">
              <p className="rounded-lg border border-border bg-accent/40 px-4 py-3 text-sm">
                <span className="font-medium">
                  {campaign.eventLabel ?? "Event"}
                </span>{" "}
                — {campaign.eventAnchor.toISOString().slice(0, 10)}
              </p>
              {(["pre", "at", "post"] as const).map((phase) => {
                const phaseTasks = tasks
                  .filter((t) => t.eventPhase === phase)
                  .sort(
                    (a, b) =>
                      new Date(a.dueDate ?? 0).getTime() -
                      new Date(b.dueDate ?? 0).getTime(),
                  );
                return (
                  <div key={phase}>
                    <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {phase === "pre"
                        ? "Pre-event"
                        : phase === "at"
                          ? "At event"
                          : "Post-event"}
                    </h3>
                    {phaseTasks.length === 0 ? (
                      <p className="mt-1 text-sm text-muted-foreground">
                        No {phase}-event tasks.
                      </p>
                    ) : (
                      <ul className="mt-1 space-y-1">
                        {phaseTasks.map((t) => (
                          <li
                            key={t.id}
                            className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm"
                          >
                            <span>{t.title}</span>
                            <span className="font-mono text-[11px] text-muted-foreground">
                              {t.dueDate
                                ? new Date(t.dueDate).toISOString().slice(0, 10)
                                : "no date"}{" "}
                              · {BOARD_COLUMN_LABEL[t.status as BoardStatus]}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-secondary p-5 text-sm text-secondary-foreground">
              No event anchor on this solution. Set one by editing the plan,
              then materialize the pre/at/post task template from the Work
              board.
            </div>
          )}
        </section>
      )}

      {tab === "claims" && (
        <section aria-label="Claims">
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="font-medium">
              {claims.verdict === "passed"
                ? "Passed deterministic claims screening"
                : "Flagged by deterministic claims screening"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {claimsDnaFromRules(rules).source === "workspace"
                ? "Screened against this workspace's approved rules."
                : "Default rule lists are in effect — approve workspace rules in Admin to replace them."}{" "}
              A deterministic failure stays a failure regardless of any model
              opinion.
            </p>
            {claims.violations.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm">
                {claims.violations.map((v, i) => (
                  <li key={i}>
                    <span className="font-mono text-xs">{v.rule}</span> —{" "}
                    {v.why}
                    <span className="text-muted-foreground"> · “{v.excerpt}”</span>
                  </li>
                ))}
              </ul>
            )}
            {claims.excepted && (
              <p className="mt-3 rounded-md bg-accent px-3 py-2 text-xs text-accent-foreground">
                A named-approver exception is recorded for this solution. The
                violations above remain visible.
              </p>
            )}
            {claims.blocksApproval && campaign.status === "draft" && (
              <form action={claimsExceptionAction} className="mt-4 space-y-2">
                <input type="hidden" name="workspaceId" value={ws} />
                <input type="hidden" name="campaignId" value={campaignId} />
                <input
                  name="reason"
                  required
                  placeholder="Exception reason — recorded immutably with your name"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
                <button
                  type="submit"
                  className="rounded-md border border-destructive/40 px-3 py-1.5 text-xs text-destructive"
                >
                  Record claims exception
                </button>
              </form>
            )}
          </div>
        </section>
      )}

      {tab === "history" && (
        <section aria-label="Decision history">
          {allEvents.length === 0 ? (
            <p className="rounded-lg border border-border bg-secondary p-5 text-sm text-secondary-foreground">
              No decisions recorded yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {allEvents.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-2.5 text-sm"
                >
                  <span>
                    {e.subjectType === "claims_exception"
                      ? "Claims exception"
                      : (GATE_LABEL[e.gate] ?? e.gate)}
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {e.decision} · {e.createdAt.toISOString().slice(0, 10)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {receipt && (
            <p className="mt-4 font-mono text-[11px] text-muted-foreground">
              Receipt {receipt.id} · outcome {receipt.outcome}
            </p>
          )}
        </section>
      )}

      {tab === "export" && (
        <section aria-label="Export">
          <div className="rounded-lg border border-border bg-card p-5">
            <p className="text-sm">
              The action packet is the approved solution in a portable form —
              printable view for browser Save-as-PDF, and the versioned JSON
              for systems. Provenance is by identifier; raw public snapshots
              never leave Platina.
            </p>
            <div className="mt-4 flex gap-2">
              <Link
                href={`/p/${ws}/solutions/${campaignId}/export`}
                className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
              >
                Open printable packet
              </Link>
              <a
                href={`/p/${ws}/solutions/${campaignId}/packet.json`}
                className="rounded-md border border-border px-4 py-2 text-sm"
              >
                Download JSON
              </a>
            </div>
          </div>
        </section>
      )}
    </PlatinaPage>
  );
}
