"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/glass-card";
import { IdeaCard, type IdeaView } from "./idea-card";
import { combineIdeasAction, draftIdea } from "./actions";

export function IdeaPool({
  workspaceId,
  clientId,
  ideas,
}: {
  workspaceId: string;
  clientId: string;
  ideas: IdeaView[];
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);

  const pooledIdeas = ideas.filter((i) => selectedIds.includes(i.id));

  function toggleSelect(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  }

  function handleCombine() {
    if (selectedIds.length < 2) return;
    setActionError(null);
    startTransition(async () => {
      const res = await combineIdeasAction(workspaceId, clientId, selectedIds);
      if (res?.error) {
        setActionError(res.error);
      } else {
        setSelectedIds([]);
      }
    });
  }

  function handleDraftAll() {
    if (pooledIdeas.length === 0) return;
    setActionError(null);
    startTransition(async () => {
      for (const idea of pooledIdeas) {
        const formData = new FormData();
        formData.set("workspaceId", workspaceId);
        formData.set("ideaId", idea.id);
        await draftIdea(undefined, formData);
      }
    });
  }

  return (
    <div className="space-y-6">
      {actionError ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          {actionError}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left Pane: Idea List */}
        <div className="space-y-4 lg:col-span-7">
          <p className="label-mono text-brand-teal">Generated Pool ({ideas.length})</p>
          {ideas.map((idea) => {
            const isSelected = selectedIds.includes(idea.id);
            return (
              <div key={idea.id} className="relative flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleSelect(idea.id)}
                  className="mt-5 h-4 w-4 rounded border-border accent-brand-teal"
                  title="Add to working pool"
                />
                <div className="flex-1">
                  <IdeaCard workspaceId={workspaceId} idea={idea} />
                </div>
              </div>
            );
          })}
        </div>

        {/* Right Pane: Working Pool Canvas */}
        <div className="space-y-4 lg:col-span-5">
          <GlassCard className="sticky top-6 p-5">
            <div className="flex items-center justify-between">
              <p className="label-mono text-brand-purple">
                Working Set ({pooledIdeas.length})
              </p>
              {selectedIds.length > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedIds([])}
                  disabled={pending}
                >
                  Clear
                </Button>
              ) : null}
            </div>

            {pooledIdeas.length === 0 ? (
              <p className="mt-4 text-xs text-muted-foreground/70">
                Select 2 or more ideas using the checkboxes on the left to merge
                them into a strategic concept, or batch draft them together.
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                {pooledIdeas.map((idea) => (
                  <div
                    key={idea.id}
                    className="rounded-lg border border-border bg-background/50 p-3 text-xs"
                  >
                    <p className="font-semibold text-foreground">{idea.hook}</p>
                    {idea.angle ? (
                      <p className="mt-1 text-muted-foreground">{idea.angle}</p>
                    ) : null}
                  </div>
                ))}

                <div className="flex flex-col gap-2 pt-3">
                  <Button
                    type="button"
                    size="sm"
                    disabled={selectedIds.length < 2 || pending}
                    onClick={handleCombine}
                  >
                    {pending ? "Combining..." : `Combine (${selectedIds.length}) → Single Concept`}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pooledIdeas.length === 0 || pending}
                    onClick={handleDraftAll}
                  >
                    Draft All ({pooledIdeas.length})
                  </Button>
                </div>
              </div>
            )}
          </GlassCard>
        </div>
      </div>
    </div>
  );
}
