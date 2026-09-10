"use client";

import { useEffect, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { addCommentAction, type RefineState } from "./actions";

function SendButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Posting…" : "Comment"}
    </Button>
  );
}

/**
 * Comment box + 10s polling: Supabase Realtime is deferred (Phase 5 plan),
 * so the thread refreshes on an interval — the W7-sanctioned fallback.
 */
export function CommentForm({
  workspaceId,
  contentId,
}: {
  workspaceId: string;
  contentId: string;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useFormState<RefineState, FormData>(
    async (prev, formData) => {
      const result = await addCommentAction(prev, formData);
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
      <input type="hidden" name="contentId" value={contentId} />
      <textarea
        name="body"
        rows={2}
        required
        maxLength={1000}
        placeholder="Message the team — feedback, sign-off notes…"
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
