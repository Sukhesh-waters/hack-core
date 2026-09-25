import { describe, expect, it } from "vitest";
import { creditOf, DECISION_WEIGHT, learnFromLedger, type LedgerEvent, type LedgerSuggestion } from "./credit";

const s: LedgerSuggestion = {
  id: "s1",
  title: "ARABLAB LIVE 2026 campaign",
  inputs: [
    { ref: "url:https://a.example/post", plane: "B", label: "Bruker post", weight: 0.75 },
    { ref: "url:https://b.example/page", plane: "B", label: "Event page", weight: 0.25 },
  ],
  features: { topic: "pfas analysis", channel: "in_person", timing: "30-90 days", region: null },
};
const now = new Date("2026-09-24T00:00:00Z");
const ev = (kind: string, extra: Partial<LedgerEvent> = {}): LedgerEvent => ({
  id: `e-${kind}-${extra.reason ?? ""}`,
  suggestionId: "s1",
  kind,
  reason: null,
  reward: null,
  detail: {},
  createdAt: now,
  ...extra,
});

describe("creditOf (C8.5)", () => {
  it("a worked result raises exactly its inputs' trust, split by their weight, and its features", () => {
    const c = creditOf(s, ev("result", { reward: 1 }))!;
    expect(c.inputs).toEqual([
      { ref: "url:https://a.example/post", label: "Bruker post", plane: "B", alpha: 0.75, beta: 0 },
      { ref: "url:https://b.example/page", label: "Event page", plane: "B", alpha: 0.25, beta: 0 },
    ]);
    expect(c.features.map((f) => f.feature)).toEqual(["topic", "channel", "timing"]);
    expect(c.features[0]).toMatchObject({ value: "pfas analysis", alpha: 1, beta: 0 });
  });

  it("a person's decision counts a fraction of a result", () => {
    const c = creditOf(s, ev("planned"))!;
    expect(c.weight).toBe(DECISION_WEIGHT);
    expect(c.inputs[0].alpha).toBeCloseTo(0.225);
  });

  it("'wrong fact' lowers only the named input's trust and leaves the idea's features alone", () => {
    const c = creditOf(s, ev("dismissed", { reason: "wrong_fact", detail: { ref: "url:https://b.example/page" } }))!;
    expect(c.inputs).toEqual([{ ref: "url:https://b.example/page", label: "Event page", plane: "B", alpha: 0, beta: 1 }]);
    expect(c.features).toEqual([]);
  });

  it("'bad timing' touches only the timing feature; 'shown' carries no signal", () => {
    const c = creditOf(s, ev("dismissed", { reason: "bad_timing" }))!;
    expect(c.inputs).toEqual([]);
    expect(c.features).toEqual([{ feature: "timing", value: "30-90 days", alpha: 0, beta: DECISION_WEIGHT }]);
    expect(creditOf(s, ev("shown"))).toBeNull();
  });
});

describe("learnFromLedger", () => {
  it("adds credit to Beta(1,1) priors, fades old credit and gates on min-N", () => {
    const old = new Date("2026-06-26T00:00:00Z"); // 90 days: half weight
    const learned = learnFromLedger(
      [s],
      [ev("result", { id: "r1", reward: 1 }), ev("result", { id: "r2", reward: 0, createdAt: old })],
      { now, halfLifeDays: 90, minN: 2 },
    );
    const topic = learned.features.find((f) => f.feature === "topic")!;
    expect(topic).toMatchObject({ alpha: 2, beta: 1.5, n: 2, status: "ok" });
    const post = learned.trust.find((t) => t.ref === "url:https://a.example/post")!;
    expect(post.alpha).toBeCloseTo(1.75);
    expect(post.beta).toBeCloseTo(1.375);
    expect(learned.credits).toHaveLength(2);
    expect(learnFromLedger([s], [ev("result", { reward: 1 })], { now, halfLifeDays: 90, minN: 5 }).features[0].status).toBe("insufficient");
  });
});
