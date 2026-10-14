/**
 * Server-side loader for Admin -> Health's "Brain quality" card (B0 —
 * metacognitive Brain; plan §5 B0). Reads the funnel and fetched-document
 * count for the last 7 days, debate transcripts for the last 30 days, and
 * the workspace's Brain modes, then builds the card with the pure view
 * model in brain-quality-view.ts. Read-only.
 */
import { brainFunnelCounts, getBrainModes } from "@/db/queries/platina-brain";
import {
  fetchedDocumentCount,
  listAuditSampleDetail,
  listBrainQualityTranscripts,
} from "@/db/queries/platina-brain-quality";
import { buildBrainQualityCard, type BrainQualityRow } from "./brain-quality-view";

const FUNNEL_WINDOW_DAYS = 7;
const TRANSCRIPT_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

/** Shown instead of the card when its tables cannot be read (e.g. migration 0087 not applied yet). */
export const BRAIN_QUALITY_UNAVAILABLE: BrainQualityRow = {
  label: "Brain quality",
  value: null,
  detail: "Not available yet: its records could not be read.",
  status: "not_enough",
};

/**
 * Never throws: the card shares the Health page's Promise.all, so a failure
 * here (a deploy that reached the app before its migration) must cost one
 * card, not the whole page.
 */
export async function loadBrainQualityCard(workspaceId: string, now: Date = new Date()): Promise<BrainQualityRow[]> {
  const funnelSince = new Date(now.getTime() - FUNNEL_WINDOW_DAYS * DAY_MS);
  const transcriptSince = new Date(now.getTime() - TRANSCRIPT_WINDOW_DAYS * DAY_MS);
  try {
    const [funnel, fetchedCount, transcripts, modes, auditSamples] = await Promise.all([
      brainFunnelCounts(workspaceId, funnelSince),
      fetchedDocumentCount(workspaceId, funnelSince),
      listBrainQualityTranscripts(workspaceId, transcriptSince),
      getBrainModes(workspaceId),
      listAuditSampleDetail(workspaceId, funnelSince),
    ]);
    return buildBrainQualityCard({ funnel, fetchedCount, transcripts, modes, auditSamples });
  } catch (error) {
    console.warn("[platina] brain quality card unavailable:", error instanceof Error ? error.message : error);
    return [BRAIN_QUALITY_UNAVAILABLE];
  }
}
