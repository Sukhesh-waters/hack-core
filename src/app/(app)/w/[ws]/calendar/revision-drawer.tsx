"use client";

import { useState } from "react";
import {
  applyRevisionAction,
  discardRevisionAction,
} from "./actions";

export type RevisionView = {
  id: string;
  contentId: string;
  authorKind: "human" | "ai";
  fields: Record<string, unknown>;
  priorFields: Record<string, unknown>;
  note: string | null;
  createdAtIso: string;
};

function label(field: string) {
  return field
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

export function RevisionDrawer({
  workspaceId,
  rowTitle,
  revisions,
  onClose,
  onResolved,
}: {
  workspaceId: string;
  rowTitle: string;
  revisions: RevisionView[];
  onClose: () => void;
  onResolved: (contentId: string, revisionId: string) => void;
}) {
  const [selected, setSelected] = useState<Record<string, Set<string>>>(() =>
    // Nothing is pre-selected: accepting by default would make "close the
    // drawer" indistinguishable from "approve everything the model said".
    Object.fromEntries(revisions.map((r) => [r.id, new Set<string>()])),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggle(revisionId: string, field: string) {
    setSelected((cur) => {
      const next = new Set(cur[revisionId] ?? []);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return { ...cur, [revisionId]: next };
    });
  }

  async function apply(revision: RevisionView, fields: string[]) {
    setBusy(revision.id);
    setError(null);
    try {
      const result = await applyRevisionAction({
        workspaceId,
        revisionId: revision.id,
        fields,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onResolved(revision.contentId, revision.id);
    } finally {
      setBusy(null);
    }
  }

  async function discard(revision: RevisionView) {
    setBusy(revision.id);
    setError(null);
    try {
      const result = await discardRevisionAction({
        workspaceId,
        revisionId: revision.id,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onResolved(revision.contentId, revision.id);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      role="dialog"
      aria-label={`Suggestions for ${rowTitle}`}
      className="fixed inset-y-0 right-0 z-50 w-full max-w-xl overflow-y-auto border-l border-border bg-popover p-5 shadow-2xl"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-xl text-foreground">Suggestions</h2>
          <p className="mt-0.5 text-sm text-muted-foreground/70">{rowTitle}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-border px-2.5 py-1 text-sm text-muted-foreground hover:text-foreground"
        >
          Close
        </button>
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}

      {revisions.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground/70">
          Nothing pending on this row.
        </p>
      ) : null}

      {revisions.map((revision) => {
        const fields = Object.keys(revision.fields);
        const chosen = selected[revision.id] ?? new Set<string>();
        return (
          <section
            key={revision.id}
            className="mt-5 rounded-lg border border-border p-4"
          >
            <div className="flex items-center justify-between text-xs text-muted-foreground/70">
              <span>
                {revision.authorKind === "ai" ? "AI suggestion" : "Proposed"}
                {" · "}
                {new Date(revision.createdAtIso).toLocaleString()}
              </span>
            </div>
            {revision.note ? (
              <p className="mt-1 text-xs text-amber-300/70">{revision.note}</p>
            ) : null}

            <div className="mt-3 space-y-2">
              {fields.map((field) => (
                <label
                  key={field}
                  className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-2.5 hover:border-border"
                >
                  <input
                    type="checkbox"
                    checked={chosen.has(field)}
                    onChange={() => toggle(revision.id, field)}
                    className="mt-1 accent-teal-400"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="text-xs uppercase tracking-wide text-muted-foreground/70">
                      {label(field)}
                    </span>
                    <span className="mt-1 grid grid-cols-2 gap-2 text-sm">
                      <span className="min-w-0 break-words text-muted-foreground/70 line-through decoration-muted-foreground/50">
                        {display(revision.priorFields[field])}
                      </span>
                      <span className="min-w-0 break-words text-foreground">
                        {display(revision.fields[field])}
                      </span>
                    </span>
                  </span>
                </label>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy === revision.id || chosen.size === 0}
                onClick={() => apply(revision, [...chosen])}
                className="rounded-md border border-brand-teal/50 bg-brand-teal/10 px-3 py-1.5 text-sm text-foreground disabled:opacity-40"
              >
                {busy === revision.id
                  ? "Applying…"
                  : `Apply ${chosen.size || ""}`.trim()}
              </button>
              <button
                type="button"
                disabled={busy === revision.id}
                onClick={() => apply(revision, fields)}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                Accept all
              </button>
              <button
                type="button"
                disabled={busy === revision.id}
                onClick={() => discard(revision)}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground/70 hover:text-foreground disabled:opacity-40"
              >
                Discard
              </button>
            </div>
          </section>
        );
      })}
    </div>
  );
}
