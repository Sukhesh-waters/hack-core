"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { GlassCard } from "@/components/glass-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { GeneratedSopTemplate } from "@/lib/ai/sop-template-agent";
import { formatOffset } from "@/lib/sop/template";
import {
  commitGeneratedTemplateAction,
  generateTemplateFromProseAction,
  type GenerateTemplateActionState,
  type SopActionState,
} from "./actions";

function GenerateButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Designing process with AI…" : "Generate template draft"}
    </Button>
  );
}

function CommitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" className="bg-brand-teal text-black hover:bg-brand-teal/90" disabled={pending}>
      {pending ? "Saving template..." : "Commit & Save Template"}
    </Button>
  );
}

export function AiTemplateBuilder({ workspaceId }: { workspaceId: string }) {
  const [genState, genFormAction] = useFormState<
    GenerateTemplateActionState,
    FormData
  >(generateTemplateFromProseAction, {});

  const [commitState, commitFormAction] = useFormState<
    SopActionState,
    FormData
  >(commitGeneratedTemplateAction, undefined);

  const [isOpen, setIsOpen] = useState(false);
  const [editableDraft, setEditableDraft] = useState<GeneratedSopTemplate | null>(null);

  // Sync draft when generation succeeds
  if (genState.draft && (!editableDraft || genState.savedAt !== (editableDraft as unknown as { _savedAt?: number })._savedAt)) {
    const draftWithTimestamp = {
      ...genState.draft,
      _savedAt: genState.savedAt,
    };
    setEditableDraft(draftWithTimestamp);
  }

  if (!isOpen) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsOpen(true)}
        className="border-brand-teal/40 text-brand-teal hover:bg-brand-teal/10"
      >
        ✨ Generate template from prose
      </Button>
    );
  }

  return (
    <GlassCard className="mt-4 p-5 border-brand-teal/30">
      <div className="flex items-center justify-between">
        <p className="label-mono text-brand-teal">AI Template Architect</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setIsOpen(false);
            setEditableDraft(null);
          }}
          className="text-xs text-muted-foreground/70 hover:text-foreground"
        >
          Cancel
        </Button>
      </div>

      {!editableDraft ? (
        <form action={genFormAction} className="mt-3 space-y-3">
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <div>
            <label className="block text-xs uppercase tracking-wide text-muted-foreground/70">
              Describe your process or campaign cycle
            </label>
            <textarea
              name="description"
              required
              rows={3}
              placeholder="e.g. Monthly content production cycle for a skincare client with hook ideation, compliance review, client signoff, and publishing."
              className="mt-1 w-full rounded border border-border bg-muted p-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-brand-teal/50 focus:outline-none"
            />
          </div>

          {genState.error ? (
            <p className="text-xs text-amber-300">{genState.error}</p>
          ) : null}

          <div className="flex justify-end gap-2">
            <GenerateButton />
          </div>
        </form>
      ) : (
        <div className="mt-4">
          <div className="flex items-center justify-between rounded border border-brand-teal/20 bg-brand-teal/5 p-3">
            <p className="text-xs text-brand-teal">
              Reviewable Proposal — edit details or step offsets below, then commit to save.
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditableDraft(null)}
              className="text-xs text-muted-foreground/70"
            >
              Start over
            </Button>
          </div>

          <form action={commitFormAction} className="mt-4 space-y-4">
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <input
              type="hidden"
              name="stepsJson"
              value={JSON.stringify(editableDraft.steps)}
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs uppercase tracking-wide text-muted-foreground/70">
                  Template Name *
                </label>
                <Input
                  name="name"
                  required
                  value={editableDraft.name}
                  onChange={(e) =>
                    setEditableDraft({ ...editableDraft, name: e.target.value })
                  }
                  className="mt-1 border-border bg-muted text-foreground"
                />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-wide text-muted-foreground/70">
                  Runs Anchor Date Label *
                </label>
                <Input
                  name="anchorLabel"
                  required
                  value={editableDraft.anchorLabel}
                  onChange={(e) =>
                    setEditableDraft({
                      ...editableDraft,
                      anchorLabel: e.target.value,
                    })
                  }
                  className="mt-1 border-border bg-muted text-foreground"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs uppercase tracking-wide text-muted-foreground/70">
                Description
              </label>
              <Input
                name="description"
                value={editableDraft.description ?? ""}
                onChange={(e) =>
                  setEditableDraft({
                    ...editableDraft,
                    description: e.target.value,
                  })
                }
                className="mt-1 border-border bg-muted text-foreground"
              />
            </div>

            {/* Steps Review */}
            <div>
              <p className="label-mono mb-2 text-muted-foreground/70">
                Proposed Steps ({editableDraft.steps.length})
              </p>
              <div className="space-y-2">
                {editableDraft.steps.map((step, idx) => (
                  <div
                    key={step.tempId}
                    className="rounded border border-border bg-muted p-3 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-foreground">
                        {idx + 1}. {step.title}
                      </span>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className="border-border text-muted-foreground"
                        >
                          {formatOffset(step.dueOffsetDays)}
                        </Badge>
                        {step.gate !== "none" ? (
                          <Badge
                            variant="outline"
                            className="border-amber-400/40 text-amber-300"
                          >
                            Gate: {step.gate}
                          </Badge>
                        ) : null}
                        {step.creates !== "none" ? (
                          <Badge
                            variant="outline"
                            className="border-sky-400/40 text-sky-300"
                          >
                            Creates: {step.creates}
                          </Badge>
                        ) : null}
                        {step.assigneeRole ? (
                          <Badge
                            variant="outline"
                            className="border-brand-teal/40 text-brand-teal"
                          >
                            Role: {step.assigneeRole}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                    {step.description ? (
                      <p className="mt-1 text-muted-foreground/70">{step.description}</p>
                    ) : null}
                    {step.dependsOnTempIds.length > 0 ? (
                      <p className="mt-1 text-muted-foreground/70">
                        Waits on: {step.dependsOnTempIds.join(", ")}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            {commitState?.error ? (
              <p className="text-xs text-destructive">{commitState.error}</p>
            ) : null}

            <div className="flex justify-end gap-2">
              <CommitButton />
            </div>
          </form>
        </div>
      )}
    </GlassCard>
  );
}
