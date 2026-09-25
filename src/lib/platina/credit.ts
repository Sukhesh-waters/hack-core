/**
 * Credit assignment (C8.5 T85.4). Pure.
 *
 * What happens to a suggestion — a person plans it, dismisses it (and why),
 * or a result comes back — is turned into credit that flows BACKWARDS along
 * the suggestion's record:
 *
 *  - to each feature value it had (topic, channel, region, timing, ...),
 *    as Beta counts, like the C6 bandit;
 *  - to each input it rested on (an insight, a source), as a TRUST score,
 *    split by how much that input weighed in the suggestion.
 *
 * Like backpropagation in spirit (outcomes adjust what produced them), but
 * every number is a readable count and every credit is traceable to the
 * event that caused it. Older credit fades with the workspace half-life.
 * Min-N gated: below the gate a value says "not enough yet" and moves
 * nothing.
 *
 * A measured result counts fully; a person's decision counts a fraction of
 * that (it is an opinion before the market spoke). "Wrong fact" is the one
 * decision about an INPUT: it lowers that input's trust at full weight and
 * leaves the idea's features alone.
 */
import type { SuggestionFeatures, SuggestionInput } from "@/db/platina-schema";
import { decayWeight } from "./learning";

/** A person's decision weighs this much of a measured result. */
export const DECISION_WEIGHT = 0.3;

export type LedgerSuggestion = {
  id: string;
  title: string;
  inputs: SuggestionInput[];
  features: SuggestionFeatures;
};

export type LedgerEvent = {
  id: string;
  suggestionId: string;
  kind: string;
  reason: string | null;
  reward: number | null;
  detail: Record<string, unknown> | null;
  createdAt: Date;
};

export type Credit = {
  eventId: string;
  suggestionId: string;
  /** 0 = went against it, 1 = went for it. */
  reward: number;
  /** How much this event counts (before fading). */
  weight: number;
  why: string;
  inputs: { ref: string; label: string; plane: SuggestionInput["plane"]; alpha: number; beta: number }[];
  features: { feature: string; value: string; alpha: number; beta: number }[];
};

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** The credit one event sends back, or null when it carries no signal (shown, opened). */
export function creditOf(s: LedgerSuggestion, e: LedgerEvent): Credit | null {
  let reward: number;
  let weight: number;
  let why: string;
  let toInputs = true;
  let toFeatures: string[] | "all" = "all";
  let onlyRef: string | null = null;

  switch (e.kind) {
    case "result":
      if (e.reward === null) return null;
      reward = Math.max(0, Math.min(1, e.reward));
      weight = 1;
      why = `result came back (${reward === 1 ? "worked" : reward === 0 ? "failed" : "mixed"})`;
      break;
    case "planned":
    case "accepted":
      reward = 1;
      weight = DECISION_WEIGHT;
      why = e.kind === "planned" ? "a person planned it" : "a person marked it useful";
      break;
    case "dismissed":
      reward = 0;
      if (e.reason === "wrong_fact") {
        weight = 1;
        why = "dismissed: a fact in it was wrong";
        toFeatures = [];
        const named = typeof e.detail?.ref === "string" ? e.detail.ref : null;
        onlyRef = named && s.inputs.some((i) => i.ref === named) ? named : null;
      } else if (e.reason === "bad_timing") {
        weight = DECISION_WEIGHT;
        why = "dismissed: bad timing";
        toInputs = false;
        toFeatures = ["timing"];
      } else if (e.reason === "already_doing") {
        // Right direction, nothing new: a small nod to its features, nothing to its facts.
        reward = 1;
        weight = DECISION_WEIGHT / 2;
        why = "dismissed: already doing it";
        toInputs = false;
      } else {
        weight = DECISION_WEIGHT;
        why = "dismissed: not relevant";
        toInputs = false;
      }
      break;
    default:
      return null;
  }

  const targets = onlyRef ? s.inputs.filter((i) => i.ref === onlyRef).map((i) => ({ ...i, weight: 1 })) : s.inputs;
  const inputs = toInputs
    ? targets.map((i) => ({ ref: i.ref, label: i.label, plane: i.plane, alpha: r3(weight * i.weight * reward), beta: r3(weight * i.weight * (1 - reward)) }))
    : [];
  const features = Object.entries(s.features)
    .filter(([f, v]) => v && (toFeatures === "all" || toFeatures.includes(f)))
    .map(([feature, value]) => ({ feature, value: String(value), alpha: r3(weight * reward), beta: r3(weight * (1 - reward)) }));
  return { eventId: e.id, suggestionId: s.id, reward, weight, why, inputs, features };
}

export type TrustStat = {
  ref: string;
  label: string;
  plane: SuggestionInput["plane"];
  alpha: number;
  beta: number;
  /** Events that credited it (raw count). */
  n: number;
  mean: number;
  status: "ok" | "insufficient";
};

export type LaneStat = { feature: string; value: string; alpha: number; beta: number; n: number; mean: number; status: "ok" | "insufficient" };

export type Learned = { credits: Credit[]; trust: TrustStat[]; features: LaneStat[] };

/** Everything the ledger has taught, faded by age. Priors are Beta(1, 1). */
export function learnFromLedger(
  suggestions: LedgerSuggestion[],
  events: LedgerEvent[],
  options: { now: Date; halfLifeDays: number; minN: number },
): Learned {
  const byId = new Map(suggestions.map((s) => [s.id, s]));
  const credits: Credit[] = [];
  const trust = new Map<string, TrustStat>();
  const features = new Map<string, LaneStat>();
  for (const e of [...events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    const s = byId.get(e.suggestionId);
    if (!s) continue;
    const c = creditOf(s, e);
    if (!c) continue;
    credits.push(c);
    const fade = decayWeight((options.now.getTime() - e.createdAt.getTime()) / 86_400_000, options.halfLifeDays);
    for (const i of c.inputs) {
      const t = trust.get(i.ref) ?? { ref: i.ref, label: i.label, plane: i.plane, alpha: 1, beta: 1, n: 0, mean: 0.5, status: "insufficient" as const };
      t.alpha += i.alpha * fade;
      t.beta += i.beta * fade;
      t.n += 1;
      trust.set(i.ref, t);
    }
    for (const f of c.features) {
      const key = `${f.feature}\u0000${f.value}`;
      const st = features.get(key) ?? { feature: f.feature, value: f.value, alpha: 1, beta: 1, n: 0, mean: 0.5, status: "insufficient" as const };
      st.alpha += f.alpha * fade;
      st.beta += f.beta * fade;
      st.n += 1;
      features.set(key, st);
    }
  }
  const finish = <T extends { alpha: number; beta: number; n: number; mean: number; status: "ok" | "insufficient" }>(x: T): T => ({
    ...x,
    alpha: r3(x.alpha),
    beta: r3(x.beta),
    mean: r3(x.alpha / (x.alpha + x.beta)),
    status: x.n >= options.minN ? "ok" : "insufficient",
  });
  return {
    credits,
    trust: [...trust.values()].map(finish).sort((a, b) => b.n - a.n || a.ref.localeCompare(b.ref)),
    features: [...features.values()].map(finish).sort((a, b) => a.feature.localeCompare(b.feature) || b.n - a.n),
  };
}
