"use client";

import { useState } from "react";
import type { BriefLine, CampaignBrief } from "@/lib/platina/opportunity-brief";
import { cn } from "@/lib/utils";

type Step = { id: string; label: string; detail: string; ms: number };

function Cites({ line }: { line: BriefLine }) {
  return (
    <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
      {line.cites.map((c) => {
        const tone = c.plane === "A" ? "border-primary/40 text-primary" : "border-border text-muted-foreground";
        const title = `${c.plane === "A" ? "Your own page" : "Public evidence"}: ${c.text}`;
        return c.url ? (
          <a
            key={c.id}
            href={c.url}
            target="_blank"
            rel="noopener noreferrer"
            title={title}
            className={cn("rounded border px-1 font-mono text-[10px] hover:bg-accent", tone)}
          >
            {c.id}
          </a>
        ) : (
          <span key={c.id} title={title} className={cn("rounded border px-1 font-mono text-[10px]", tone)}>
            {c.id}
          </span>
        );
      })}
    </span>
  );
}

/**
 * "AI campaign brief" for one opportunity (C8.4): streams what the AI reads
 * and checks, step by step, then the brief with every line's citations.
 * F = public evidence, A = the client's own pages; the two never share a line.
 */
export function OpportunityBrief({ ws, clientId, opportunityKey }: { ws: string; clientId: string; opportunityKey: string }) {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [steps, setSteps] = useState<Step[]>([]);
  const [brief, setBrief] = useState<CampaignBrief | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setState("running");
    setSteps([]);
    setBrief(null);
    setError(null);
    try {
      const res = await fetch(`/p/${ws}/opportunities/brief`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId, key: opportunityKey }),
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
            | { type: "brief"; brief: CampaignBrief }
            | { type: "error"; message: string };
          if (event.type === "step") setSteps((s) => [...s, event]);
          else if (event.type === "brief") {
            setBrief(event.brief);
            setState("done");
          } else {
            setError(event.message);
            setState("error");
          }
        }
      }
      setState((s) => (s === "running" ? "error" : s));
    } catch (e) {
      setError(e instanceof Error ? e.message : "the brief could not be written");
      setState("error");
    }
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={run}
        disabled={state === "running"}
        className="rounded-md border border-primary/40 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-60"
      >
        {state === "running" ? "AI is working…" : brief ? "Write the brief again" : "AI campaign brief"}
      </button>

      {steps.length > 0 || state === "running" ? (
        <ol className="mt-3 space-y-1.5 border-l border-border pl-3 text-xs" aria-live="polite">
          {steps.map((s) => (
            <li key={s.id}>
              <span className="font-medium text-foreground">✓ {s.label}</span>
              <span className="text-muted-foreground"> — {s.detail}</span>
              <span className="ml-1 font-mono text-[10px] text-muted-foreground">{(s.ms / 1000).toFixed(1)}s</span>
            </li>
          ))}
          {state === "running" ? <li className="animate-pulse text-muted-foreground">…</li> : null}
        </ol>
      ) : null}

      {error ? <p className="mt-2 text-xs text-destructive">Couldn&apos;t write the brief: {error}</p> : null}

      {brief ? (
        <div className="mt-3 space-y-3 rounded-md border border-border bg-muted/30 p-3 text-sm">
          <p>
            <span className="font-medium">Goal:</span> {brief.goal}
          </p>
          <p>
            <span className="font-medium">Audience:</span> {brief.audience}
          </p>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Why now · public evidence</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {brief.whyNow.map((l) => (
                <li key={l.text}>
                  {l.text}
                  <Cites line={l} />
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-primary">Fit · from your own pages</p>
            {brief.fit.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">No passage on your own site supports a product fit yet.</p>
            ) : (
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {brief.fit.map((l) => (
                  <li key={l.text}>
                    {l.text}
                    <Cites line={l} />
                  </li>
                ))}
              </ul>
            )}
            {brief.salesAngle ? (
              <p className="mt-2">
                <span className="font-medium">Sales angle:</span> {brief.salesAngle.text}
                <Cites line={brief.salesAngle} />
              </p>
            ) : null}
          </div>
          {brief.steps.length > 0 ? (
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Steps</p>
              <ol className="mt-1 space-y-0.5">
                {brief.steps.map((s) => (
                  <li key={`${s.when}-${s.what}`}>
                    <span className="font-mono text-xs text-muted-foreground">{s.when}</span> — {s.what}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
          <p className="text-[11px] text-muted-foreground">
            F = public evidence, A = your own pages; hover a label to read it, click to open the source. Lines the AI
            could not support were removed{brief.dropped ? ` (${brief.dropped})` : ""}.
          </p>
        </div>
      ) : null}
    </div>
  );
}
