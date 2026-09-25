/**
 * The suggestion ledger's recorder (C8.5 T85.2). Pure: turns what the product
 * proposes (an opportunity, a campaign brief, an idea) into the record that
 * lets it be traced later — its inputs with their plane and weight, its
 * features, its factors, and the model and prompt that wrote it.
 *
 * Recording is best-effort and never blocks a page: the writer catches.
 */
import { createHash } from "node:crypto";
import type { SuggestionFeatures, SuggestionInput, SuggestionKind } from "@/db/platina-schema";
import type { LearnedCampaign } from "./opportunity-learning";
import type { Campaign } from "./opportunities";

export type SuggestionDraft = {
  kind: SuggestionKind;
  subjectKey: string;
  title: string;
  body: Record<string, unknown>;
  inputs: SuggestionInput[];
  features: SuggestionFeatures;
  factors: Record<string, number | string>;
  explore: boolean;
  weightsVersion: string;
  model?: string | null;
  promptVersion?: string | null;
};

/** Weights that sum to 1 (equal shares when none are given). */
export function normaliseWeights(inputs: SuggestionInput[]): SuggestionInput[] {
  const total = inputs.reduce((s, i) => s + Math.max(0, i.weight), 0);
  return inputs.map((i) => ({
    ...i,
    weight: Math.round((total > 0 ? Math.max(0, i.weight) / total : 1 / inputs.length) * 1000) / 1000,
  }));
}

/** Same title and inputs -> same hash: re-rendering a page records nothing new. */
export function inputHash(d: Pick<SuggestionDraft, "kind" | "subjectKey" | "title" | "inputs">): string {
  const refs = d.inputs.map((i) => i.ref).sort();
  return createHash("sha256").update(JSON.stringify([d.kind, d.subjectKey, d.title, refs])).digest("hex").slice(0, 32);
}

/** "under 30 days", "30-90 days", "over 90 days" — timing as a learnable feature. */
export function timingBucket(days: number | null): string | null {
  if (days === null || !Number.isFinite(days)) return null;
  return days < 30 ? "under 30 days" : days <= 90 ? "30-90 days" : "over 90 days";
}

const daysOut = (c: Campaign): number | null => {
  const m = /in (\d+) day/.exec(c.timing ?? "");
  return m ? Number(m[1]) : null;
};

/**
 * An opportunity card as a suggestion. Its inputs are its public proofs
 * (Plane B), weighted evenly: each is one reason on the card.
 */
export function campaignSuggestion(c: Campaign | LearnedCampaign, clientRegion: string | null, weightsVersion: string): SuggestionDraft {
  const proofs = c.proofs.filter((p) => p.url);
  const inputs = normaliseWeights(
    proofs.slice(0, 8).map((p) => ({ ref: `url:${p.url}`, plane: "B" as const, label: p.label, url: p.url, weight: 1 })),
  );
  const learned = "learned" in c ? c.learned : null;
  return {
    kind: "opportunity",
    subjectKey: c.key,
    title: c.title,
    body: { why: c.why, timing: c.timing, place: c.place ?? null, dates: c.dates ?? null, startBy: c.startBy ?? null },
    inputs,
    features: {
      // An event card is about the event (its creative seed reads "Waters at ARABLAB"); a topic card about its subject.
      topic: c.source === "topic" ? c.creativeTopic.toLowerCase() : null,
      channel: c.channel,
      region: clientRegion,
      event: c.source === "event" ? c.key : null,
      timing: timingBucket(daysOut(c)),
    },
    factors: Object.fromEntries(c.factors.map((f) => [f.label, f.value])),
    explore: Boolean(learned?.explore),
    weightsVersion,
  };
}
