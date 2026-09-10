"use client";

import { useEffect, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { addTicketCommentAction, type TicketState } from "../actions";

function SendButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Posting…" : "Comment"}
    </Button>
  );
}

/**
 * Mirrors studio/[contentId]/comment-form.tsx: same 10s-polling fallback
 * (Supabase Realtime is deferred), same reset-on-success pattern.
 */
export function CommentForm({
  workspaceId,
  ticketId,
}: {
  workspaceId: string;
  ticketId: string;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useFormState<TicketState, FormData>(
    async (prev, formData) => {
      const result = await addTicketCommentAction(prev, formData);
      if (!result?.error) formRef.current?.reset();
      return result;
    },
    undefined,
  );

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(timer);
  }, [router]);

  return (
    <form ref={formRef} action={formAction} className="mt-3 space-y-2">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="ticketId" value={ticketId} />
      <textarea
        name="body"
        rows={2}
        required
        maxLength={4000}
        placeholder="Add a comment…"
        className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-brand-teal/50"
      />
      {state?.error ? (
        <p className="text-sm text-destructive">{state.error}</p>
      ) : null}
      <div className="flex justify-end">
        <SendButton />
      </div>
    </form>
  );
}
