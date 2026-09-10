"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import type { BrandContext } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GlassCard } from "@/components/glass-card";
import { ChipSelect } from "@/components/brand/chip-select";
import { ColorPaletteInput } from "@/components/brand/color-palette-input";
import { TagInput } from "@/components/brand/tag-input";
import {
  BRAND_TYPES,
  PILLAR_OPTIONS,
  TONE_OPTIONS,
} from "@/components/brand/constants";
import { cn } from "@/lib/utils";
import { updateBrandContext, type VaultActionState } from "./actions";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save vault"}
    </Button>
  );
}

/**
 * The Brand DNA Vault: human-declared context, editable forever. Saving
 * replaces `declared` only — AI enrichment is never touched here.
 */
import { BrandDnaCollage } from "@/components/brand/brand-dna-collage";

export function VaultEditor({
  workspaceId,
  clientId,
  declared,
  stale,
}: {
  workspaceId: string;
  clientId: string;
  declared: BrandContext;
  stale: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<BrandContext>(declared);
  const [state, formAction] = useFormState<VaultActionState, FormData>(
    updateBrandContext,
    undefined,
  );
  const lastSaved = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (state?.savedAt && state.savedAt !== lastSaved.current) {
      lastSaved.current = state.savedAt;
      setEditing(false);
    }
  }, [state]);

  const patch = (partial: Partial<BrandContext>) =>
    setDraft((d) => ({ ...d, ...partial }));

  if (!editing) {
    return (
      <BrandDnaCollage
        declared={declared}
        stale={stale}
        onEdit={() => {
          setDraft(declared);
          setEditing(true);
        }}
      />
    );
  }

  return (
    <GlassCard className="space-y-5 p-6">
      <p className="label-mono text-muted-foreground/70">Edit Brand DNA Vault</p>

      <div>
        <p className="label-mono text-muted-foreground/70">Branding type</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {BRAND_TYPES.map((type) => (
            <button
              key={type.value}
              type="button"
              onClick={() => patch({ brandType: type.value })}
              aria-pressed={draft.brandType === type.value}
              className={cn(
                "rounded-lg border px-3 py-2 text-left text-sm transition",
                draft.brandType === type.value
                  ? "border-brand-teal/60 bg-brand-teal/10 text-foreground"
                  : "border-border text-muted-foreground hover:border-border",
              )}
            >
              {type.title}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="vault-mission">Mission</Label>
        <Input
          id="vault-mission"
          value={draft.mission}
          onChange={(e) => patch({ mission: e.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="vault-theme">Theme of showcasing</Label>
        <Input
          id="vault-theme"
          value={draft.showcaseTheme}
          onChange={(e) => patch({ showcaseTheme: e.target.value })}
        />
      </div>

      <ChipSelect
        label="Tone of voice"
        options={TONE_OPTIONS}
        value={draft.tones}
        onChange={(tones) => patch({ tones })}
      />
      <ChipSelect
        label="Content pillars"
        options={PILLAR_OPTIONS}
        value={draft.pillars}
        onChange={(pillars) => patch({ pillars })}
        accent="purple"
      />
      <TagInput
        label="Banned words"
        hint="Hard rules — enforced deterministically on every draft."
        value={draft.bannedWords}
        onChange={(bannedWords) => patch({ bannedWords })}
      />
      <TagInput
        label="Topics to avoid"
        value={draft.avoidTopics}
        onChange={(avoidTopics) => patch({ avoidTopics })}
        accent="purple"
      />
      <ColorPaletteInput
        value={draft.colors}
        onChange={(colors) => patch({ colors })}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="vault-typography">Typography</Label>
          <Input
            id="vault-typography"
            value={draft.typography ?? ""}
            onChange={(e) => patch({ typography: e.target.value || null })}
            placeholder="Serif display / clean sans body"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="vault-logo">Logo URL</Label>
          <Input
            id="vault-logo"
            value={draft.logoUrl ?? ""}
            onChange={(e) => patch({ logoUrl: e.target.value || null })}
            placeholder="https://…/logo.png"
          />
        </div>
      </div>

      {state?.error ? (
        <p className="text-sm text-destructive">{state.error}</p>
      ) : null}

      <div className="flex items-center justify-between pt-1">
        <Button
          type="button"
          variant="ghost"
          onClick={() => setEditing(false)}
        >
          Cancel
        </Button>
        <form action={formAction}>
          <input
            type="hidden"
            name="payload"
            value={JSON.stringify({ workspaceId, clientId, context: draft })}
          />
          <SaveButton />
        </form>
      </div>
    </GlassCard>
  );
}
