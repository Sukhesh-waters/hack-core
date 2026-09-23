"use client";

import { useEffect, useState, useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { GlassCard } from "@/components/glass-card";
import { TagInput } from "@/components/brand/tag-input";
import { cn } from "@/lib/utils";
import {
  createCampaignWithApproval,
  type CreateCampaignState,
} from "./actions";
import {
  analyzeContentForAdsAction,
  generateCampaignStrategyAction,
} from "../intelligence-actions";
import type { AdSuitabilityResult } from "@/lib/ai/agents/critic";
import type { CampaignStrategy } from "@/lib/ai/agents/strategy";

const STEPS = [
  "AI Strategy",
  "Objective",
  "Audience",
  "Budget & schedule",
  "Creative",
  "Review & launch",
] as const;

const OBJECTIVES = [
  { value: "awareness", title: "Awareness", blurb: "Get seen by more people" },
  { value: "traffic", title: "Traffic", blurb: "Drive clicks to a link" },
  { value: "engagement", title: "Engagement", blurb: "Likes, comments, shares" },
  { value: "leads", title: "Leads", blurb: "Capture contact info" },
  { value: "conversions", title: "Conversions", blurb: "Drive a purchase/signup" },
] as const;

type Objective = (typeof OBJECTIVES)[number]["value"];

type WizardData = {
  clientId: string;
  name: string;
  objective: Objective | null;
  demographics: string;
  interests: string[];
  locations: string[];
  budget: string;
  startDate: string;
  endDate: string;
  creativeContentId: string;
  creativeNote: string;
};

const INITIAL: WizardData = {
  clientId: "",
  name: "",
  objective: null,
  demographics: "",
  interests: [],
  locations: [],
  budget: "",
  startDate: "",
  endDate: "",
  creativeContentId: "",
  creativeNote: "",
};

function toPayload(workspaceId: string, data: WizardData) {
  return JSON.stringify({
    workspaceId,
    clientId: data.clientId,
    name: data.name,
    objective: data.objective,
    audience: {
      demographics: data.demographics,
      interests: data.interests,
      locations: data.locations,
    },
    budget: data.budget,
    startDate: data.startDate,
    endDate: data.endDate,
    creativeContentId: data.creativeContentId,
    creativeNote: data.creativeNote,
  });
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Launching…" : "Launch campaign"}
    </Button>
  );
}

export function CampaignWizard({
  workspaceId,
  clients,
  contentByClient,
}: {
  workspaceId: string;
  clients: { id: string; name: string }[];
  contentByClient: Record<
    string,
    { id: string; title: string; type: string }[]
  >;
}) {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<WizardData>(INITIAL);
  const [stepError, setStepError] = useState<string | null>(null);
  const [state, formAction] = useActionState<CreateCampaignState, FormData>(
    createCampaignWithApproval,
    undefined,
  );

  // AI Strategy State
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const [aiSuitability, setAiSuitability] = useState<AdSuitabilityResult[] | null>(null);
  const [aiStrategy, setAiStrategy] = useState<CampaignStrategy | null>(null);
  const [aiCriticFeedback, setAiCriticFeedback] = useState<string[]>([]);
  const [aiError, setAiError] = useState<string | null>(null);
  const [selectedTopContentId, setSelectedTopContentId] = useState<string | null>(null);

  const patch = (partial: Partial<WizardData>) => {
    setStepError(null);
    setData((d) => ({ ...d, ...partial }));
  };

  useEffect(() => {
    if (!clients.some((c) => c.id === data.clientId) && clients.length > 0) {
      patch({ clientId: clients[0].id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGenerateAI = async () => {
    if (!data.clientId) {
      setStepError("Pick a client first.");
      return;
    }
    setAiError(null);
    setIsGeneratingAI(true);
    try {
      const [suitabilityRes, strategyRes] = await Promise.all([
        analyzeContentForAdsAction(workspaceId, data.clientId),
        generateCampaignStrategyAction(workspaceId, data.clientId),
      ]);
      
      if (suitabilityRes.error) throw new Error(suitabilityRes.error);
      if (strategyRes.error) throw new Error(strategyRes.error);
      
      setAiSuitability(suitabilityRes.rankings ?? null);
      setAiStrategy(strategyRes.strategy ?? null);
      setAiCriticFeedback(strategyRes.criticFeedback ?? []);

      if (suitabilityRes.rankings && suitabilityRes.rankings.length > 0) {
        setSelectedTopContentId(suitabilityRes.rankings[0].contentId);
      }
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "Failed to generate AI strategy.");
    } finally {
      setIsGeneratingAI(false);
    }
  };

  const applyAISuggestions = () => {
    if (!aiStrategy) return;
    patch({
      objective: aiStrategy.recommendedObjective,
      budget: aiStrategy.recommendedBudgetRange.min.toString(),
      demographics: aiStrategy.audienceSuggestion,
      creativeContentId: selectedTopContentId ?? "",
      creativeNote: aiStrategy.adCopyVariants[0] ?? "",
      name: `AI Campaign: ${aiStrategy.recommendedObjective}`,
    });
    setStep(1); // Move to Objective step to review
  };

  const next = () => {
    if (step === 1) { // Objective step (previously 0)
      if (!data.clientId) {
        setStepError("Pick a client.");
        return;
      }
      if (data.name.trim().length < 2) {
        setStepError("Give the campaign a name (2+ characters).");
        return;
      }
      if (!data.objective) {
        setStepError("Pick an objective.");
        return;
      }
    }
    if (step === 3) { // Budget step (previously 2)
      const budgetNum = Number(data.budget);
      if (!data.budget || Number.isNaN(budgetNum) || budgetNum <= 0) {
        setStepError("Budget must be a positive number.");
        return;
      }
      if (!data.startDate) {
        setStepError("Pick a start date.");
        return;
      }
    }
    setStepError(null);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const clientContent = contentByClient[data.clientId] ?? [];

  return (
    <div>
      <ol className="flex flex-wrap gap-2" aria-label="Campaign builder steps">
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
            {i === 0 ? "★" : i}. {name}
          </li>
        ))}
      </ol>

      <GlassCard className="mt-6 space-y-5 p-6">
        {step === 0 ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="client_ai">Client</Label>
              <select
                id="client_ai"
                value={data.clientId}
                onChange={(e) => {
                  patch({ clientId: e.target.value });
                  setAiSuitability(null);
                  setAiStrategy(null);
                  setAiCriticFeedback([]);
                }}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
              >
                {clients.map((c) => (
                  <option key={c.id} value={c.id} className="bg-popover">
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            
            <div className="rounded-lg border border-brand-purple/20 bg-brand-purple/5 p-6">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-display text-lg text-brand-purple">AI Strategy Generation</h3>
                  <p className="mt-1 text-sm text-muted-foreground/80">
                    Analyze market trends and organic content to generate a data-backed campaign brief.
                    You can review and edit all suggestions before launching.
                  </p>
                </div>
                <Button 
                  onClick={handleGenerateAI} 
                  disabled={isGeneratingAI}
                  className="bg-brand-purple text-brand-purple-foreground hover:bg-brand-purple/90"
                >
                  {isGeneratingAI ? "Analyzing..." : "Generate AI Strategy"}
                </Button>
              </div>

              {aiError && (
                <p className="mt-4 text-sm text-destructive">{aiError}</p>
              )}

              {aiStrategy && (
                <div className="mt-6 space-y-6 border-t border-brand-purple/20 pt-6">
                  <div>
                    <p className="label-mono text-muted-foreground/70">Recommended Strategy</p>
                    <p className="mt-1 text-sm text-foreground/90">{aiStrategy.strategySummary}</p>
                  </div>
                  
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="rounded-md border border-border p-3">
                      <p className="label-mono text-muted-foreground/70">Objective</p>
                      <p className="mt-1 text-sm font-medium capitalize text-brand-teal">
                        {aiStrategy.recommendedObjective}
                      </p>
                    </div>
                    <div className="rounded-md border border-border p-3">
                      <p className="label-mono text-muted-foreground/70">Suggested Budget</p>
                      <p className="mt-1 text-sm font-medium text-brand-amber">
                        ${aiStrategy.recommendedBudgetRange.min} - ${aiStrategy.recommendedBudgetRange.max}
                      </p>
                    </div>
                  </div>

                  <div>
                    <p className="label-mono text-muted-foreground/70">Audience Targeting</p>
                    <p className="mt-1 text-sm text-foreground/90">{aiStrategy.audienceSuggestion}</p>
                  </div>

                  {aiCriticFeedback.length > 0 && (
                    <div className="rounded-md border border-brand-amber/40 bg-brand-amber/5 p-3">
                      <p className="label-mono text-brand-amber">Independent review flagged</p>
                      <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-foreground/80">
                        {aiCriticFeedback.map((note, i) => (
                          <li key={i}>{note}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {aiSuitability && aiSuitability.length > 0 && (
                    <div>
                      <p className="label-mono text-muted-foreground/70">Top Organic Posts for Ads</p>
                      <div className="mt-2 space-y-2">
                        {aiSuitability.slice(0, 3).map((item) => (
                          <div 
                            key={item.contentId}
                            className={cn(
                              "flex cursor-pointer items-start justify-between rounded-md border p-3 transition",
                              selectedTopContentId === item.contentId
                                ? "border-brand-teal/60 bg-brand-teal/10"
                                : "border-border hover:border-brand-teal/40"
                            )}
                            onClick={() => setSelectedTopContentId(item.contentId)}
                          >
                            <div>
                              <p className="text-sm font-medium">
                                {clientContent.find(c => c.id === item.contentId)?.title ?? "Unknown Content"}
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground/80 line-clamp-1">
                                {item.reasoning}
                              </p>
                            </div>
                            <div className="shrink-0 text-right">
                              <Badge variant="secondary" className="bg-background">
                                {item.suitabilityScore} score
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex justify-end pt-2">
                    <Button onClick={applyAISuggestions} variant="outline" className="border-brand-teal text-brand-teal hover:bg-brand-teal/10 hover:text-brand-teal">
                      Apply AI Suggestions
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="client">Client</Label>
              <select
                id="client"
                value={data.clientId}
                onChange={(e) => patch({ clientId: e.target.value })}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
              >
                {clients.map((c) => (
                  <option key={c.id} value={c.id} className="bg-popover">
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="name">Campaign name</Label>
              <Input
                id="name"
                value={data.name}
                onChange={(e) => patch({ name: e.target.value })}
                placeholder="Spring skincare push"
              />
            </div>
            <div>
              <p className="label-mono text-muted-foreground/70">Objective</p>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {OBJECTIVES.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => patch({ objective: o.value })}
                    aria-pressed={data.objective === o.value}
                    className={cn(
                      "rounded-lg border p-3 text-left transition",
                      data.objective === o.value
                        ? "border-brand-teal/60 bg-brand-teal/10"
                        : "border-border hover:border-border",
                    )}
                  >
                    <p className="text-sm font-medium text-foreground">
                      {o.title}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground/70">{o.blurb}</p>
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="demographics">Demographics (optional)</Label>
              <Input
                id="demographics"
                value={data.demographics}
                onChange={(e) => patch({ demographics: e.target.value })}
                placeholder="Women 25-45, skincare-interested"
              />
            </div>
            <TagInput
              label="Interests"
              value={data.interests}
              onChange={(interests) => patch({ interests })}
              placeholder="e.g. skincare, clean beauty"
            />
            <TagInput
              label="Locations"
              value={data.locations}
              onChange={(locations) => patch({ locations })}
              placeholder="e.g. United States, Canada"
              accent="purple"
            />
          </>
        ) : null}

        {step === 3 ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="budget">Planned budget ($)</Label>
              <Input
                id="budget"
                type="number"
                min="0"
                step="0.01"
                value={data.budget}
                onChange={(e) => patch({ budget: e.target.value })}
                placeholder="500"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="startDate">Start</Label>
                <input
                  id="startDate"
                  type="datetime-local"
                  value={data.startDate}
                  onChange={(e) => patch({ startDate: e.target.value })}
                  className="w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm [color-scheme:dark]"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="endDate">End (optional)</Label>
                <input
                  id="endDate"
                  type="datetime-local"
                  value={data.endDate}
                  onChange={(e) => patch({ endDate: e.target.value })}
                  className="w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm [color-scheme:dark]"
                />
              </div>
            </div>
          </>
        ) : null}

        {step === 4 ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="creativeContentId">
                Link an existing draft (optional)
              </Label>
              <select
                id="creativeContentId"
                value={data.creativeContentId}
                onChange={(e) =>
                  patch({ creativeContentId: e.target.value })
                }
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
              >
                <option value="" className="bg-popover">
                  None
                </option>
                {clientContent.map((c) => (
                  <option key={c.id} value={c.id} className="bg-popover">
                    {c.title} ({c.type})
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="creativeNote">Creative note (optional)</Label>
              <Textarea
                id="creativeNote"
                value={data.creativeNote}
                onChange={(e) => patch({ creativeNote: e.target.value })}
                placeholder="Describe the creative direction if not linking a draft"
                className="min-h-[120px]"
              />
              {aiStrategy && aiStrategy.adCopyVariants.length > 0 && (
                <div className="mt-3 rounded border border-brand-purple/30 bg-brand-purple/5 p-3">
                  <p className="text-xs font-medium text-brand-purple mb-2">AI Generated Ad Copy Variants</p>
                  <ul className="space-y-2 text-sm text-foreground/80 list-disc pl-4">
                    {aiStrategy.adCopyVariants.map((copy, i) => (
                      <li key={i}>{copy}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </>
        ) : null}

        {step === 5 ? (
          <div className="space-y-4">
            <div>
              <p className="label-mono text-muted-foreground/70">Campaign</p>
              <p className="mt-1 text-sm text-foreground">
                {data.name} —{" "}
                {OBJECTIVES.find((o) => o.value === data.objective)?.title}
              </p>
            </div>
            <div>
              <p className="label-mono text-muted-foreground/70">Budget & schedule</p>
              <p className="mt-1 text-sm text-foreground">
                ${data.budget} · starts {data.startDate || "—"}
                {data.endDate ? ` · ends ${data.endDate}` : ""}
              </p>
            </div>
            {data.interests.length + data.locations.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {data.interests.map((i) => (
                  <Badge
                    key={i}
                    variant="outline"
                    className="border-brand-teal/40 text-brand-teal"
                  >
                    {i}
                  </Badge>
                ))}
                {data.locations.map((l) => (
                  <Badge
                    key={l}
                    variant="outline"
                    className="border-brand-purple/40 text-brand-purple"
                  >
                    {l}
                  </Badge>
                ))}
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground/70">
              Launching sends this for approval in Team Hub — it goes active
              once approved, no live spend happens until then.
            </p>
          </div>
        ) : null}

        {stepError ? (
          <p className="text-sm text-destructive">{stepError}</p>
        ) : null}
        {state?.error ? (
          <p className="text-sm text-destructive">{state.error}</p>
        ) : null}

        <div className="flex items-center justify-between pt-2 border-t border-border mt-4">
          <Button
            type="button"
            variant="ghost"
            disabled={step === 0}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
          >
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <div className="flex gap-2">
              {step === 0 && (
                <Button type="button" variant="ghost" onClick={() => next()}>
                  Skip AI Strategy
                </Button>
              )}
              <Button type="button" onClick={next}>
                {step === 0 ? "Continue Manually" : "Continue"}
              </Button>
            </div>
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
