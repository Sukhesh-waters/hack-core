"use client";

import { useState, useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { sendReportAction, type SendReportState } from "./actions";

export type RecentSend = {
  id: string;
  audience: string;
  recipients: string[];
  status: "sent" | "failed";
  createdAt: Date;
};

function SendButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Sending…" : "Send report"}
    </Button>
  );
}

function formatSendDate(date: Date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function ReportComposer({
  workspaceId,
  clientId,
  contactEmail,
  initialDraft,
  recentSends,
}: {
  workspaceId: string;
  clientId: string;
  contactEmail: string | null;
  initialDraft: string;
  recentSends: RecentSend[];
}) {
  const [body, setBody] = useState(initialDraft);
  const [audience, setAudience] = useState<"team" | "client">("team");
  const [state, formAction] = useActionState<SendReportState, FormData>(
    sendReportAction,
    undefined,
  );

  return (
    <form action={formAction} className="mt-4 space-y-3">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="audience" value={audience} />
      <input type="hidden" name="body" value={body} />

      <div className="flex flex-wrap gap-3 text-xs">
        <label className="flex cursor-pointer items-center gap-1.5 text-muted-foreground">
          <input
            type="radio"
            name="audience-choice"
            checked={audience === "team"}
            onChange={() => setAudience("team")}
          />
          Team
        </label>
        <label
          className={
            contactEmail
              ? "flex cursor-pointer items-center gap-1.5 text-muted-foreground"
              : "flex items-center gap-1.5 text-muted-foreground/50"
          }
        >
          <input
            type="radio"
            name="audience-choice"
            checked={audience === "client"}
            disabled={!contactEmail}
            onChange={() => setAudience("client")}
          />
          {contactEmail ? `Client — ${contactEmail}` : "Client — no contact email on file"}
        </label>
      </div>

      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={8}
        className="font-mono text-xs"
      />
      <div className="flex flex-wrap items-center gap-2.5">
        <SendButton />
        <a
          href={`/api/w/${workspaceId}/reports/${clientId}/export`}
          download
          className="inline-flex items-center text-xs px-2.5 py-1.5 rounded border border-border bg-muted/20 hover:bg-muted text-foreground transition"
        >
          Export CSV
        </a>
        <a
          href={`/w/${workspaceId}/reports/${clientId}/print`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center text-xs px-2.5 py-1.5 rounded border border-border bg-muted/20 hover:bg-muted text-foreground transition"
        >
          Print / PDF ↗
        </a>
        {state?.ok ? (
          <p className="text-xs text-brand-teal">{state.ok}</p>
        ) : null}
        {state?.error ? (
          <p className="text-xs text-destructive">{state.error}</p>
        ) : null}
      </div>

      {recentSends.length > 0 ? (
        <div className="border-t border-border pt-3">
          <p className="label-mono text-muted-foreground/70">Send history</p>
          <ul className="mt-1.5 space-y-1">
            {recentSends.map((send) => (
              <li
                key={send.id}
                className={
                  send.status === "sent"
                    ? "text-xs text-brand-teal"
                    : "text-xs text-destructive"
                }
              >
                {send.status === "sent"
                  ? `Sent to ${send.audience} (${send.recipients.length}) · ${formatSendDate(send.createdAt)}`
                  : `Failed — ${send.audience} · ${formatSendDate(send.createdAt)}`}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </form>
  );
}
