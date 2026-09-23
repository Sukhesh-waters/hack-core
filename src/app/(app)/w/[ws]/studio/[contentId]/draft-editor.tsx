"use client";

import { useState, useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { GlassCard } from "@/components/glass-card";
import { BrandComplianceMeter } from "@/components/studio/brand-compliance-meter";
import type { Draft } from "@/lib/ai/agents/content";
import type { BrandContext } from "@/db/schema";
import {
  autoFixComplianceAction,
  updateDraftSectionsAction,
  type RefineState,
} from "./actions";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Saving…" : "Save Section Edits"}
    </Button>
  );
}

export function DraftEditor({
  workspaceId,
  contentId,
  initialDraft,
  declaredBrand,
}: {
  workspaceId: string;
  contentId: string;
  initialDraft: Draft;
  declaredBrand?: BrandContext | null;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [isFixing, setIsFixing] = useState(false);
  const [draft, setDraft] = useState({
    caption: initialDraft.caption,
    script: initialDraft.script,
    hashtags: initialDraft.hashtags.join(" "),
    cta: initialDraft.cta,
  });
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  const [state, formAction] = useActionState<RefineState, FormData>(
    updateDraftSectionsAction,
    undefined,
  );

  async function handleAutoFix() {
    setIsFixing(true);
    const res = await autoFixComplianceAction(workspaceId, contentId);
    setIsFixing(false);
    if (res.ok && res.draft) {
      setDraft({
        caption: res.draft.caption,
        script: res.draft.script,
        hashtags: res.draft.hashtags.join(" "),
        cta: res.draft.cta,
      });
    }
  }

  function copyToClipboard(text: string, sectionName: string) {
    void navigator.clipboard.writeText(text);
    setCopiedSection(sectionName);
    setTimeout(() => setCopiedSection(null), 2000);
  }

  const fullDraftText = `${draft.caption}\n${draft.script}\n${draft.cta}`;

  if (isEditing) {
    return (
      <GlassCard className="mt-6 space-y-4 p-5">
        <BrandComplianceMeter
          text={fullDraftText}
          declared={declaredBrand}
          onFixWithAi={handleAutoFix}
          isFixing={isFixing}
        />

        <div className="flex items-center justify-between">
          <p className="label-mono text-brand-teal">Edit Draft Sections</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setIsEditing(false)}
          >
            Cancel
          </Button>
        </div>

        <form action={formAction} className="space-y-4">
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <input type="hidden" name="contentId" value={contentId} />

          <div>
            <label className="label-mono text-xs text-muted-foreground">Caption</label>
            <Textarea
              name="caption"
              rows={4}
              value={draft.caption}
              onChange={(e) => setDraft((d) => ({ ...d, caption: e.target.value }))}
              className="mt-1"
            />
          </div>

          <div>
            <label className="label-mono text-xs text-muted-foreground">Script</label>
            <Textarea
              name="script"
              rows={4}
              value={draft.script}
              onChange={(e) => setDraft((d) => ({ ...d, script: e.target.value }))}
              className="mt-1"
            />
          </div>

          <div>
            <label className="label-mono text-xs text-muted-foreground">Hashtags</label>
            <Input
              name="hashtags"
              value={draft.hashtags}
              onChange={(e) => setDraft((d) => ({ ...d, hashtags: e.target.value }))}
              className="mt-1"
            />
          </div>

          <div>
            <label className="label-mono text-xs text-muted-foreground">Call to Action (CTA)</label>
            <Input
              name="cta"
              value={draft.cta}
              onChange={(e) => setDraft((d) => ({ ...d, cta: e.target.value }))}
              className="mt-1"
            />
          </div>

          {state?.error ? (
            <p className="text-xs text-destructive">{state.error}</p>
          ) : null}

          <div className="flex justify-end pt-2">
            <SaveButton />
          </div>
        </form>
      </GlassCard>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      <BrandComplianceMeter
        text={`${initialDraft.caption}\n${initialDraft.script}\n${initialDraft.cta}`}
        declared={declaredBrand}
        onFixWithAi={handleAutoFix}
        isFixing={isFixing}
      />

      <div className="flex items-center justify-between">
        <p className="label-mono text-brand-teal">Draft Sections</p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setIsEditing(true)}
        >
          Edit Sections
        </Button>
      </div>

      <GlassCard className="p-5">
        <div className="flex items-center justify-between">
          <p className="label-mono text-brand-teal">Caption</p>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => copyToClipboard(initialDraft.caption, "caption")}
          >
            {copiedSection === "caption" ? "Copied!" : "Copy"}
          </Button>
        </div>
        <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">
          {initialDraft.caption}
        </p>
      </GlassCard>

      <GlassCard className="p-5">
        <div className="flex items-center justify-between">
          <p className="label-mono text-brand-teal">Script</p>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => copyToClipboard(initialDraft.script, "script")}
          >
            {copiedSection === "script" ? "Copied!" : "Copy"}
          </Button>
        </div>
        <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">
          {initialDraft.script}
        </p>
      </GlassCard>

      <GlassCard className="p-5">
        <div className="flex items-center justify-between">
          <p className="label-mono text-brand-teal">Hashtags</p>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => copyToClipboard(initialDraft.hashtags.join(" "), "hashtags")}
          >
            {copiedSection === "hashtags" ? "Copied!" : "Copy"}
          </Button>
        </div>
        <p className="mt-2 font-mono text-sm text-muted-foreground">
          {initialDraft.hashtags.join(" ")}
        </p>
      </GlassCard>

      <GlassCard className="p-5">
        <div className="flex items-center justify-between">
          <p className="label-mono text-brand-teal">CTA</p>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => copyToClipboard(initialDraft.cta, "cta")}
          >
            {copiedSection === "cta" ? "Copied!" : "Copy"}
          </Button>
        </div>
        <p className="mt-2 text-sm text-foreground">{initialDraft.cta}</p>
      </GlassCard>
    </div>
  );
}
