import { getBrandProfile } from "@/db/queries/brand";
import { getClientGoalById } from "@/db/queries/client-goals";
import {
  brandDnaFromProfile,
  NO_BRAND_CONTEXT_ERROR,
  type MergedBrandDna,
} from "@/lib/ai/brand-merge";
import { logContextAssembly, type ContextResult } from "@/lib/ai/context/types";
import { retrieveDrivers, type DriverPost } from "@/lib/ai/retrieval";

export type IdeationContextParams = {
  workspaceId: string;
  clientId: string;
  topic: string;
  goalId?: string;
};

export const DECLARED_ONLY_BRIEF =
  "No first-party baseline yet. Ideate strictly from the declared brand context above — do not fabricate performance evidence.";

export type IdeationContext = {
  topic: string;
  identity: MergedBrandDna;
  goal: { title: string; hypothesis: string | null } | null;
  evidence:
    | {
        mode: "first_party";
        brief: string;
        drivers: DriverPost[];
        citedPostIds: string[];
      }
    | { mode: "declared_only"; brief: string };
};

/**
 * Context recipe for task_type "ideation". Structured: brand profile + goal.
 * Semantic: retrieveDrivers (embeds the topic, first-party similarity + top
 * movers, min-N gate) — first-party rows only, so the two-layer rule holds.
 * Below the min-N gate the recipe degrades to declared-only when a human
 * declared brand context exists, and otherwise reports insufficient_baseline
 * rather than fabricating evidence.
 *
 * Known debt: retrieveDrivers still writes its driver brief with an LLM call
 * inside this layer. It is preserved as-is (behavior parity with the
 * pre-orchestrator flow); moving brief-writing into the agent is a
 * deliberate behavior change for later.
 */
export async function assembleIdeationContext(
  params: IdeationContextParams,
): Promise<ContextResult<IdeationContext>> {
  const { workspaceId, clientId, topic, goalId } = params;

  const profile = await getBrandProfile(workspaceId, clientId);
  const identity = brandDnaFromProfile(profile);
  if (!identity) {
    return { state: "missing_context", reason: NO_BRAND_CONTEXT_ERROR };
  }

  // Never trust a submitted goalId as proof it belongs to this client and
  // workspace: a forged id resolves to null instead of leaking another
  // tenant's goal text into the prompt.
  const goalRow = goalId
    ? await getClientGoalById(workspaceId, clientId, goalId)
    : null;
  const goal = goalRow
    ? { title: goalRow.title, hypothesis: goalRow.hypothesis }
    : null;

  const retrieval = await retrieveDrivers({ workspaceId, clientId, topic });

  let evidence: IdeationContext["evidence"];
  if (retrieval.status === "insufficient_baseline") {
    if (!profile?.declared) {
      logContextAssembly({
        taskType: "ideation",
        workspaceId,
        state: "insufficient_baseline",
        sections: { baselineSize: retrieval.sampleSize },
      });
      return { state: "insufficient_baseline", sampleSize: retrieval.sampleSize };
    }
    evidence = { mode: "declared_only", brief: DECLARED_ONLY_BRIEF };
  } else {
    evidence = {
      mode: "first_party",
      brief: retrieval.brief,
      drivers: retrieval.drivers,
      citedPostIds: retrieval.citedPostIds,
    };
  }

  logContextAssembly({
    taskType: "ideation",
    workspaceId,
    state: "context_available",
    sections: {
      firstPartyDrivers:
        evidence.mode === "first_party" ? evidence.drivers.length : 0,
      citedDrivers:
        evidence.mode === "first_party" ? evidence.citedPostIds.length : 0,
      declaredOnly: evidence.mode === "declared_only" ? 1 : 0,
      hasGoal: goal ? 1 : 0,
    },
  });

  return {
    state: "context_available",
    context: { topic, identity, goal, evidence },
  };
}
