import { describe, expect, it } from "vitest";
import { campaignSuggestion, inputHash, normaliseWeights, timingBucket } from "./suggestions";
import type { Campaign } from "./opportunities";

const campaign: Campaign = {
  key: "event:arablab-live-2026",
  channel: "in_person",
  source: "event",
  title: "ARABLAB LIVE 2026",
  why: ["Bruker, Shimadzu and Thermo Fisher are on the exhibitor list."],
  proofs: [
    { label: "Exhibitor list", url: "https://www.arablab.com/exhibitors" },
    { label: "Bruker post", url: "https://www.linkedin.com/posts/bruker_1" },
    { label: "No link" },
  ],
  timing: "in 32 days",
  plan: { useCase: "event", eventName: "ARABLAB LIVE 2026", eventDate: "2026-10-26" },
  creativeTopic: "PFAS analysis",
  place: "Dubai, AE",
  dates: "26-28 Oct 2026",
  startBy: "now",
  factors: [{ label: "Competitors going", value: "3" }],
};

describe("campaignSuggestion (C8.5)", () => {
  it("records the card's public proofs as Plane B inputs with equal weight, and its features", () => {
    const d = campaignSuggestion(campaign, "GCC (Middle East)", "rules");
    expect(d.inputs).toEqual([
      { ref: "url:https://www.arablab.com/exhibitors", plane: "B", label: "Exhibitor list", url: "https://www.arablab.com/exhibitors", weight: 0.5 },
      { ref: "url:https://www.linkedin.com/posts/bruker_1", plane: "B", label: "Bruker post", url: "https://www.linkedin.com/posts/bruker_1", weight: 0.5 },
    ]);
    expect(d.features).toEqual({ topic: null, channel: "in_person", region: "GCC (Middle East)", event: "event:arablab-live-2026", timing: "30-90 days" });
    expect(d.factors).toEqual({ "Competitors going": "3" });
  });

  it("hashes the same inputs the same way, whatever their order", () => {
    const d = campaignSuggestion(campaign, null, "rules");
    const flipped = { ...d, inputs: [...d.inputs].reverse() };
    expect(inputHash(flipped)).toBe(inputHash(d));
    expect(inputHash({ ...d, title: "Other" })).not.toBe(inputHash(d));
  });

  it("normalises weights and buckets timing", () => {
    expect(normaliseWeights([{ ref: "a", plane: "B", label: "a", weight: 3 }, { ref: "b", plane: "A", label: "b", weight: 1 }]).map((i) => i.weight)).toEqual([0.75, 0.25]);
    expect([timingBucket(10), timingBucket(45), timingBucket(200), timingBucket(null)]).toEqual(["under 30 days", "30-90 days", "over 90 days", null]);
  });
});
