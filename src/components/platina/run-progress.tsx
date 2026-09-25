"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type RunState = {
  status: string;
  source: { name: string; url: string | null } | null;
  counters: Record<string, unknown> | null;
  reason: string | null;
  steps: { status: string; message: string | null; at: string }[];
};

const DONE = new Set(["completed", "degraded", "failed", "cancelled"]);

/**
 * "Read it now" panel (C8.2): follows one collection run step by step while
 * the job runner reads the page, analyses it and files what it found, then
 * refreshes the page so the new findings appear. Polls every 2 s while the
 * run is going, stops when it ends or the tab is hidden.
 */
export function RunProgress({ ws, runId }: { ws: string; runId: string }) {
  const router = useRouter();
  const [run, setRun] = useState<RunState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refreshed = useRef(false);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (document.hidden) {
        timer = setTimeout(tick, 2000);
        return;
      }
      try {
        const res = await fetch(`/p/${ws}/competitors/run/${runId}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`answered ${res.status}`);
        const next = (await res.json()) as RunState;
        if (stop) return;
        setRun(next);
        if (DONE.has(next.status)) {
          if (!refreshed.current) {
            refreshed.current = true;
            router.refresh();
          }
          return;
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "could not follow the run");
      }
      timer = setTimeout(tick, 2000);
    };
    tick();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [ws, runId, router]);

  const finished = run && DONE.has(run.status);
  return (
    <section aria-label="Reading the link" aria-live="polite" className="rounded-lg border border-primary/40 bg-primary/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {finished ? "Read" : "Reading now"}: {run?.source?.name ?? "the link"}
        </p>
        <span
          className={cn(
            "rounded-full border px-2.5 py-0.5 text-xs",
            run?.status === "completed"
              ? "border-primary/40 text-primary"
              : run?.status === "failed"
                ? "border-destructive/50 text-destructive"
                : "border-border text-muted-foreground",
          )}
        >
          {run?.status ?? "starting"}
        </span>
      </div>
      <ol className="mt-3 space-y-1 border-l border-border pl-3 text-xs">
        {(run?.steps ?? []).map((s, i) => (
          <li key={`${s.at}-${i}`}>
            <span className="font-mono text-[10px] text-muted-foreground">{new Date(s.at).toLocaleTimeString()}</span>{" "}
            <span className="font-medium">{s.status}</span>
            {s.message ? <span className="text-muted-foreground"> — {s.message}</span> : null}
          </li>
        ))}
        {!finished ? <li className="animate-pulse text-muted-foreground">waiting for the job runner…</li> : null}
      </ol>
      {finished && run?.counters ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {Object.entries(run.counters)
            .filter(([, v]) => typeof v === "number")
            .map(([k, v]) => `${k}: ${v}`)
            .join(" · ")}
        </p>
      ) : null}
      {run?.reason ? <p className="mt-1 text-xs text-muted-foreground">Note: {run.reason}</p> : null}
      {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
    </section>
  );
}
