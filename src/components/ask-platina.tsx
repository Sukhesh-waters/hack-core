"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { askPlatinaAction } from "@/app/(app)/w/[ws]/ask/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GlassCard } from "@/components/glass-card";

type Exchange = {
  question: string;
  answer?: string;
  error?: string;
};

/** Floating workspace assistant. Transcript is session-local (client state);
 *  every answer comes from the guarded, workspace-grounded server action. */
export function AskPlatina({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [pending, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [exchanges, pending]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (q.length < 3 || pending) return;
    setQuestion("");
    setExchanges((prev) => [...prev, { question: q }]);
    startTransition(async () => {
      const result = await askPlatinaAction({ workspaceId, question: q });
      setExchanges((prev) =>
        prev.map((ex, i) => (i === prev.length - 1 ? { ...ex, ...result } : ex)),
      );
    });
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      {open ? (
        <GlassCard className="flex h-[28rem] w-80 flex-col p-4">
          <div className="flex items-center justify-between">
            <p className="label-mono text-muted-foreground/70">Ask Platina</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
            >
              Close
            </Button>
          </div>
          <div
            ref={scrollRef}
            className="mt-2 flex-1 space-y-3 overflow-y-auto pr-1"
          >
            {exchanges.length === 0 ? (
              <p className="text-sm text-muted-foreground/70">
                Ask about this workspace — schedule, clients, open tasks,
                pending approvals, fresh ideas.
              </p>
            ) : null}
            {exchanges.map((ex, i) => (
              <div key={i} className="space-y-2">
                <p className="ml-6 rounded-xl bg-accent px-3 py-2 text-sm text-foreground">
                  {ex.question}
                </p>
                {ex.error ? (
                  <p className="mr-6 text-xs text-destructive">{ex.error}</p>
                ) : ex.answer ? (
                  <p className="mr-6 whitespace-pre-wrap rounded-xl border border-brand-purple/25 bg-brand-purple/5 px-3 py-2 text-sm text-muted-foreground">
                    {ex.answer}
                  </p>
                ) : (
                  <p className="mr-6 text-xs text-muted-foreground/70">Thinking…</p>
                )}
              </div>
            ))}
          </div>
          <form onSubmit={submit} className="mt-3 flex items-center gap-2">
            <Input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask a question…"
              maxLength={500}
              aria-label="Ask Platina a question"
            />
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "…" : "Ask"}
            </Button>
          </form>
        </GlassCard>
      ) : (
        <Button type="button" onClick={() => setOpen(true)}>
          Ask Platina
        </Button>
      )}
    </div>
  );
}
