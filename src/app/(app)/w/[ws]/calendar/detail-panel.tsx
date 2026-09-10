"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CONTENT_TYPE_COLORS, type ContentType } from "@/lib/colors";
import { contentType, isVideoContentType } from "@/db/schema";
import type { PlanCellField } from "@/lib/plan-cell";
import type { CustomFieldDefinition } from "@/lib/custom-fields";
import { CustomFieldInput } from "@/components/custom-field-input";
import {
  labelize,
  toLocalInput,
  type MemberOption,
  type PlanRowView,
} from "./plan-grid";
import {
  addPlanRowCommentAction,
  loadRowDetailAction,
  type RowActivityView,
  type RowCommentView,
} from "./actions";
import { saveCustomFieldValueAction } from "./custom-field-actions";

/**
 * F4 — carries the grid-wide custom-field definitions and each row's stored
 * values from the server component (page.tsx) down to DetailPanel WITHOUT
 * routing through PlanGrid's props. PlanGrid (owned by another slice's agent
 * this session) renders <DetailPanel> internally with a fixed prop list;
 * threading new data through it would mean editing a file off-limits here.
 * A context wrapped around <PlanGrid> from page.tsx sidesteps that entirely —
 * PlanGrid never needs to know this data exists, it just renders children
 * that happen to read it.
 */
type CustomFieldsContextValue = {
  definitions: CustomFieldDefinition[];
  /** Keyed by content id, then by field definition id. */
  valuesByContentId: Record<string, Record<string, unknown>>;
};

// Exported so plan-grid.tsx (F5) can read the same already-fetched
// definitions + values for its own custom-field columns, instead of
// threading a second copy through PlanGrid's props or fetching again.
export const CustomFieldsContext = createContext<CustomFieldsContextValue>({
  definitions: [],
  valuesByContentId: {},
});

export function CustomFieldsProvider({
  definitions,
  valuesByContentId,
  children,
}: CustomFieldsContextValue & { children: React.ReactNode }) {
  return (
    <CustomFieldsContext.Provider value={{ definitions, valuesByContentId }}>
      {children}
    </CustomFieldsContext.Provider>
  );
}

const fieldClass =
  "w-full rounded-md border border-border bg-muted px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-brand-teal/60 focus:bg-accent";

/** Renders one activity row into a short human sentence. Unknown verbs fall
 *  back to a labelized verb rather than dropping the entry silently — a
 *  history line the UI can't fully explain is still evidence something
 *  happened. */
function describeActivity(entry: RowActivityView, members: MemberOption[]) {
  const who = (id: string | null) =>
    id ? (members.find((m) => m.id === id)?.label ?? "Someone") : "System";
  const meta = entry.meta ?? {};
  switch (entry.verb) {
    case "assigned": {
      const to = meta.to;
      return `Assigned to ${typeof to === "string" ? who(to) : "no one"}`;
    }
    case "due_set": {
      const to = meta.to;
      if (typeof to !== "string") return "Due date cleared";
      const d = new Date(to);
      return Number.isNaN(d.getTime())
        ? "Due date updated"
        : `Due date set to ${d.toLocaleDateString()}`;
    }
    case "revision_applied": {
      const fields = Array.isArray(meta.fields) ? (meta.fields as string[]) : [];
      return fields.length
        ? `Applied suggestion: ${fields.map(labelize).join(", ")}`
        : "Applied a suggestion";
    }
    case "stage_advanced": {
      const from = typeof meta.from === "string" ? labelize(meta.from) : null;
      const to = typeof meta.to === "string" ? labelize(meta.to) : null;
      return from && to ? `Moved from ${from} to ${to}` : "Production stage updated";
    }
    case "scheduled": {
      const scheduledFor = meta.scheduledFor;
      if (typeof scheduledFor !== "string") return "Scheduled";
      const d = new Date(scheduledFor);
      return Number.isNaN(d.getTime())
        ? "Scheduled"
        : `Scheduled for ${d.toLocaleString()}`;
    }
    case "compliance_run": {
      const verdict = meta.verdict;
      return typeof verdict === "string"
        ? `Compliance check: ${labelize(verdict)}`
        : "Compliance check ran";
    }
    default:
      return labelize(entry.verb);
  }
}

function PanelField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground/70">{label}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function PanelText({
  label,
  value,
  wide,
  textarea,
  onCommit,
}: {
  label: string;
  value: string | null;
  wide?: boolean;
  textarea?: boolean;
  onCommit: (value: string | null) => void;
}) {
  const commonProps = {
    "aria-label": label,
    placeholder: "—",
    defaultValue: value ?? "",
    className: cn(fieldClass, wide ? "min-h-20" : undefined),
    onKeyDown: (
      e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      if (e.key === "Escape") {
        e.currentTarget.value = value ?? "";
        e.currentTarget.blur();
      }
      if (e.key === "Enter" && !textarea) e.currentTarget.blur();
    },
    onBlur: (
      e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      const next = e.target.value.trim();
      const normalized = next === "" ? null : next;
      if (normalized === value) return;
      onCommit(normalized);
    },
  };
  return textarea ? (
    <textarea rows={3} {...commonProps} />
  ) : (
    <input type="text" {...commonProps} />
  );
}

export function DetailPanel({
  workspaceId,
  row,
  members,
  suppressClose,
  onClose,
  onOpenSuggestions,
  onCommit,
}: {
  workspaceId: string;
  row: PlanRowView;
  members: MemberOption[];
  /** True while a layered dialog (the RevisionDrawer) is open on top of this
   *  panel — its own Escape/outside-click close is suppressed so the two
   *  don't fight over the same key press or click. */
  suppressClose: boolean;
  onClose: () => void;
  onOpenSuggestions: () => void;
  onCommit: (
    field: PlanCellField,
    value: string | number | null,
    patch: Partial<PlanRowView>,
  ) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [detail, setDetail] = useState<{
    activity: RowActivityView[];
    comments: RowCommentView[];
  } | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [postingComment, setPostingComment] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);

  // F4 — custom fields. This panel is remounted per row (PlanGrid keys it
  // by row.id), so seeding state once from context at mount is correct —
  // there is no stale-row carryover to guard against here.
  const { definitions: customFieldDefinitions, valuesByContentId } =
    useContext(CustomFieldsContext);
  const [customFieldValues, setCustomFieldValues] = useState<
    Record<string, unknown>
  >(() => valuesByContentId[row.id] ?? {});
  const [customFieldErrors, setCustomFieldErrors] = useState<
    Record<string, string>
  >({});

  async function commitCustomField(
    definition: CustomFieldDefinition,
    value: unknown,
  ) {
    const prior = customFieldValues[definition.id] ?? null;
    // Optimistic, same shape as the grid's own commit(): paint the new
    // value, put the old one back and surface the error if the server
    // (which re-validates against the live definition) refuses it.
    setCustomFieldValues((cur) => ({ ...cur, [definition.id]: value }));
    setCustomFieldErrors((cur) => {
      if (!(definition.id in cur)) return cur;
      const next = { ...cur };
      delete next[definition.id];
      return next;
    });
    const result = await saveCustomFieldValueAction({
      workspaceId,
      contentId: row.id,
      fieldId: definition.id,
      value,
    });
    if (!result.ok) {
      setCustomFieldValues((cur) => ({ ...cur, [definition.id]: prior }));
      setCustomFieldErrors((cur) => ({ ...cur, [definition.id]: result.error }));
    }
  }

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setDetailError(null);
    loadRowDetailAction(workspaceId, row.id).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setDetailError(result.error);
        return;
      }
      setDetail({ activity: result.activity, comments: result.comments });
    });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, row.id]);

  useEffect(() => {
    if (suppressClose) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function handlePointerDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKey);
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [onClose, suppressClose]);

  async function submitComment() {
    const body = commentBody.trim();
    if (!body) return;
    setPostingComment(true);
    setCommentError(null);
    try {
      const result = await addPlanRowCommentAction({
        workspaceId,
        contentId: row.id,
        body,
      });
      if (!result.ok) {
        setCommentError(result.error);
        return;
      }
      // Appends the one new comment rather than replacing the thread with a
      // refetch — the server no longer re-reads the (200-cap) thread at all,
      // so this is the only place the new comment gets folded in.
      setDetail((cur) => ({
        activity: cur?.activity ?? [],
        comments: [...(cur?.comments ?? []), result.comment],
      }));
      setCommentBody("");
    } finally {
      setPostingComment(false);
    }
  }

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={`Details for ${row.title}`}
      className="fixed inset-y-0 right-0 z-40 w-full max-w-md overflow-y-auto border-l border-border bg-popover p-5 shadow-2xl"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <PanelText
            label="Title"
            value={row.title}
            wide
            onCommit={(v) => onCommit("title", v ?? "", { title: v ?? "" })}
          />
          <p className="mt-1.5 text-sm text-muted-foreground/70">{row.clientName}</p>
          <Link
            href={`/w/${workspaceId}/studio/${row.id}`}
            className="mt-1 inline-block text-xs text-brand-teal underline-offset-2 hover:underline"
          >
            Open in Studio →
          </Link>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-border px-2.5 py-1 text-sm text-muted-foreground hover:text-foreground"
        >
          Close
        </button>
      </div>

      {/* Workflow state — read-only. Moves through approvals and the stage
          transition graph, never a spreadsheet-style edit. */}
      <div className="mt-4 flex flex-wrap gap-1.5">
        <Badge variant="outline" className="border-border text-xs text-muted-foreground">
          {labelize(row.status)}
        </Badge>
        <Badge variant="outline" className="border-border text-xs text-muted-foreground">
          {labelize(row.complianceStatus)}
        </Badge>
        <Badge variant="outline" className="border-border text-xs text-muted-foreground">
          {row.productionStage ? labelize(row.productionStage) : "No stage"}
        </Badge>
      </div>

      <div className="mt-5 space-y-4">
        <PanelField label="Type">
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                CONTENT_TYPE_COLORS[row.type].dot,
              )}
            />
            <select
              aria-label="Content type"
              className={fieldClass}
              value={row.type}
              onChange={(e) => {
                const next = e.target.value as ContentType;
                onCommit("type", next, {
                  type: next,
                  durationSec: isVideoContentType(next)
                    ? row.durationSec
                    : null,
                });
              }}
            >
              {contentType.enumValues.map((t) => (
                <option key={t} value={t} className="bg-popover">
                  {labelize(t)}
                </option>
              ))}
            </select>
          </span>
        </PanelField>

        {isVideoContentType(row.type) ? (
          <PanelField label="Duration (seconds)">
            <input
              type="number"
              min={1}
              aria-label="Duration in seconds"
              placeholder="sec"
              className={fieldClass}
              defaultValue={row.durationSec ?? ""}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.currentTarget.value = String(row.durationSec ?? "");
                  e.currentTarget.blur();
                }
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              onBlur={(e) => {
                const raw = e.target.value.trim();
                const next = raw === "" ? null : Number(raw);
                if (next === row.durationSec) return;
                onCommit("durationSec", next, { durationSec: next });
              }}
            />
          </PanelField>
        ) : null}

        <PanelField label="Pillar">
          <PanelText
            label="Pillar"
            value={row.pillar}
            onCommit={(v) => onCommit("pillar", v, { pillar: v })}
          />
        </PanelField>

        <PanelField label="Strategy note">
          <PanelText
            label="Strategy note"
            value={row.strategyNote}
            wide
            textarea
            onCommit={(v) => onCommit("strategyNote", v, { strategyNote: v })}
          />
        </PanelField>

        <PanelField label="Assignee">
          <select
            aria-label="Assignee"
            className={fieldClass}
            value={row.assigneeId ?? ""}
            onChange={(e) => {
              const next = e.target.value || null;
              onCommit("assigneeId", next, { assigneeId: next });
            }}
          >
            <option value="" className="bg-popover">
              Unassigned
            </option>
            {members.map((m) => (
              <option key={m.id} value={m.id} className="bg-popover">
                {m.label}
              </option>
            ))}
          </select>
        </PanelField>

        <PanelField label="Due date">
          <input
            type="date"
            aria-label="Due date"
            className={fieldClass}
            defaultValue={toLocalInput(row.dueAtIso, false)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.currentTarget.value = toLocalInput(row.dueAtIso, false);
                e.currentTarget.blur();
              }
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            onBlur={(e) => {
              const raw = e.target.value;
              const iso = raw ? new Date(raw).toISOString() : null;
              if (iso === row.dueAtIso) return;
              onCommit("dueAt", iso, { dueAtIso: iso });
            }}
          />
        </PanelField>

        <PanelField label="Scheduled for">
          <input
            type="datetime-local"
            aria-label="Scheduled for"
            className={fieldClass}
            defaultValue={toLocalInput(row.scheduledForIso, true)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.currentTarget.value = toLocalInput(row.scheduledForIso, true);
                e.currentTarget.blur();
              }
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            onBlur={(e) => {
              const raw = e.target.value;
              const iso = raw ? new Date(raw).toISOString() : null;
              if (iso === row.scheduledForIso) return;
              onCommit("scheduledFor", iso, { scheduledForIso: iso });
            }}
          />
        </PanelField>
      </div>

      {customFieldDefinitions.length > 0 ? (
        <div className="mt-5 border-t border-border pt-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground/70">
            Custom fields
          </p>
          <div className="mt-3 space-y-4">
            {customFieldDefinitions.map((definition) => (
              <PanelField key={definition.id} label={definition.name}>
                <CustomFieldInput
                  definition={definition}
                  value={customFieldValues[definition.id] ?? null}
                  onCommit={(value) => commitCustomField(definition, value)}
                  peopleOptions={members}
                  error={customFieldErrors[definition.id]}
                />
              </PanelField>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-5 border-t border-border pt-4">
        {row.pendingSuggestions > 0 ? (
          <button
            type="button"
            onClick={onOpenSuggestions}
            className="text-sm text-brand-teal underline-offset-2 hover:underline"
          >
            {row.pendingSuggestions} pending suggestion
            {row.pendingSuggestions === 1 ? "" : "s"} — review
          </button>
        ) : (
          <p className="text-sm text-muted-foreground/70">No pending suggestions.</p>
        )}
      </div>

      <div className="mt-5 border-t border-border pt-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground/70">
          Activity
        </p>
        {detailError ? (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {detailError}
          </p>
        ) : null}
        {!detail && !detailError ? (
          <p className="mt-2 text-sm text-muted-foreground/70">Loading…</p>
        ) : null}
        {detail && detail.activity.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground/70">No activity yet.</p>
        ) : null}
        {detail && detail.activity.length > 0 ? (
          <ul className="mt-2 space-y-2">
            {detail.activity.map((entry) => (
              <li key={entry.id} className="text-sm text-muted-foreground">
                <span>{describeActivity(entry, members)}</span>
                <span className="ml-2 text-xs text-muted-foreground/50">
                  {new Date(entry.createdAtIso).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="mt-5 border-t border-border pt-4 pb-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground/70">
          Comments
        </p>
        {detail && detail.comments.length > 0 ? (
          <ul className="mt-2 space-y-3">
            {detail.comments.map((comment) => (
              <li key={comment.id} className="rounded-md border border-border p-2.5">
                <p className="text-xs text-muted-foreground/70">
                  {comment.authorName ?? comment.authorEmail}
                  <span className="ml-2 text-muted-foreground/50">
                    {new Date(comment.createdAtIso).toLocaleString()}
                  </span>
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                  {comment.body}
                </p>
              </li>
            ))}
          </ul>
        ) : detail ? (
          <p className="mt-2 text-sm text-muted-foreground/70">No comments yet.</p>
        ) : null}

        {commentError ? (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {commentError}
          </p>
        ) : null}

        <div className="mt-3 space-y-2">
          <textarea
            rows={2}
            aria-label="Add a comment"
            placeholder="Message the team…"
            value={commentBody}
            onChange={(e) => setCommentBody(e.target.value)}
            maxLength={1000}
            className={fieldClass}
          />
          <div className="flex justify-end">
            <button
              type="button"
              disabled={postingComment || commentBody.trim() === ""}
              onClick={submitComment}
              className="rounded-md border border-brand-teal/50 bg-brand-teal/10 px-3 py-1.5 text-sm text-foreground disabled:opacity-40"
            >
              {postingComment ? "Posting…" : "Comment"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
