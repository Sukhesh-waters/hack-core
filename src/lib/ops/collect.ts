/**
 * Gathers the facts behind every ops check for one workspace (C7.1). IO lives
 * here, the rules live in checks.ts. Read-only: nothing here writes, fetches
 * a page or calls a model. `external: true` also reads Apify and Firecrawl
 * account usage (two free API calls); leave it off for the fast hourly pass.
 */
import { listClientIdentities, listKnownParties } from "@/db/queries/client-identities";
import {
  activeRunsQuery,
  aiCostSinceQuery,
  clientNamesQuery,
  draftReviewsCountQuery,
  embedFailuresSinceQuery,
  knowledgeSourcesWithUrlQuery,
  pageFactsQuery,
  unembeddedBrainCountQuery,
} from "@/db/queries/ops";
import { listBrands, listEvents, listScanSpecs } from "@/db/queries/platina";
import { listOwnSitePages, ownSiteClientsQuery, unembeddedFirstPartyChunksQuery } from "@/db/queries/platina-learning";
import { ownershipOf } from "@/lib/ingest/ownership";
import { learningState } from "@/lib/platina/learning-read";
import { homeCountries } from "@/lib/platina/opportunities";
import { summariseOwnSite } from "@/lib/platina/own-site";
import {
  checkBudgets,
  checkCollectionFreshness,
  checkEmbeddings,
  checkEvents,
  checkKnowledgeOwnership,
  checkLearning,
  checkOwnSite,
  checkStuckRuns,
  type OpsCheck,
  type SpendReading,
} from "./checks";
import { checkPagesHaveContent, pageReadiness } from "./readiness-pages";
import { readApifyUsage, readFirecrawlUsage } from "./usage";

const DAY = 86_400_000;

async function knowledgeOwnership(workspaceId: string): Promise<OpsCheck> {
  const [sources, names, known] = await Promise.all([
    knowledgeSourcesWithUrlQuery(workspaceId),
    clientNamesQuery(workspaceId),
    listKnownParties(workspaceId),
  ]);
  const nameOf = new Map(names.map((c) => [c.id, c.name]));
  const holding = sources.filter((s) => s.status === "ready" && s.chunkCount > 0 && s.url);
  const byClient = new Map<string, typeof holding>();
  for (const s of holding) byClient.set(s.clientId, [...(byClient.get(s.clientId) ?? []), s]);

  const notOwn: { url: string; client: string; owner: string | null }[] = [];
  const clientsWithoutOwnList: string[] = [];
  for (const [clientId, list] of byClient) {
    const own = (await listClientIdentities(workspaceId, clientId)).map(({ kind, value }) => ({ kind, value }));
    const client = nameOf.get(clientId) ?? clientId;
    if (own.length === 0) {
      clientsWithoutOwnList.push(client);
      continue;
    }
    for (const s of list) {
      const who = ownershipOf(s.url!, { own, known });
      if (who.verdict !== "own") notOwn.push({ url: s.url!, client, owner: who.verdict === "third_party" ? who.name : null });
    }
  }
  return checkKnowledgeOwnership({ notOwn, clientsWithoutOwnList });
}

async function ownSite(workspaceId: string, now: Date): Promise<OpsCheck> {
  const [clients, brands] = await Promise.all([ownSiteClientsQuery(workspaceId), listBrands(workspaceId)]);
  const errorOf = new Map(brands.map((b) => [b.id, b.ownSiteError ?? null]));
  const sites = await Promise.all(
    clients.map(async (c) => {
      const summary = summariseOwnSite(await listOwnSitePages(workspaceId, c.id));
      return { client: c.name, ...summary, error: errorOf.get(c.id) ?? null };
    }),
  );
  return checkOwnSite({ now, sites });
}

async function embeddings(workspaceId: string, now: Date): Promise<OpsCheck> {
  const [firstParty, [brain], [failures]] = await Promise.all([
    unembeddedFirstPartyChunksQuery(workspaceId, 1000),
    unembeddedBrainCountQuery(workspaceId),
    embedFailuresSinceQuery(workspaceId, new Date(now.getTime() - DAY)),
  ]);
  return checkEmbeddings({ waiting: firstParty.length + Number(brain?.n ?? 0), failures24h: Number(failures?.n ?? 0) });
}

async function collection(workspaceId: string, now: Date): Promise<OpsCheck> {
  const specs = (await listScanSpecs(workspaceId)).filter((s) => s.status === "approved" && s.enabled);
  return checkCollectionFreshness({
    now,
    sources: specs.map((s) => ({
      name: s.name,
      cadenceMinutes: s.cadenceMinutes,
      lastSuccessAt: s.lastSuccessAt,
      lastFailureAt: s.lastFailureAt,
      createdAt: s.createdAt,
    })),
  });
}

async function events(workspaceId: string, now: Date): Promise<OpsCheck> {
  const [rows, brands] = await Promise.all([listEvents(workspaceId), listBrands(workspaceId)]);
  const own = brands.find((b) => b.kind === "own_brand" && b.status === "active");
  const countries = homeCountries(own?.region);
  return checkEvents({
    now,
    // No region set: every upcoming event counts, and the label says so.
    regionCountries: countries.length > 0 ? countries : rows.map((e) => e.country ?? "").filter(Boolean),
    regionLabel: countries.length > 0 ? (own?.region ?? "the region") : "any region",
    events: rows.map((e) => ({ name: e.name, startsOn: e.startsOn, country: e.country })),
  });
}

async function learning(workspaceId: string, now: Date): Promise<OpsCheck> {
  const [state, [drafts]] = await Promise.all([learningState(workspaceId, null, now), draftReviewsCountQuery(workspaceId)]);
  return checkLearning({
    results: state.results,
    pastMinN: state.stats.filter((s) => s.status === "ok").length,
    minN: state.config.minN,
    reviewsWaiting: Number(drafts?.n ?? 0),
  });
}

/** Apify and Firecrawl usage: account-wide, so read once and shared by every workspace. */
export async function readAccountUsage(): Promise<SpendReading[]> {
  return Promise.all([readApifyUsage(process.env.APIFY_TOKEN), readFirecrawlUsage(process.env.FIRECRAWL_API_KEY)]);
}

async function budgets(workspaceId: string, now: Date, account: SpendReading[]): Promise<OpsCheck> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1) - 1);
  const [ai] = await aiCostSinceQuery(workspaceId, monthStart);
  const readings: SpendReading[] = [
    ...account,
    { name: "AI (this workspace)", used: Number(ai?.usd ?? 0), cap: null, unit: "usd", periodStart: monthStart, periodEnd: monthEnd },
  ];
  return checkBudgets({ now, readings });
}

async function pagesContent(workspaceId: string): Promise<OpsCheck> {
  const [facts] = await pageFactsQuery(workspaceId);
  if (!facts) throw new Error("workspace not found");
  return checkPagesHaveContent(pageReadiness(facts));
}

async function stuckRuns(workspaceId: string, now: Date): Promise<OpsCheck> {
  return checkStuckRuns({ now, running: await activeRunsQuery(workspaceId) });
}

/** Every check for one workspace, in board order. One failing gatherer never hides the others. */
export async function runOpsChecks(
  workspaceId: string,
  options: {
    now?: Date;
    /** Read Apify/Firecrawl usage here (the script). Ignored when `account` is given. */
    external?: boolean;
    /** Account usage already read by the caller (the job reads it once for all workspaces). */
    account?: SpendReading[];
  } = {},
): Promise<OpsCheck[]> {
  const now = options.now ?? new Date();
  const account = options.account ?? (options.external ? await readAccountUsage() : []);
  const gatherers: [string, string, () => Promise<OpsCheck>][] = [
    ["knowledge_ownership", "First-party knowledge is the client's own", () => knowledgeOwnership(workspaceId)],
    ["own_site", "Client websites (first-party)", () => ownSite(workspaceId, now)],
    ["embeddings", "Embeddings (search vectors)", () => embeddings(workspaceId, now)],
    ["collection_freshness", "Sources collected on time", () => collection(workspaceId, now)],
    ["events", "Events ahead", () => events(workspaceId, now)],
    ["learning", "Learning from results", () => learning(workspaceId, now)],
    ["budgets", "Budgets (projected to period end)", () => budgets(workspaceId, now, account)],
    ["stuck_runs", "Runs finishing", () => stuckRuns(workspaceId, now)],
    ["pages_content", "Pages have content", () => pagesContent(workspaceId)],
  ];
  return Promise.all(
    gatherers.map(async ([id, label, gather]) => {
      try {
        return await gather();
      } catch (error) {
        return {
          id,
          label,
          required: false,
          status: "degraded" as const,
          detail: `Couldn't check: ${error instanceof Error ? error.message.slice(0, 160) : "unknown error"}.`,
        };
      }
    }),
  );
}
