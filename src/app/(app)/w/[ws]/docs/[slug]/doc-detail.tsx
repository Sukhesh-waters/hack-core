"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DocEditor } from "../doc-editor";

/**
 * View/edit toggle, client-side state — the only reason this component is
 * "use client". Markdown rendering itself needs no client interactivity:
 * it happens server-side in RenderedDocBody (rendered-doc-body.tsx) and
 * arrives here pre-rendered via the `renderedBody` prop, so
 * react-markdown/remark-gfm never ship to the browser for this route.
 * ReactMarkdown escapes HTML by default (no dangerouslySetInnerHTML
 * anywhere in this feature) — see jira-confluence-plan.md D1: "never
 * dangerouslySetInnerHTML raw markdown without a sanitizer." That property
 * is unchanged by this split; only where the parsing runs changed.
 */
export function DocDetail({
  workspaceId,
  docId,
  title,
  body,
  renderedBody,
  kind,
  updatedAtLabel,
  updatedByLabel,
}: {
  workspaceId: string;
  docId: string;
  title: string;
  body: string;
  renderedBody: React.ReactNode;
  kind: "doc" | "sop" | "auto";
  updatedAtLabel: string;
  updatedByLabel: string;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <DocEditor
        mode="edit"
        workspaceId={workspaceId}
        docId={docId}
        initialTitle={title}
        initialBody={body}
        initialKind={kind}
        onSaved={() => setEditing(false)}
      />
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-3xl">{title}</h1>
          {kind === "sop" ? (
            <span className="rounded-full border border-brand-teal/40 bg-brand-teal/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-brand-teal">
              SOP
            </span>
          ) : null}
        </div>
        <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
          Edit
        </Button>
      </div>
      <p className="mt-2 font-mono text-xs text-muted-foreground/50">
        updated {updatedAtLabel} by {updatedByLabel}
      </p>

      <div className="mt-6">{renderedBody}</div>
    </div>
  );
}
