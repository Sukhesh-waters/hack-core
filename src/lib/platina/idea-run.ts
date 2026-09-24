/**
 * The idea engine's run (C8.5, ask A5), shared by the Learning page's
 * streamed "Draft ideas", `npm run platina:learning -- --ideas` (Claude as
 * operator) and the
 * daily trigger job: one trigger -> its facts, the client's Brand DNA, the
 * learned patterns -> one model call -> the citation check -> every idea
 * recorded in the suggestion ledger. Server-only: DB and model.
 */
import {
  countIdeasSince,
  keywordFirstPartyChunksQuery,
  similarFirstPartyChunksQuery,
} from "@/db/queries/platina-learning";
import type { SuggestionInput } from "@/db/platina-schema";
import { routeAI } from "@/lib/ai/router";
import { runWithAiCost } from "@/lib/ai/usage-context";
import { embedText } from "./embed";
import {
  buildIdeaPrompt,
  DAILY_IDEA_CAP,
  IDEA_PROMPT_VERSION,
  IDEAS_PER_RUN,
  labelEvidence,
  parseIdeas,
  TRIGGER_LABEL,
  type Idea,
} from "./idea-engine";
import { loadTriggers } from "./idea-load";
import { CONFERENCE_CALENDAR } from "./conference-calendar";
import { clientTopics, isGenericTopic } from "./interest";
import { learnedPatterns, loadLearning } from "./learning-engine";
import { possessive } from "./learning-public";
import { ownPassages } from "./opportunity-brief";
import { recordSuggestion } from "./suggestions-record";
import { normaliseWeights } from "./suggestions";

/** Words that name what a company sells in its results, not a subject a buyer searches. */
const BUSINESS_WORDS = new Set(["consumables", "services", "revenue", "sales"]);

/** Own passages closer than this to the trigger count as Brand DNA for it. */
const OWN_FLOOR = 0.55;

/** How much of an idea rests on each list: the trigger's facts, the brand, the learned pattern. */
const SHARE = { F: 0.5, A: 0.3, P: 0.2 } as const;

function ideaInputs(idea: Idea): SuggestionInput[] {
  const lists = [
    {
      list: "F" as const,
      plane: "B" as const,
      cites: idea.why.flatMap((w) => w.cites),
    },
    { list: "A" as const, plane: "A" as const, cites: idea.fit?.cites ?? [] },
    {
      list: "P" as const,
      plane: "C" as const,
      cites: idea.pattern?.cites ?? [],
    },
  ].filter((l) => l.cites.length > 0);
  const inputs: SuggestionInput[] = [];
  for (const l of lists) {
    const unique = [...new Map(l.cites.map((c) => [c.ref, c])).values()];
    for (const c of unique)
      inputs.push({
        ref: c.ref,
        plane: l.plane,
        label: c.text.slice(0, 160),
        url: c.url,
        weight: SHARE[l.list] / unique.length,
      });
  }
  return normaliseWeights(inputs);
}

export type IdeaStep = (id: string, label: string, detail: string) => void;

export type IdeaRunResult = {
  trigger: { key: string; kind: string; title: string };
  ideas: (Idea & { suggestionId: string | null })[];
};

/** Drafts ideas for one trigger (the named one, else today's top one). Throws with a plain reason. */
export async function runIdeaEngine(
  ws: string,
  key: string | undefined,
  step: IdeaStep,
): Promise<IdeaRunResult> {
  const now = new Date();
  const dayStart = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const drafted = await countIdeasSince(ws, dayStart);
  if (drafted + IDEAS_PER_RUN > DAILY_IDEA_CAP) {
    throw new Error(
      `today's idea budget is used (${drafted} of ${DAILY_IDEA_CAP}); it resets at 00:00 UTC`,
    );
  }
  const { client, triggers } = await loadTriggers(ws, now);
  if (!client) throw new Error("no client in this workspace");
  const trigger = triggers.find((t) => t.key === key) ?? triggers[0];
  if (!trigger)
    throw new Error("nothing in today's data crosses a trigger threshold yet");
  step(
    "trigger",
    `Trigger: ${TRIGGER_LABEL[trigger.kind]}`,
    `${trigger.title} — ${trigger.facts.length} public facts behind it`,
  );

  // The client's own name pulls its results releases to the top (live
  // 2026-09-24: "Waters at ARABLAB" found only quarterly results), so the
  // search text carries the subject, not the name.
  const name = new RegExp(`\\b${client.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
  const query = `${trigger.topic ?? ""}. ${trigger.title}. ${trigger.facts
    .slice(0, 3)
    .map((f) => f.text)
    .join(" ")}`.replace(name, "");
  const embedding = await embedText(query).catch(() => null);
  let rows: { content: string; sourceUrl: string | null }[] = [];
  if (embedding) {
    rows = (
      await similarFirstPartyChunksQuery(ws, embedding, {
        brandId: client.id,
        limit: 12,
      })
    )
      .filter((r) => Number(r.score) >= OWN_FLOOR)
      // Results and investor pages say nothing about fit: they never count.
      .filter((r) => ownPassages([r]).length > 0);
  }
  if (rows.length < 3) {
    // Subjects first: the trigger's own, then the event's calendar topics,
    // then the client's. Never its name or a field word — live 2026-09-24,
    // "instruments" and "consumables" matched only quarterly-results pages.
    const own = new Set(client.name.toLowerCase().split(/\s+/));
    const title = trigger.title.toLowerCase();
    const show = CONFERENCE_CALENDAR.find((s) =>
      title.includes(s.name.toLowerCase().split(/[\s(]+/)[0]),
    );
    const words = [
      ...new Set(
        [
          (trigger.topic ?? "").replace(name, ""),
          ...(show?.topics ?? []),
          ...clientTopics(client.profile ?? null, client.name),
        ]
          .map((w) => w.toLowerCase().trim())
          .filter(
            (w) =>
              w.length >= 3 &&
              !own.has(w) &&
              !isGenericTopic(w) &&
              !BUSINESS_WORDS.has(w),
          ),
      ),
    ].slice(0, 6);
    // Fetch extra: results and investor pages are dropped below.
    const found = await keywordFirstPartyChunksQuery(ws, words, {
      brandId: client.id,
      limit: 18,
    });
    rows = [
      ...rows,
      ...found.filter((f) => !rows.some((r) => r.content === f.content)),
    ];
  }
  const dna = ownPassages(rows)
    .slice(0, 6)
    .map((p) => ({
      content: p.text,
      sourceUrl: p.url,
    }));
  step(
    "dna",
    `Read ${possessive(client.name)} Brand DNA`,
    dna.length
      ? `${dna.length} passages from its own pages (first-party)`
      : "no matching own pages; ideas will say so",
  );

  const view = await loadLearning(ws, now);
  const patterns = learnedPatterns(view);
  step(
    "patterns",
    "Loaded what has worked",
    patterns.length
      ? `${patterns.length} learned patterns past the evidence threshold (min ${view.config.minN}); about 80% of ideas follow them, 20% try something new`
      : "nothing learned past the evidence threshold yet; ideas follow the trigger and the brand only",
  );

  const ev = labelEvidence(trigger, dna, patterns);
  step(
    "model",
    "Drafting ideas",
    "one model call; every line must cite its list, no invented numbers",
  );
  const raw = await runWithAiCost(
    { workspaceId: ws, purpose: "idea-engine" },
    () =>
      routeAI({
        kind: "chat",
        tier: "quality",
        json: true,
        system:
          "You draft evidence-cited B2B campaign ideas. Cite ids exactly as given. Never invent facts or numbers.",
        prompt: buildIdeaPrompt({ clientName: client.name, trigger, ...ev }),
      }),
  );
  const { ideas, dropped } = parseIdeas(raw, ev);
  step(
    "check",
    "Checked every citation",
    `${ideas.length} ideas kept${dropped.length ? `, ${dropped.length} dropped (${[...new Set(dropped.map((d) => d.why))].join("; ")})` : ""}`,
  );
  if (ideas.length === 0)
    throw new Error(
      "no idea passed the citation check; nothing is shown rather than an unsupported idea",
    );

  const recorded = [];
  for (const idea of ideas) {
    const id = await recordSuggestion(ws, client.id, {
      kind: "idea",
      subjectKey: trigger.key,
      title: idea.title,
      body: {
        trigger: { kind: trigger.kind, title: trigger.title },
        hook: idea.hook,
        why: idea.why.map((w) => w.text),
        fit: idea.fit?.text ?? null,
        pattern: idea.pattern?.text ?? null,
      },
      inputs: ideaInputs(idea),
      features: {
        // An event trigger is about the event, not a subject.
        topic: trigger.kind === "event" ? null : (trigger.topic?.toLowerCase() ?? null),
        event: trigger.kind === "event" ? trigger.key.replace(/^trigger:/, "") : null,
        channel: idea.channel,
        format: idea.format,
        trigger: trigger.kind,
        region: client.region ?? null,
      },
      factors: {
        trigger: TRIGGER_LABEL[trigger.kind],
        patterns: patterns.length,
        brandPassages: dna.length,
      },
      explore: idea.explore,
      weightsVersion: patterns.length
        ? `learning:${now.toISOString().slice(0, 10)}`
        : "rules",
      model: null,
      promptVersion: IDEA_PROMPT_VERSION,
    });
    recorded.push({ ...idea, suggestionId: id });
  }
  step(
    "ledger",
    "Recorded in the ledger",
    `${recorded.filter((r) => r.suggestionId).length} ideas, each with its inputs, features and prompt version`,
  );
  return {
    trigger: { key: trigger.key, kind: trigger.kind, title: trigger.title },
    ideas: recorded,
  };
}
