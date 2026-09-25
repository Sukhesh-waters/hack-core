"use client";

import { useState } from "react";
import { Check, Copy, Film, Image as ImageIcon, Mic, Sparkles } from "lucide-react";
import { GlassCard } from "@/components/glass-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { MultimodalAssetPack } from "@/lib/ai/agents/content";

export function MultimodalAssetDrawer({
  assets,
}: {
  assets: MultimodalAssetPack;
}) {
  const [activeTab, setActiveTab] = useState<"storyboard" | "prompts" | "voiceover">(
    "storyboard",
  );
  const [copiedPrompt, setCopiedPrompt] = useState<string | null>(null);

  function copyPrompt(text: string, title: string) {
    void navigator.clipboard.writeText(text);
    setCopiedPrompt(title);
    setTimeout(() => setCopiedPrompt(null), 2000);
  }

  return (
    <GlassCard className="mt-6 space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-brand-teal" />
          <p className="label-mono text-xs text-foreground">
            Multi-Modal Creative Assets
          </p>
        </div>

        <div className="flex items-center gap-1.5 rounded-lg bg-background/60 p-1 border border-border">
          <button
            type="button"
            onClick={() => setActiveTab("storyboard")}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition ${
              activeTab === "storyboard"
                ? "bg-accent text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Film className="size-3.5" /> Storyboard
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("prompts")}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition ${
              activeTab === "prompts"
                ? "bg-accent text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <ImageIcon className="size-3.5" /> Image Prompts
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("voiceover")}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition ${
              activeTab === "voiceover"
                ? "bg-accent text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Mic className="size-3.5" /> Voiceover
          </button>
        </div>
      </div>

      {/* Tab 1: Video Storyboard */}
      {activeTab === "storyboard" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {assets.storyboard.map((scene) => (
            <div
              key={scene.sceneNumber}
              className="rounded-xl border border-border bg-background/50 p-3.5 space-y-2"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-brand-teal">
                  Scene {scene.sceneNumber}
                </span>
                <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground/70">
                  {scene.timecode}
                </Badge>
              </div>

              <div>
                <p className="text-[11px] text-muted-foreground/70 uppercase tracking-wider">
                  Visual Direction
                </p>
                <p className="mt-0.5 text-xs text-foreground leading-relaxed">
                  {scene.visualDescription}
                </p>
              </div>

              {scene.onScreenText ? (
                <div className="rounded bg-accent/40 px-2.5 py-1.5">
                  <span className="text-[10px] text-muted-foreground/60 uppercase">
                    On-Screen Text:
                  </span>
                  <p className="text-xs font-medium text-foreground italic">
                    &ldquo;{scene.onScreenText}&rdquo;
                  </p>
                </div>
              ) : null}

              <p className="text-[11px] text-brand-purple/80">
                🎙️ {scene.audioGuidance}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {/* Tab 2: AI Image Prompts */}
      {activeTab === "prompts" ? (
        <div className="space-y-3">
          {assets.imagePrompts.map((p) => {
            const isCopied = copiedPrompt === p.title;
            return (
              <div
                key={p.title}
                className="rounded-xl border border-border bg-background/50 p-3.5 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-foreground">
                      {p.title}
                    </span>
                    <Badge variant="outline" className="text-[10px] text-brand-teal border-brand-teal/40">
                      {p.aspectRatio}
                    </Badge>
                  </div>

                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => copyPrompt(p.prompt, p.title)}
                    className="h-7 px-2.5 text-xs"
                  >
                    {isCopied ? (
                      <>
                        <Check className="mr-1 size-3 text-emerald-400" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="mr-1 size-3" /> Copy Prompt
                      </>
                    )}
                  </Button>
                </div>

                <p className="font-mono text-xs text-muted-foreground rounded bg-accent/30 p-2.5 leading-relaxed selection:bg-brand-teal selection:text-primary-foreground">
                  {p.prompt}
                </p>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* Tab 3: Voiceover Script */}
      {activeTab === "voiceover" ? (
        <div className="space-y-2.5">
          {assets.voiceover.map((line, idx) => (
            <div
              key={idx}
              className="flex items-start gap-3 rounded-lg border border-border bg-background/50 p-3"
            >
              <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground/70 shrink-0">
                {line.timestamp}
              </Badge>
              <div className="flex-1 min-w-0 space-y-1">
                <p className="text-xs font-semibold text-foreground">
                  {line.speaker}
                </p>
                <p className="text-xs text-foreground italic">
                  &ldquo;{line.line}&rdquo;
                </p>
                <p className="text-[10px] text-muted-foreground/70">
                  {line.direction}
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </GlassCard>
  );
}
