"use client";

import Link from "next/link";
import { useState } from "react";
import type { Evidence, Idea, IdeaLine } from "@/lib/platina/idea-engine";
import { cn } from "@/lib/utils";

type Step = { id: string; label: string; detail: string; ms: number };
type RecordedIdea = Idea & { suggestionId: string | null };

const TONE: Record<Evidence["list"], string> = {
  F: "border-border text-muted-foreground",
  A: "border-primary/40 text-primary",
  P: "border-amber-500/50 text-amber-700 dark:text-amber-400",
};
const WHAT: Record<Evidence["list"], string> = { F: "Public evidence", A: "Your own page", P: "Learned pattern" };

function Cites({ line }: { line: IdeaLine }) {
  return (
    <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
      {line.cites.map((c) =>
        c.url ? (
          <a
            key={c.id}
            href={c.url}
            target="_blank"
            rel="noopener noreferrer"
            title={`${WHAT[c.list]}: ${c.text}`}
            className={cn("rounded border px-1 font-mono text-[10px] hover:bg-accent", TONE[c.list])}
          >
            {c.id}
          </a>
        ) : (
          <span key={c.id} title={`${WHAT[c.list]}: ${c.text}`} className={cn("rounded border px-1 font-mono text-[10px]", TONE[c.list])}>
            {c.id}
          </span>
        ),
      )}
    </span>
  );
}

/**
 * "Draft ideas" for one trigger (C8.5): streams each step the engine takes,
 * then the ideas with their citations — F public facts, A the client's own
 * pages, P learned patterns — each linked to its trace in the ledger.
 */
export function IdeaRun({ ws, triggerKey, label = "Draft ideas" }: { ws: string; triggerKey: string; label?: string }) {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [steps, setSteps] = useState<Step[]>([]);
  const [ideas, setIdeas] = useState<RecordedIdea[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setState("running");
    setSteps([]);
    setIdeas([]);
    setError(null);
    try {
      const res = await fetch(`/p/${ws}/learning/ideas`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: triggerKey }),
      });
      if (!res.ok || !res.body) throw new Error(`the server answered ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;
      while (!finished) {
        const { value, done } = await reader.read();
        finished = done;
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const text of lines) {
          if (!text.trim()) continue;
          const event = JSON.parse(text) as
            | ({ type: "step" } & Step)
            | { type: "ideas"; ideas: RecordedIdea[] }
            | { type: "error"; message: string };
          if (event.type === "step") setSteps((s) => [...s, event]);
          else if (event.type === "ideas") {
            setIdeas(event.ideas);
            setState("done");
          } else {
            setError(event.message);
            setState("error");
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "the ideas could not be drafted");
      setState("error");
    }
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={run}
        disabled={state === "running"}
        className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-60"
      >
        {state === "running" ? "Drafting…" : state === "idle" ? label : "Draft again"}
      </button>
      {steps.length > 0 ? (
        <ol className="mt-2 space-y-1 text-xs">
          {steps.map((s) => (
            <li key={s.id} className="flex gap-2">
              <span className="text-primary">✓</span>
              <span>
                <span className="font-medium">{s.label}</span> <span className="text-muted-foreground">— {s.detail}</span>{" "}
                <span className="font-mono text-[10px] text-muted-foreground">{(s.ms / 1000).toFixed(1)} s</span>
              </span>
            </li>
          ))}
          {state === "running" ? <li className="animate-pulse text-muted-foreground">working…</li> : null}
        </ol>
      ) : null}
      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
      {ideas.length > 0 ? (
        <ul className="mt-3 grid gap-2 md:grid-cols-2">
          {ideas.map((i, n) => (
            <li key={`${i.title}-${n}`} className="rounded-md border border-border bg-background p-3 text-sm">
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="rounded-full border border-border px-2 py-0 capitalize">{i.channel}</span>
                <span className="rounded-full border border-border px-2 py-0 capitalize">{i.format}</span>
                {i.explore ? (
                  <span className="rounded-full border border-amber-500/50 px-2 py-0 text-amber-700 dark:text-amber-400">trying something new</span>
                ) : i.pattern ? (
                  <span className="rounded-full border border-primary/40 px-2 py-0 text-primary">follows a learned pattern</span>
                ) : null}
              </div>
              <p className="mt-1.5 font-medium">{i.title}</p>
              <p className="mt-0.5 text-xs italic text-muted-foreground">&ldquo;{i.hook}&rdquo;</p>
              <ul className="mt-2 space-y-1 text-xs">
                {i.why.map((w, k) => (
                  <li key={k}>
                    <span className="text-muted-foreground">Why now:</span> {w.text}
                    <Cites line={w} />
                  </li>
                ))}
                {i.fit ? (
                  <li>
                    <span className="text-muted-foreground">Fit:</span> {i.fit.text}
                    <Cites line={i.fit} />
                  </li>
                ) : null}
                {i.pattern ? (
                  <li>
                    <span className="text-muted-foreground">Pattern:</span> {i.pattern.text}
                    <Cites line={i.pattern} />
                  </li>
                ) : null}
                {i.counterEvidence ? (
                  <li>
                    <span className="text-muted-foreground">Counter-evidence:</span> {i.counterEvidence}
                  </li>
                ) : null}
              </ul>
              {i.suggestionId ? (
                <Link href={`/p/${ws}/learning/${i.suggestionId}`} className="mt-2 inline-block text-xs text-primary underline-offset-4 hover:underline">
                  Trace →
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
