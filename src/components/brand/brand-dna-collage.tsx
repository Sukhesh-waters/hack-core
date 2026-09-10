"use client";

import { useState } from "react";
import { Check, Copy, Sparkles, Type } from "lucide-react";
import type { BrandContext } from "@/db/schema";
import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/glass-card";

export function BrandDnaCollage({
  declared,
  stale,
  onEdit,
}: {
  declared: BrandContext;
  stale?: boolean;
  onEdit?: () => void;
}) {
  const [copiedHex, setCopiedHex] = useState<string | null>(null);

  function copyHex(hex: string) {
    void navigator.clipboard.writeText(hex);
    setCopiedHex(hex);
    setTimeout(() => setCopiedHex(null), 1500);
  }

  return (
    <div className="space-y-6">
      {/* Brand Header & Mission Banner */}
      <GlassCard className="relative overflow-hidden p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-brand-teal/20 text-brand-teal">
              <Sparkles className="size-4" />
            </span>
            <span className="label-mono text-xs text-brand-teal">
              Brand DNA Profile
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="border-brand-teal/40 capitalize text-brand-teal"
            >
              {declared.brandType.replace(/_/g, " ")}
            </Badge>
            {onEdit ? (
              <button
                type="button"
                onClick={onEdit}
                className="rounded-md border border-border bg-popover px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Edit Vault
              </button>
            ) : null}
          </div>
        </div>

        {stale ? (
          <p className="mt-4 rounded-md border border-brand-amber/30 bg-brand-amber/10 px-3 py-2 text-xs text-brand-amber">
            Enrichment may be stale — the vault was modified after the last AI
            research run.
          </p>
        ) : null}

        <div className="mt-4">
          <p className="font-serif text-lg font-normal italic leading-relaxed text-foreground sm:text-xl">
            &ldquo;{declared.mission}&rdquo;
          </p>
        </div>
      </GlassCard>

      {/* Grid of DNA Artifacts */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Color Palette Artifact Card */}
        <GlassCard className="flex flex-col justify-between p-5">
          <div>
            <div className="flex items-center justify-between border-b border-border pb-2">
              <span className="label-mono text-xs text-muted-foreground/70">
                Palette & Swatches
              </span>
              <span className="text-[10px] text-muted-foreground/50">
                {declared.colors.length} shades
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2.5">
              {declared.colors.map((hex, index) => {
                const isCopied = copiedHex === hex;
                return (
                  <button
                    key={`${hex}-${index}`}
                    type="button"
                    onClick={() => copyHex(hex)}
                    className="group relative flex flex-col items-start overflow-hidden rounded-lg border border-border bg-background/60 p-2 text-left transition hover:border-brand-teal/50 hover:bg-muted/40"
                  >
                    <div
                      className="h-10 w-full rounded-md shadow-inner transition group-hover:scale-[1.02]"
                      style={{ backgroundColor: hex }}
                    />
                    <div className="mt-2 flex w-full items-center justify-between">
                      <span className="font-mono text-xs font-medium text-foreground">
                        {hex}
                      </span>
                      <span className="text-muted-foreground transition group-hover:text-foreground">
                        {isCopied ? (
                          <Check className="size-3 text-emerald-400" />
                        ) : (
                          <Copy className="size-3 opacity-0 group-hover:opacity-100" />
                        )}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </GlassCard>

        {/* Typography Specimen Artifact Card */}
        <GlassCard className="flex flex-col justify-between p-5">
          <div>
            <div className="flex items-center justify-between border-b border-border pb-2">
              <span className="label-mono text-xs text-muted-foreground/70">
                Typography Specimen
              </span>
              <Type className="size-3.5 text-muted-foreground/50" />
            </div>

            <div className="mt-4 space-y-3">
              <div className="rounded-lg border border-border/70 bg-background/60 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                  Headline Style
                </div>
                <div className="mt-1 font-display text-2xl font-semibold text-foreground">
                  Aa Bb Cc
                </div>
                <div className="text-xs text-muted-foreground/70">
                  {declared.typography || "Display Serif & Modern Sans"}
                </div>
              </div>

              <div className="rounded-lg border border-border/70 bg-background/60 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                  Showcase Theme
                </div>
                <div className="mt-1 text-xs font-medium text-foreground">
                  {declared.showcaseTheme}
                </div>
              </div>
            </div>
          </div>
        </GlassCard>

        {/* Tone of Voice & Pillars Artifact Card */}
        <GlassCard className="flex flex-col justify-between p-5">
          <div>
            <div className="flex items-center justify-between border-b border-border pb-2">
              <span className="label-mono text-xs text-muted-foreground/70">
                Tone & Voice Pillars
              </span>
              <span className="text-[10px] text-muted-foreground/50">
                {declared.tones.length + declared.pillars.length} pillars
              </span>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                  Voice Attributes
                </span>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {declared.tones.map((tone) => (
                    <span
                      key={tone}
                      className="inline-flex items-center rounded-full border border-brand-teal/30 bg-brand-teal/10 px-2.5 py-0.5 text-xs font-medium text-brand-teal"
                    >
                      {tone}
                    </span>
                  ))}
                </div>
              </div>

              {declared.pillars.length > 0 ? (
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                    Content Themes
                  </span>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {declared.pillars.map((pillar) => (
                      <span
                        key={pillar}
                        className="inline-flex items-center rounded-full border border-brand-purple/30 bg-brand-purple/10 px-2.5 py-0.5 text-xs font-medium text-brand-purple"
                      >
                        {pillar}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </GlassCard>
      </div>

      {/* Guardrails Card (Never say & Avoid topics) */}
      {declared.bannedWords.length > 0 || declared.avoidTopics.length > 0 ? (
        <GlassCard className="p-5">
          <div className="flex items-center justify-between border-b border-border pb-2">
            <span className="label-mono text-xs text-brand-amber">
              Brand Guardrails
            </span>
          </div>

          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {declared.bannedWords.length > 0 ? (
              <div>
                <span className="text-xs font-medium text-foreground">
                  Never Say (Banned Words)
                </span>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {declared.bannedWords.map((word) => (
                    <span
                      key={word}
                      className="rounded bg-destructive/10 px-2 py-0.5 text-xs text-destructive line-through"
                    >
                      {word}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {declared.avoidTopics.length > 0 ? (
              <div>
                <span className="text-xs font-medium text-foreground">
                  Avoid Topics
                </span>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {declared.avoidTopics.map((topic) => (
                    <span
                      key={topic}
                      className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                    >
                      {topic}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </GlassCard>
      ) : null}
    </div>
  );
}
