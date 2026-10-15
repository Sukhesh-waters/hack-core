import { requireUser } from "@/auth";
import { requireMembership } from "@/db/queries/memberships";
import {
  getBrainChunksByIds,
  getWorkspaceConfig,
  similarBrainChunksQuery,
} from "@/db/queries/platina";
import { listSimilarRefutedBrainChunks } from "@/db/queries/platina-grades";
import { keywordFirstPartyChunksQuery, similarFirstPartyChunksQuery } from "@/db/queries/platina-learning";
import { routeAI } from "@/lib/ai/router";
import { runWithAiCost } from "@/lib/ai/usage-context";
import { modeOf } from "@/lib/platina/brain-modes";
import { recordBrainEvent } from "@/lib/platina/brain-telemetry";
import { DERIVED_SHARE } from "@/lib/platina/context-budget";
import { embedText } from "@/lib/platina/embed";
import { clientTopics } from "@/lib/platina/interest";
import { loadOpportunities } from "@/lib/platina/opportunities-load";
import {
  buildBriefPrompt,
  ownPassages,
  parseBrief,
  publicFacts,
  searchWords,
  selectBriefEvidence,
  type BriefEvidence,
} from "@/lib/platina/opportunity-brief";
import { normaliseWeights } from "@/lib/platina/suggestions";
import { recordSuggestion } from "@/lib/platina/suggestions-record";

export const dynamic = "force-dynamic";

/** Own passages closer than this to the opportunity count as relevant. */
const OWN_FLOOR = 0.55;

/**
 * AI campaign brief for one opportunity (C8.4), streamed as it works: one
 * JSON line per step, so the page shows what the AI read and checked before
 * the brief itself arrives. Membership-checked; the campaign is rebuilt from
 * stored facts on the server (the browser only names it).
 */
export async function POST(request: Request, props: { params: Promise<{ ws: string }> }) {
  const { ws } = await props.params;
  const user = await requireUser();
  await requireMembership(ws, user.id);
  const body = (await request.json().catch(() => ({}))) as { clientId?: string; key?: string };

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      const started = Date.now();
      const step = (id: string, label: string, detail: string) =>
        send({ type: "step", id, label, detail, ms: Date.now() - started });
      try {
        const [data, config] = await Promise.all([
          loadOpportunities(ws, body.clientId),
          Promise.resolve(getWorkspaceConfig(ws)).catch(() => null),
        ]);
        if (!data.client) throw new Error("no client in this workspace");
        const client = data.client;
        const campaign = [...data.campaigns.events, ...data.campaigns.topics].find((c) => c.key === body.key);
        if (!campaign) throw new Error("that opportunity is no longer on the list; refresh the page");
        const facts = publicFacts(campaign);
        step("facts", "Read the public evidence", `${facts.length} facts behind "${campaign.title}" (events, posts, ads; public)`);

        const query = `${campaign.creativeTopic}. ${campaign.why.join(" ")}`;
        const embedding = await embedText(query);
        const retrievalMode = modeOf(config, "retrieval");
        const budgetOn = modeOf(config, "budget") === "on";
        const derivedShare = config?.derivedContextShare ?? DERIVED_SHARE;
        let rows: { id?: string; content: string; sourceUrl: string | null }[] = [];
        let how = "";
        if (embedding) {
          const near = await similarFirstPartyChunksQuery(ws, embedding, {
            brandId: client.id,
            limit: retrievalMode === "off" ? 6 : 16,
          });
          rows = near.filter((r) => Number(r.score) >= OWN_FLOOR);
          how = "by meaning";
        }
        if (rows.length < 3) {
          const words = searchWords(campaign, client.name, clientTopics(client.profile ?? null, client.name));
          const found = await keywordFirstPartyChunksQuery(ws, words, {
            brandId: client.id,
            limit: (retrievalMode === "off" ? 6 : 16) - rows.length,
          });
          rows = [...rows, ...found.filter((f) => !rows.some((r) => r.content === f.content))];
          how = how ? `${how} and by keyword (${words.join(", ")})` : `by keyword (${words.join(", ")})`;
        }

        const legacyOwn = ownPassages(rows).slice(0, 6);
        let own = legacyOwn;
        let counter: BriefEvidence | null = null;
        if (retrievalMode !== "off") {
          try {
            const [brainNear, refutedNear] = await Promise.all([
              embedding ? similarBrainChunksQuery(ws, embedding, 20) : Promise.resolve([]),
              embedding ? listSimilarRefutedBrainChunks(ws, embedding, 10) : Promise.resolve([]),
            ]);
            const fullBrain = await getBrainChunksByIds(ws, [
              ...brainNear.map((b) => b.id),
              ...refutedNear.map((r) => r.id),
            ]);
            const byId = new Map(fullBrain.map((b) => [b.id, b]));
            const selected = selectBriefEvidence({
              ownRows: rows,
              brainRows: brainNear
                .map((b) => byId.get(b.id))
                .filter((b): b is NonNullable<typeof b> => Boolean(b)),
              refutedRows: refutedNear.map((r) => byId.get(r.id) ?? r),
              derivedShare,
              budgetOn,
              k: 6,
            });
            if (retrievalMode === "on") {
              own = selected.own;
              counter = selected.counter;
              void recordBrainEvent({
                workspaceId: ws,
                stage: "retrieval",
                decision: "on",
                detail: { caller: "opportunity-brief", ...selected.stats },
              });
            } else {
              const oldTexts = new Set(legacyOwn.map((o) => o.text));
              void recordBrainEvent({
                workspaceId: ws,
                stage: "retrieval",
                decision: "shadow",
                detail: {
                  caller: "opportunity-brief",
                  ...selected.stats,
                  overlap: selected.own.filter((o) => oldTexts.has(o.text)).length,
                  oldCount: legacyOwn.length,
                  newCount: selected.own.length,
                },
              });
            }
          } catch (err) {
            if (retrievalMode === "on") {
              void recordBrainEvent({
                workspaceId: ws,
                stage: "retrieval",
                decision: "fallback",
                detail: {
                  caller: "opportunity-brief",
                  error: err instanceof Error ? err.message : String(err),
                },
              });
            }
          }
        }
        step(
          "own",
          `Searched ${client.name}'s own pages`,
          own.length ? `${own.length} passages found ${how} (first-party)` : `nothing relevant found ${how}; the brief says so`,
        );

        step("model", "Writing the brief", "one model call; told to cite every line and add no numbers");
        const raw = await runWithAiCost({ workspaceId: ws, purpose: "opportunity-brief" }, () =>
          routeAI({
            kind: "chat",
            tier: "quality",
            json: true,
            system: "You write evidence-cited campaign briefs. Cite ids exactly as given. Never invent facts or numbers.",
            prompt: buildBriefPrompt({ clientName: client.name, campaign, facts, own, counter }),
          }),
        );
        const parsed = parseBrief(raw, facts, own);
        const brief = counter ? { ...parsed, counterEvidence: counter.text } : parsed;
        step(
          "check",
          "Checked every citation",
          `${brief.whyNow.length + brief.fit.length + (brief.salesAngle ? 1 : 0)} lines kept${brief.dropped ? `, ${brief.dropped} dropped (wrong evidence list, no citation, or a number not in the evidence)` : ""}; public and first-party kept apart`,
        );
        // C8.5: the brief goes into the suggestion ledger with the evidence it cited.
        const cited = [...brief.whyNow, ...brief.fit, ...(brief.salesAngle ? [brief.salesAngle] : [])].flatMap((l) => l.cites);
        const refOf = (c: (typeof cited)[number]) =>
          c.plane === "A" ? `own:${c.url ?? c.id}` : c.url ? `url:${c.url}` : `fact:${campaign.key}:${c.id}`;
        // Several facts can share one proof URL: one input per source.
        const unique = [...new Map(cited.map((c) => [refOf(c), c])).values()];
        const suggestionId = await recordSuggestion(ws, client.id, {
          kind: "brief",
          subjectKey: campaign.key,
          title: `Brief: ${campaign.title}`,
          body: {
            goal: brief.goal,
            audience: brief.audience,
            whyNow: brief.whyNow.map((l) => l.text),
            fit: brief.fit.map((l) => l.text),
            salesAngle: brief.salesAngle?.text ?? null,
            steps: brief.steps,
          },
          inputs: normaliseWeights(
            unique.map((c) => ({
              ref: refOf(c),
              plane: c.plane,
              label: c.text.slice(0, 160),
              url: c.url,
              weight: 1,
            })),
          ),
          features: { topic: campaign.source === "topic" ? campaign.creativeTopic.toLowerCase() : null, channel: campaign.channel, event: campaign.source === "event" ? campaign.key : null },
          factors: {},
          explore: false,
          weightsVersion: "rules",
          model: null,
          promptVersion: "opportunity-brief-v1",
        });
        send({ type: "brief", brief, suggestionId, campaign: { title: campaign.title, startBy: campaign.startBy ?? null } });
      } catch (error) {
        send({ type: "error", message: error instanceof Error ? error.message : "the brief could not be written" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
