"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { GlassCard } from "@/components/glass-card";
import { Badge } from "@/components/ui/badge";
import { StatusMenu, type TransitionOption } from "@/components/transition-menu";
import { cn } from "@/lib/utils";
import type { HubMessage, HubPriority, TeamHubData } from "@/lib/data/types";
import {
  HUB_TASK_STATUS_CHIP_CLASSES,
  HUB_TASK_STATUS_LABELS,
  hubTaskStatusFromDone,
  nextHubTaskStatusesFrom,
  type HubTaskStatus,
} from "@/lib/hub-workflow";
import {
  archiveTaskAction,
  createReminder,
  createTask,
  decideApproval,
  decidePlanIdea,
  editTaskTitleAction,
  fetchHubState,
  reopenTaskAction,
  requestHubApproval,
  sendHubMessage,
  setHubTaskStatus,
  setTaskPriority,
  type HubActionResult,
} from "./actions";
import { useHubRealtime } from "./use-hub-realtime";

const PRIORITY_STYLES: Record<HubPriority, string> = {
  High: "border-destructive/40 text-destructive",
  Medium: "border-brand-purple/40 text-brand-purple",
  Low: "border-border text-muted-foreground/70",
};

/** UI priority → next priority to request (lower-case DB enum). */
const NEXT_PRIORITY: Record<HubPriority, "high" | "medium" | "low"> = {
  High: "medium",
  Medium: "low",
  Low: "high",
};

export function TeamHubCanvas({
  initial,
  workspaceId,
  me,
}: {
  initial: TeamHubData;
  workspaceId: string;
  me: { id: string; name: string };
}) {
  const [data, setData] = useState(initial);
  const [draft, setDraft] = useState("");
  const [taskDraft, setTaskDraft] = useState("");
  const [reminderDraft, setReminderDraft] = useState("");
  const [reminderDue, setReminderDue] = useState("");
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Plan accept now generates a real AI draft (multi-second) instead of a
  // bare status flip — without this, a second click before the first
  // resolves double-generates the draft (idea.status hasn't updated yet).
  const [decidingIdeaId, setDecidingIdeaId] = useState<string | null>(null);
  // Every action trigger below keys into this set while its server
  // round-trip is in flight, so each button (not just Plan accept/reject)
  // can show a busy state instead of looking dead. Keyed rather than a
  // single boolean so e.g. approving one item doesn't grey out every other
  // control on the screen.
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

  const isBusy = useCallback(
    (key: string) => busyKeys.has(key),
    [busyKeys],
  );

  const apply = useCallback((res: HubActionResult) => {
    if (res.data) {
      setError(null);
      setData(res.data);
    } else {
      setError(res.error ?? "Something went wrong.");
    }
  }, []);

  /** Marks `key` busy for the duration of `fn`, then applies its result. */
  const runAction = useCallback(
    (key: string, fn: () => Promise<HubActionResult>) => {
      setBusyKeys((prev) => new Set(prev).add(key));
      startTransition(async () => {
        try {
          apply(await fn());
        } finally {
          setBusyKeys((prev) => {
            const next = new Set(prev);
            next.delete(key);
            return next;
          });
        }
      });
    },
    [apply],
  );

  const refresh = useCallback(() => {
    startTransition(async () => {
      const res = await fetchHubState(workspaceId);
      // Silent refresh: keep the screen if a poll hiccups
      if (res.data) setData(res.data);
    });
  }, [workspaceId]);

  const { onlineIds } = useHubRealtime({
    workspaceId,
    userId: me.id,
    onSignal: () => refresh(),
  });

  // Degradation ladder: 30s poll covers missed signals / Realtime outages.
  useEffect(() => {
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [data.messages]);

  const sendMessage = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    // Optimistic echo, reconciled by the returned state
    setData((d) => ({
      ...d,
      messages: [
        ...d.messages,
        {
          id: `tmp-${Date.now()}`,
          kind: "text",
          time: "just now",
          author: me.name,
          initial: (me.name[0] ?? "Y").toUpperCase(),
          text,
        },
      ],
    }));
    runAction("message", () => sendHubMessage(workspaceId, text));
  };

  const requestApproval = () => {
    const title = draft.trim() || "Untitled asset";
    setDraft("");
    runAction("approval-request", () =>
      requestHubApproval(workspaceId, title),
    );
  };

  const decide = (approvalId: string, decision: "approved" | "rejected") =>
    runAction(`approval:${approvalId}`, () =>
      decideApproval(workspaceId, approvalId, decision),
    );

  const addTask = () => {
    const title = taskDraft.trim();
    if (!title) return;
    setTaskDraft("");
    runAction("add-task", () => createTask(workspaceId, title));
  };

  const changeTaskStatus = (
    id: string,
    from: HubTaskStatus,
    to: HubTaskStatus,
  ) =>
    runAction(`task-status:${id}`, () =>
      setHubTaskStatus(workspaceId, id, from, to),
    );

  const cyclePriority = (id: string, current: HubPriority) =>
    runAction(`task-priority:${id}`, () =>
      setTaskPriority(workspaceId, id, NEXT_PRIORITY[current]),
    );

  const saveTaskTitle = (id: string) => {
    const title = editingTitle.trim();
    setEditingTaskId(null);
    if (!title) return;
    runAction(`task-edit:${id}`, () =>
      editTaskTitleAction(workspaceId, id, title),
    );
  };

  const archiveTask = (id: string) =>
    runAction(`task-archive:${id}`, () =>
      archiveTaskAction(workspaceId, id),
    );

  const reopenTask = (id: string) =>
    runAction(`task-reopen:${id}`, () =>
      reopenTaskAction(workspaceId, id),
    );

  const decidePlan = (ideaId: string, decision: "accepted" | "rejected") => {
    if (decidingIdeaId) return; // already deciding one — ignore re-clicks
    setDecidingIdeaId(ideaId);
    startTransition(async () => {
      apply(await decidePlanIdea(workspaceId, ideaId, decision));
      setDecidingIdeaId(null);
    });
  };

  const addReminder = () => {
    const title = reminderDraft.trim();
    if (!title || !reminderDue) return;
    const iso = new Date(reminderDue).toISOString();
    setReminderDraft("");
    setReminderDue("");
    runAction("add-reminder", () => createReminder(workspaceId, title, iso));
  };

  const openTasks = data.tasks.filter((t) => !t.done).length;
  const pendingApprovals = data.approvals.filter(
    (a) => a.status === "pending",
  ).length;
  const onlineCount =
    data.members.filter((m) => onlineIds.has(m.id)).length || 1;

  return (
    <div className="space-y-3">
      {error && (
        <p
          className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      {/* ---- CHAT PANE ---- */}
      <GlassCard className="flex h-[640px] flex-col p-0">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <p className="text-sm font-medium">{data.channel}</p>
          <div className="flex items-center gap-2">
            <div className="flex -space-x-2">
              {data.members.map((mb) => (
                <div
                  key={mb.id}
                  title={mb.name}
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full border border-border bg-accent text-[11px]",
                    (onlineIds.has(mb.id) || mb.id === me.id) &&
                      "ring-1 ring-brand-teal",
                  )}
                >
                  {mb.initial}
                </div>
              ))}
            </div>
            <p className="label-mono text-[10px] text-brand-teal">
              {onlineCount} online
            </p>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-5">
          {data.messages.length === 0 && (
            <p className="label-mono text-center text-[10px] text-muted-foreground/50">
              Channel is live — say hello or request a sign-off.
            </p>
          )}
          {data.messages.map((m) => (
            <MessageRow key={m.id} m={m} onDecide={decide} isBusy={isBusy} />
          ))}
        </div>

        <div className="flex items-center gap-2 border-t border-border p-4">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            placeholder="Message the team — or type an asset name and request sign-off"
            className="flex-1 rounded-xl border border-border bg-muted px-4 py-2.5 text-sm outline-none placeholder:text-muted-foreground/50 focus:border-brand-teal/50 disabled:opacity-50"
            disabled={isBusy("message")}
          />
          <button
            onClick={requestApproval}
            disabled={isBusy("approval-request")}
            className="label-mono rounded-xl border border-brand-purple/40 px-3 py-2.5 text-[10px] text-brand-purple transition hover:bg-brand-purple/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isBusy("approval-request") ? "Requesting…" : "Approval"}
          </button>
          <button
            onClick={sendMessage}
            disabled={isBusy("message")}
            className="rounded-xl bg-accent px-4 py-2.5 text-sm transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isBusy("message") ? "Sending…" : "Send →"}
          </button>
        </div>
      </GlassCard>

      {/* ---- PINNED ACTION RAIL ---- */}
      <div className="space-y-4">
        <GlassCard className="p-4">
          <div className="flex items-center justify-between">
            <p className="label-mono text-brand-teal">Plan · Validate</p>
          </div>
          <div className="mt-3 space-y-2">
            {data.planQuickView.length === 0 && (
              <p className="text-xs text-muted-foreground/70">
                No proposed ideas yet — generate some in Ideation.
              </p>
            )}
            {data.planQuickView.map((it) => (
              <div
                key={it.id}
                className="flex items-center justify-between gap-2 rounded-xl bg-muted px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs">{it.title}</p>
                  <p className="text-[10px] text-muted-foreground/70">{it.format}</p>
                </div>
                {it.status === "proposed" ? (
                  <div className="flex shrink-0 gap-1">
                    <button
                      onClick={() => decidePlan(it.id, "accepted")}
                      disabled={decidingIdeaId !== null}
                      className="rounded-lg bg-accent px-2 py-1 text-xs text-brand-teal hover:bg-accent disabled:opacity-40"
                    >
                      {decidingIdeaId === it.id ? "…" : "✓"}
                    </button>
                    <button
                      onClick={() => decidePlan(it.id, "rejected")}
                      disabled={decidingIdeaId !== null}
                      className="rounded-lg bg-accent px-2 py-1 text-xs text-destructive hover:bg-accent disabled:opacity-40"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <Badge
                    variant="outline"
                    className="label-mono shrink-0 border-border text-[9px] text-muted-foreground/70"
                  >
                    {it.status}
                  </Badge>
                )}
              </div>
            ))}
          </div>
        </GlassCard>

        <GlassCard className="p-4">
          <div className="flex items-center justify-between">
            <p className="label-mono text-brand-purple">Approval queue</p>
            <p className="label-mono text-[10px] text-muted-foreground/70">
              {pendingApprovals} pending
            </p>
          </div>
          <div className="mt-3 space-y-2">
            {data.approvals.length === 0 && (
              <p className="text-xs text-muted-foreground/70">
                Queue clear — nothing waiting on sign-off.
              </p>
            )}
            {data.approvals.map((aq) => (
              <div key={aq.id} className="rounded-xl bg-muted px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-xs">{aq.title}</p>
                  <Badge
                    variant="outline"
                    className={cn(
                      "label-mono shrink-0 text-[9px]",
                      aq.status === "pending"
                        ? "border-brand-purple/40 text-brand-purple"
                        : aq.status === "approved"
                          ? "border-brand-teal/40 text-brand-teal"
                          : "border-destructive/40 text-destructive",
                    )}
                  >
                    {aq.status}
                  </Badge>
                </div>
                <p className="mt-0.5 text-[10px] text-muted-foreground/70">
                  {aq.requestedBy} · {aq.time}
                </p>
                {aq.status === "pending" && (
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => decide(aq.id, "approved")}
                      disabled={isBusy(`approval:${aq.id}`)}
                      className="label-mono rounded-lg bg-accent px-2 py-1 text-[10px] text-brand-teal hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {isBusy(`approval:${aq.id}`) ? "…" : "✓ Approve"}
                    </button>
                    <button
                      onClick={() => decide(aq.id, "rejected")}
                      disabled={isBusy(`approval:${aq.id}`)}
                      className="label-mono rounded-lg bg-accent px-2 py-1 text-[10px] text-destructive hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {isBusy(`approval:${aq.id}`) ? "…" : "✕ Reject"}
                    </button>
                  </div>
                )}
                {aq.status !== "pending" && aq.decidedBy && (
                  <p className="mt-1 text-[10px] text-muted-foreground/50">
                    {aq.status} by {aq.decidedBy}
                  </p>
                )}
              </div>
            ))}
          </div>
        </GlassCard>

        <GlassCard className="p-4">
          <div className="flex items-center justify-between">
            <p className="label-mono text-muted-foreground">Tasks & priorities</p>
            <p className="label-mono text-[10px] text-muted-foreground/70">
              {openTasks} open
            </p>
          </div>
          <div className="mt-3 space-y-2">
            {data.tasks.length === 0 && (
              <p className="text-xs text-muted-foreground/70">No open tasks.</p>
            )}
            {data.tasks.map((tk) => {
              const status = hubTaskStatusFromDone(tk.done);
              const options: TransitionOption<HubTaskStatus>[] =
                nextHubTaskStatusesFrom(status).map((opt) => ({
                  value: opt.status,
                  label: HUB_TASK_STATUS_LABELS[opt.status],
                  allowed: opt.allowed,
                  reason: opt.reason,
                  chipClass: HUB_TASK_STATUS_CHIP_CLASSES[opt.status],
                }));
              const isEditing = editingTaskId === tk.id;

              return (
                <div key={tk.id} className="flex items-center gap-2 group">
                  <StatusMenu
                    current={status}
                    currentLabel={HUB_TASK_STATUS_LABELS[status]}
                    currentChipClass={HUB_TASK_STATUS_CHIP_CLASSES[status]}
                    options={options}
                    onSelect={(to) => changeTaskStatus(tk.id, status, to)}
                    disabled={isBusy(`task-status:${tk.id}`)}
                    label={tk.title}
                  />
                  {isEditing ? (
                    <input
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveTaskTitle(tk.id);
                        if (e.key === "Escape") setEditingTaskId(null);
                      }}
                      onBlur={() => saveTaskTitle(tk.id)}
                      autoFocus
                      className="min-w-0 flex-1 rounded border border-border bg-muted px-2 py-0.5 text-xs outline-none focus:border-brand-teal/50"
                    />
                  ) : (
                    <span
                      onClick={() => {
                        setEditingTaskId(tk.id);
                        setEditingTitle(tk.title);
                      }}
                      title="Click to edit title"
                      className={cn(
                        "flex-1 truncate text-xs cursor-pointer hover:underline",
                        tk.done && "text-muted-foreground/50 line-through",
                      )}
                    >
                      {tk.title}
                    </span>
                  )}
                  {tk.sopOrigin ? (
                    <Link
                      href={`/w/${workspaceId}/sop/runs/${tk.sopOrigin.runId}`}
                      title={`Linked to SOP step: ${tk.sopOrigin.stepTitle}`}
                      className="shrink-0"
                    >
                      <Badge
                        variant="outline"
                        className="text-[9px] px-1.5 py-0 border-brand-teal/40 text-brand-teal hover:bg-brand-teal/10"
                      >
                        SOP: {tk.sopOrigin.stepTitle}
                      </Badge>
                    </Link>
                  ) : null}
                  <button
                    onClick={() => cyclePriority(tk.id, tk.priority)}
                    disabled={isBusy(`task-priority:${tk.id}`)}
                    title="Click to change priority"
                    className={cn(
                      "label-mono shrink-0 rounded-md border px-1.5 py-0.5 text-[9px] disabled:cursor-not-allowed disabled:opacity-50",
                      PRIORITY_STYLES[tk.priority],
                    )}
                  >
                    {isBusy(`task-priority:${tk.id}`) ? "…" : tk.priority}
                  </button>
                  <button
                    onClick={() => archiveTask(tk.id)}
                    disabled={isBusy(`task-archive:${tk.id}`)}
                    title="Archive task"
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground/60 hover:text-destructive text-xs px-1"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex gap-2">
            <input
              value={taskDraft}
              onChange={(e) => setTaskDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addTask()}
              placeholder="Add a task…"
              disabled={isBusy("add-task")}
              className="min-w-0 flex-1 rounded-lg border border-border bg-muted px-3 py-1.5 text-xs outline-none placeholder:text-muted-foreground/50 focus:border-brand-teal/50 disabled:opacity-50"
            />
            <button
              onClick={addTask}
              disabled={isBusy("add-task")}
              className="label-mono rounded-lg bg-accent px-3 py-1.5 text-[10px] hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isBusy("add-task") ? "Adding…" : "Add"}
            </button>
          </div>

          {/* Collapsible Completed Tasks Lane (Last 7 days) */}
          {(data.completedTasks?.length ?? 0) > 0 && (
            <div className="mt-4 border-t border-border pt-3">
              <button
                onClick={() => setShowCompleted(!showCompleted)}
                className="label-mono flex items-center justify-between w-full text-[10px] text-muted-foreground/70 hover:text-foreground"
              >
                <span>Completed tasks (last 7 days)</span>
                <span>{showCompleted ? "▲" : `▼ (${data.completedTasks?.length})`}</span>
              </button>
              {showCompleted && (
                <div className="mt-2 space-y-1.5">
                  {data.completedTasks?.map((ct) => (
                    <div
                      key={ct.id}
                      className="flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        <span className="truncate text-muted-foreground/60 line-through">
                          {ct.title}
                        </span>
                        {ct.sopOrigin ? (
                          <Link
                            href={`/w/${workspaceId}/sop/runs/${ct.sopOrigin.runId}`}
                            title={`Linked to SOP step: ${ct.sopOrigin.stepTitle}`}
                            className="shrink-0"
                          >
                            <Badge
                              variant="outline"
                              className="text-[9px] px-1.5 py-0 border-brand-teal/30 text-brand-teal/70 hover:bg-brand-teal/10"
                            >
                              SOP
                            </Badge>
                          </Link>
                        ) : null}
                      </div>
                      <button
                        onClick={() => reopenTask(ct.id)}
                        disabled={isBusy(`task-reopen:${ct.id}`)}
                        className="label-mono shrink-0 text-[9px] text-brand-teal hover:underline"
                      >
                        Reopen
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </GlassCard>

        <GlassCard className="p-4">
          <p className="label-mono text-muted-foreground">Shared reminders</p>
          <div className="mt-3 space-y-2">
            {data.reminders.length === 0 && (
              <p className="text-xs text-muted-foreground/70">No reminders yet.</p>
            )}
            {data.reminders.map((r) => (
              <div key={r.id} className="rounded-xl bg-muted px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs">{r.title}</p>
                  {r.overdue && (
                    <span className="label-mono shrink-0 rounded-full bg-destructive/15 px-2 py-0.5 text-[9px] text-destructive">
                      Overdue
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[10px] text-muted-foreground/70">
                  {r.due} · {r.owner}
                  {r.sentLabel && ` · ${r.sentLabel}`}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-3 space-y-2">
            <input
              value={reminderDraft}
              onChange={(e) => setReminderDraft(e.target.value)}
              placeholder="Add a shared reminder…"
              disabled={isBusy("add-reminder")}
              className="w-full rounded-lg border border-border bg-muted px-3 py-1.5 text-xs outline-none placeholder:text-muted-foreground/50 focus:border-brand-teal/50 disabled:opacity-50"
            />
            <div className="flex gap-2">
              <input
                type="datetime-local"
                value={reminderDue}
                onChange={(e) => setReminderDue(e.target.value)}
                disabled={isBusy("add-reminder")}
                className="min-w-0 flex-1 rounded-lg border border-border bg-muted px-3 py-1.5 text-xs text-muted-foreground outline-none focus:border-brand-teal/50 [color-scheme:dark] disabled:opacity-50"
              />
              <button
                onClick={addReminder}
                disabled={isBusy("add-reminder")}
                className="label-mono rounded-lg bg-accent px-3 py-1.5 text-[10px] hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isBusy("add-reminder") ? "Adding…" : "Add"}
              </button>
            </div>
          </div>
        </GlassCard>
      </div>
      </div>
    </div>
  );
}

function MessageRow({
  m,
  onDecide,
  isBusy,
}: {
  m: HubMessage;
  onDecide: (approvalId: string, decision: "approved" | "rejected") => void;
  isBusy: (key: string) => boolean;
}) {
  if (m.kind === "system") {
    return (
      <p className="label-mono text-center text-[10px] text-muted-foreground/50">
        {m.text}
      </p>
    );
  }

  return (
    <div className="flex gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-accent text-xs">
        {m.initial}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs">
          <span className="font-medium">{m.author}</span>{" "}
          <span className="text-muted-foreground/50">{m.time}</span>
          {m.kind === "approval" && (
            <span className="text-brand-purple"> · requested sign-off</span>
          )}
        </p>
        {m.kind === "text" ? (
          <p className="mt-1 text-sm text-foreground">{m.text}</p>
        ) : (
          <div className="mt-2 rounded-xl border border-brand-purple/30 bg-brand-purple/5 p-3">
            <div className="flex items-center justify-between">
              <p className="label-mono text-[10px] text-brand-purple">
                Approval request
              </p>
              <p className="label-mono text-[10px] text-muted-foreground/70">
                {m.status}
              </p>
            </div>
            <p className="mt-1 text-sm">{m.title}</p>
            {m.status === "pending" && (
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => onDecide(m.approvalId, "approved")}
                  disabled={isBusy(`approval:${m.approvalId}`)}
                  className="label-mono rounded-lg bg-accent px-2 py-1 text-[10px] text-brand-teal hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isBusy(`approval:${m.approvalId}`) ? "…" : "✓ Approve"}
                </button>
                <button
                  onClick={() => onDecide(m.approvalId, "rejected")}
                  disabled={isBusy(`approval:${m.approvalId}`)}
                  className="label-mono rounded-lg bg-accent px-2 py-1 text-[10px] text-destructive hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isBusy(`approval:${m.approvalId}`) ? "…" : "✕ Reject"}
                </button>
              </div>
            )}
            {m.status !== "pending" && m.decidedBy && (
              <p className="mt-1 text-[10px] text-muted-foreground/50">
                {m.status} by {m.decidedBy}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
