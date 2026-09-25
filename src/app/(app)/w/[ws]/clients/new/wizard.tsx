"use client";

import { useState, useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { BrandContext } from "@/db/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GlassCard } from "@/components/glass-card";
import { ChipSelect } from "@/components/brand/chip-select";
import { ColorPaletteInput } from "@/components/brand/color-palette-input";
import { TagInput } from "@/components/brand/tag-input";
import { cn } from "@/lib/utils";
import {
  createClientWithContext,
  type CreateClientState,
} from "./actions";

import {
  BRAND_TYPES,
  PILLAR_OPTIONS,
  TONE_OPTIONS,
} from "@/components/brand/constants";

const STEPS = [
  "Client profile",
  "Positioning",
  "Voice & rules",
  "Visual identity",
  "Review & create",
] as const;

type WizardData = {
  name: string;
  handle: string;
  website: string;
  instagram: string;
  facebook: string;
  brandType: BrandContext["brandType"] | null;
  mission: string;
  showcaseTheme: string;
  tones: string[];
  pillars: string[];
  bannedWords: string[];
  avoidTopics: string[];
  colors: string[];
  typography: string;
  logoUrl: string;
};

const INITIAL: WizardData = {
  name: "",
  handle: "",
  website: "",
  instagram: "",
  facebook: "",
  brandType: null,
  mission: "",
  showcaseTheme: "",
  tones: [],
  pillars: [],
  bannedWords: [],
  avoidTopics: [],
  colors: [],
  typography: "",
  logoUrl: "",
};

function toPayload(workspaceId: string, data: WizardData) {
  return JSON.stringify({
    workspaceId,
    name: data.name,
    handle: data.handle,
    context: {
      brandType: data.brandType,
      mission: data.mission,
      showcaseTheme: data.showcaseTheme,
      tones: data.tones,
      pillars: data.pillars,
      bannedWords: data.bannedWords,
      avoidTopics: data.avoidTopics,
      colors: data.colors,
      typography: data.typography,
      logoUrl: data.logoUrl,
      links: {
        website: data.website,
        instagram: data.instagram,
        facebook: data.facebook,
      },
    },
  });
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Creating client…" : "Create client"}
    </Button>
  );
}

export function IntakeWizard({ workspaceId }: { workspaceId: string }) {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<WizardData>(INITIAL);
  const [stepError, setStepError] = useState<string | null>(null);
  const [state, formAction] = useActionState<CreateClientState, FormData>(
    createClientWithContext,
    undefined,
  );

  const patch = (partial: Partial<WizardData>) => {
    setStepError(null);
    setData((d) => ({ ...d, ...partial }));
  };

  const next = () => {
    if (step === 0 && data.name.trim().length < 2) {
      setStepError("Give the client a name (2+ characters).");
      return;
    }
    if (step === 1) {
      if (!data.brandType) {
        setStepError("Pick the branding type that fits best.");
        return;
      }
      if (data.mission.trim().length < 4) {
        setStepError("Add a 1–2 sentence mission.");
        return;
      }
      if (data.showcaseTheme.trim().length < 2) {
        setStepError("Describe the showcase theme.");
        return;
      }
    }
    setStepError(null);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  return (
    <div>
      <ol className="flex flex-wrap gap-2" aria-label="Intake steps">
        {STEPS.map((name, i) => (
          <li
            key={name}
            className={cn(
              "rounded-full border px-3 py-1 text-xs",
              i === step
                ? "border-brand-teal/60 text-brand-teal"
                : i < step
                  ? "border-border text-muted-foreground"
                  : "border-border text-muted-foreground/50",
            )}
          >
            {i + 1}. {name}
          </li>
        ))}
      </ol>

      <GlassCard className="mt-6 space-y-5 p-6">
        {step === 0 ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="name">Client name</Label>
              <Input
                id="name"
                value={data.name}
                onChange={(e) => patch({ name: e.target.value })}
                placeholder="Aurora Skincare"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="handle">Instagram handle (optional)</Label>
              <Input
                id="handle"
                value={data.handle}
                onChange={(e) => patch({ handle: e.target.value })}
                placeholder="@aurora.skincare"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="website">Website</Label>
                <Input
                  id="website"
                  value={data.website}
                  onChange={(e) => patch({ website: e.target.value })}
                  placeholder="aurora-skincare.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="instagram">Instagram URL</Label>
                <Input
                  id="instagram"
                  value={data.instagram}
                  onChange={(e) => patch({ instagram: e.target.value })}
                  placeholder="instagram.com/aurora.skincare"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="facebook">Facebook URL</Label>
                <Input
                  id="facebook"
                  value={data.facebook}
                  onChange={(e) => patch({ facebook: e.target.value })}
                  placeholder="facebook.com/aurora.skincare"
                />
              </div>
            </div>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <div>
              <p className="label-mono text-muted-foreground/70">Branding type</p>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {BRAND_TYPES.map((type) => (
                  <button
                    key={type.value}
                    type="button"
                    onClick={() => patch({ brandType: type.value })}
                    aria-pressed={data.brandType === type.value}
                    className={cn(
                      "rounded-lg border p-3 text-left transition",
                      data.brandType === type.value
                        ? "border-brand-teal/60 bg-brand-teal/10"
                        : "border-border hover:border-border",
                    )}
                  >
                    <p className="text-sm font-medium text-foreground">
                      {type.title}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground/70">{type.blurb}</p>
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mission">Mission (1–2 sentences)</Label>
              <Input
                id="mission"
                value={data.mission}
                onChange={(e) => patch({ mission: e.target.value })}
                placeholder="Barrier repair, without the guesswork"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="showcaseTheme">Theme of showcasing</Label>
              <Input
                id="showcaseTheme"
                value={data.showcaseTheme}
                onChange={(e) => patch({ showcaseTheme: e.target.value })}
                placeholder="Minimal, warm, editorial"
              />
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <ChipSelect
              label="Tone of voice"
              options={TONE_OPTIONS}
              value={data.tones}
              onChange={(tones) => patch({ tones })}
            />
            <ChipSelect
              label="Content pillars"
              options={PILLAR_OPTIONS}
              value={data.pillars}
              onChange={(pillars) => patch({ pillars })}
              accent="purple"
            />
            <TagInput
              label="Banned words"
              hint="Hard rules — these can never appear in generated content."
              value={data.bannedWords}
              onChange={(bannedWords) => patch({ bannedWords })}
              placeholder='e.g. "cure", "clinical claims"'
            />
            <TagInput
              label="Topics to avoid"
              hint="Softer guidance the AI steers around."
              value={data.avoidTopics}
              onChange={(avoidTopics) => patch({ avoidTopics })}
              placeholder="e.g. competitor comparisons"
              accent="purple"
            />
          </>
        ) : null}

        {step === 3 ? (
          <>
            <ColorPaletteInput
              value={data.colors}
              onChange={(colors) => patch({ colors })}
            />
            <div className="space-y-1.5">
              <Label htmlFor="typography">Typography (optional)</Label>
              <Input
                id="typography"
                value={data.typography}
                onChange={(e) => patch({ typography: e.target.value })}
                placeholder="Serif display / clean sans body"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="logoUrl">Logo URL (optional)</Label>
              <Input
                id="logoUrl"
                value={data.logoUrl}
                onChange={(e) => patch({ logoUrl: e.target.value })}
                placeholder="https://…/logo.png"
              />
            </div>
          </>
        ) : null}

        {step === 4 ? (
          <div className="space-y-4">
            <div>
              <p className="label-mono text-muted-foreground/70">Client</p>
              <p className="mt-1 text-sm text-foreground">
                {data.name}
                {data.handle ? ` · ${data.handle}` : ""}
              </p>
            </div>
            <div>
              <p className="label-mono text-muted-foreground/70">Positioning</p>
              <p className="mt-1 text-sm text-foreground">
                {BRAND_TYPES.find((t) => t.value === data.brandType)?.title} —{" "}
                {data.mission}
              </p>
              <p className="mt-1 text-xs text-muted-foreground/70">
                Theme: {data.showcaseTheme}
              </p>
            </div>
            {data.tones.length + data.pillars.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {data.tones.map((t) => (
                  <Badge
                    key={t}
                    variant="outline"
                    className="border-brand-teal/40 text-brand-teal"
                  >
                    {t}
                  </Badge>
                ))}
                {data.pillars.map((p) => (
                  <Badge
                    key={p}
                    variant="outline"
                    className="border-brand-purple/40 text-brand-purple"
                  >
                    {p}
                  </Badge>
                ))}
              </div>
            ) : null}
            {data.bannedWords.length > 0 ? (
              <div>
                <p className="label-mono text-brand-amber">Never say</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {data.bannedWords.join(", ")}
                </p>
              </div>
            ) : null}
            {data.colors.length > 0 ? (
              <div className="flex items-center gap-2">
                {data.colors.map((c, i) => (
                  <span
                    key={`${c}-${i}`}
                    title={c}
                    className="inline-block h-6 w-6 rounded-full border border-border"
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground/70">
              After creating you can optionally enrich with AI research or seed
              the knowledge base — neither is required to start ideating.
            </p>
          </div>
        ) : null}

        {stepError ? (
          <p className="text-sm text-destructive">{stepError}</p>
        ) : null}
        {state?.error ? (
          <p className="text-sm text-destructive">{state.error}</p>
        ) : null}

        <div className="flex items-center justify-between pt-2">
          <Button
            type="button"
            variant="ghost"
            disabled={step === 0}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
          >
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button type="button" onClick={next}>
              Continue
            </Button>
          ) : (
            <form action={formAction}>
              <input
                type="hidden"
                name="payload"
                value={toPayload(workspaceId, data)}
              />
              <SubmitButton />
            </form>
          )}
        </div>
      </GlassCard>
    </div>
  );
}
