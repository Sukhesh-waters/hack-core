"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import type { HarnessSegment } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GlassCard } from "@/components/glass-card";
import { cn } from "@/lib/utils";
import {
  requestPatternRun,
  saveHarnessRule,
  type HarnessActionState,
} from "./actions";

const SEGMENT_KINDS: Array<{ value: HarnessSegment["kind"]; label: string }> = [
  { value: "competitor_handle", label: "Competitor handle" },
  { value: "hashtag", label: "Hashtag" },
  { value: "niche_query", label: "Niche query" },
];

const CADENCES = ["manual", "daily", "weekly"] as const;

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save harness rules"}
    </Button>
  );
}

function RunNowButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" disabled={pending}>
      {pending ? "Queuing…" : "Run now"}
    </Button>
  );
}

export function HarnessForm({
  workspaceId,
  initial,
}: {
  workspaceId: string;
  initial: {
    segments: HarnessSegment[];
    maxPostsPerRun: number;
    cadence: (typeof CADENCES)[number];
    enabled: boolean;
  };
}) {
  const [segments, setSegments] = useState<HarnessSegment[]>(initial.segments);
  const [cap, setCap] = useState(String(initial.maxPostsPerRun));
  const [cadence, setCadence] = useState<(typeof CADENCES)[number]>(
    initial.cadence,
  );
  const [enabled, setEnabled] = useState(initial.enabled);
  const [saveState, saveAction] = useFormState<HarnessActionState, FormData>(
    saveHarnessRule,
    undefined,
  );
  const [runState, runAction] = useFormState<HarnessActionState, FormData>(
    requestPatternRun,
    undefined,
  );

  const patchSegment = (index: number, partial: Partial<HarnessSegment>) =>
    setSegments((all) =>
      all.map((s, i) => (i === index ? { ...s, ...partial } : s)),
    );

  return (
    <GlassCard className="space-y-5 p-6">
      <div className="flex items-center justify-between">
        <p className="label-mono text-muted-foreground/70">Harness rules</p>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => setEnabled((v) => !v)}
          className={cn(
            "rounded-full border px-3 py-1 text-xs transition",
            enabled
              ? "border-brand-teal/60 bg-brand-teal/10 text-brand-teal"
              : "border-border text-muted-foreground/70",
          )}
        >
          {enabled ? "Scheduled runs ON" : "Scheduled runs OFF"}
        </button>
      </div>

      <div className="space-y-3">
        {segments.map((segment, index) => (
          <div
            key={index}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3"
          >
            <select
              aria-label="Segment kind"
              value={segment.kind}
              onChange={(e) =>
                patchSegment(index, {
                  kind: e.target.value as HarnessSegment["kind"],
                })
              }
              className="rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:outline-none"
            >
              {SEGMENT_KINDS.map((kind) => (
                <option
                  key={kind.value}
                  value={kind.value}
                  className="bg-neutral-900"
                >
                  {kind.label}
                </option>
              ))}
            </select>
            <Input
              aria-label="Segment value"
              className="w-48"
              value={segment.value}
              onChange={(e) => patchSegment(index, { value: e.target.value })}
              placeholder={
                segment.kind === "competitor_handle"
                  ? "@competitor"
                  : segment.kind === "hashtag"
                    ? "#skincare"
                    : "barrier repair routines"
              }
            />
            <Input
              aria-label="Segment note"
              className="w-44"
              value={segment.note ?? ""}
              onChange={(e) =>
                patchSegment(index, { note: e.target.value || undefined })
              }
              placeholder="Note (optional)"
            />
            {segment.kind !== "niche_query" ? (
              <select
                aria-label="Scan target"
                value={segment.target ?? "posts"}
                onChange={(e) =>
                  patchSegment(index, {
                    target: e.target.value as HarnessSegment["target"],
                  })
                }
                className="rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:outline-none"
              >
                <option value="posts" className="bg-neutral-900">
                  Posts
                </option>
                <option value="reels" className="bg-neutral-900">
                  Reels
                </option>
              </select>
            ) : null}
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                aria-label="Mine comments"
                checked={segment.mineComments ?? false}
                onChange={(e) =>
                  patchSegment(index, {
                    mineComments: e.target.checked || undefined,
                  })
                }
                className="h-3.5 w-3.5 rounded border-border bg-muted"
              />
              Mine comments
            </label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                setSegments((all) => all.filter((_, i) => i !== index))
              }
            >
              Remove
            </Button>
          </div>
        ))}
        {segments.length < 12 ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setSegments((all) => [
                ...all,
                { kind: "competitor_handle", value: "" },
              ])
            }
          >
            Add segment
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="cap">Max posts per run (≤ 100)</Label>
          <Input
            id="cap"
            type="number"
            min={1}
            max={100}
            className="w-32"
            value={cap}
            onChange={(e) => setCap(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cadence">Cadence</Label>
          <select
            id="cadence"
            value={cadence}
            onChange={(e) =>
              setCadence(e.target.value as (typeof CADENCES)[number])
            }
            className="block rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground focus:outline-none"
          >
            {CADENCES.map((c) => (
              <option key={c} value={c} className="bg-neutral-900">
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      {saveState?.error ? (
        <p className="text-sm text-destructive">{saveState.error}</p>
      ) : null}
      {saveState?.ok ? (
        <p className="text-sm text-brand-teal">{saveState.ok}</p>
      ) : null}
      {runState?.error ? (
        <p className="text-sm text-destructive">{runState.error}</p>
      ) : null}
      {runState?.ok ? (
        <p className="text-sm text-brand-teal">{runState.ok}</p>
      ) : null}

      <div className="flex items-center justify-between pt-1">
        <form action={runAction}>
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <RunNowButton />
        </form>
        <form action={saveAction}>
          <input
            type="hidden"
            name="payload"
            value={JSON.stringify({
              workspaceId,
              segments: segments.filter((s) => s.value.trim() !== ""),
              maxPostsPerRun: Number(cap),
              cadence,
              enabled,
            })}
          />
          <SaveButton />
        </form>
      </div>
    </GlassCard>
  );
}
