import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { runAsWorkload } from "@/lib/ai/orchestration";
import { accountSync } from "@/inngest/functions/account-sync";
import { adLibraryScan } from "@/inngest/functions/ad-library-scan";
import { automationSweep } from "@/inngest/functions/automation";
import { decisionReview } from "@/inngest/functions/decision-review";
import { contentReminder } from "@/inngest/functions/reminders";
import { hubReminderSweep } from "@/inngest/functions/hub-reminders";
import { importTimeoutSweep } from "@/inngest/functions/import-timeout";
import { knowledgeRefresh } from "@/inngest/functions/knowledge-refresh";
import { patternScan } from "@/inngest/functions/pattern-scan";
import { rescoreSweep } from "@/inngest/functions/rescore";
import { autoDocGenerator } from "@/inngest/functions/auto-docs";
import { sopReverseSync } from "@/inngest/functions/sop-reverse-sync";
import { sopReconciliation } from "@/inngest/functions/sop-reconciliation";
import { platinaAuditRun } from "@/inngest/functions/platina/audit-run";
import { platinaScanCoordinator } from "@/inngest/functions/platina/scan-coordinator";
import { platinaProbeTick } from "@/inngest/functions/platina/probe-tick";
import { platinaContradictSweep } from "@/inngest/functions/platina/contradict-sweep";
import { platinaSignalAnalyze } from "@/inngest/functions/platina/signal-analyze";
import { platinaClientProfile } from "@/inngest/functions/platina/client-profile";
import { platinaBrainMaintenance } from "@/inngest/functions/platina/brain-maintenance";
import { platinaReceiptReview } from "@/inngest/functions/platina/receipt-review";
import { platinaOutcomeIngest } from "@/inngest/functions/platina/outcome-ingest";
import { platinaAlertSweep } from "@/inngest/functions/platina/alert-sweep";
import { platinaEventWindow } from "@/inngest/functions/platina/event-window";
import { platinaDivergenceScan } from "@/inngest/functions/platina/divergence-scan";
import { platinaBrandRefresh } from "@/inngest/functions/platina/brand-refresh";
import { platinaInterestExtract } from "@/inngest/functions/platina/interest-extract";
import { platinaConsolidate } from "@/inngest/functions/platina/consolidate";
import { platinaIdeaTrigger } from "@/inngest/functions/platina/idea-trigger";
import { platinaEventExtract } from "@/inngest/functions/platina/event-extract";
import { platinaOwnSite } from "@/inngest/functions/platina/own-site";
import { platinaLearning } from "@/inngest/functions/platina/learning";
import { platinaFalsifierGrade, platinaFalsifierGradeSweep } from "@/inngest/functions/platina/falsifier-grade";
import { opsCheck } from "@/inngest/functions/ops-check";

const handler = serve({
  client: inngest,
  functions: [
    contentReminder,
    hubReminderSweep,
    patternScan,
    rescoreSweep,
    accountSync,
    adLibraryScan,
    importTimeoutSweep,
    automationSweep,
    decisionReview,
    autoDocGenerator,
    knowledgeRefresh,
    sopReverseSync,
    sopReconciliation,
    platinaAuditRun,
    platinaScanCoordinator,
    platinaProbeTick,
    platinaContradictSweep,
    platinaSignalAnalyze,
    platinaClientProfile,
    platinaBrainMaintenance,
    platinaReceiptReview,
    platinaOutcomeIngest,
    platinaAlertSweep,
    platinaEventWindow,
    platinaDivergenceScan,
    platinaBrandRefresh,
    platinaInterestExtract,
    platinaConsolidate,
    platinaIdeaTrigger,
    platinaEventExtract,
    platinaOwnSite,
    platinaLearning,
    platinaFalsifierGradeSweep,
    platinaFalsifierGrade,
    opsCheck,
  ],
});

export const { GET, PUT } = handler;

/**
 * Every job runs as "background" work: the model router then puts NVIDIA
 * first and keeps Groq's small per-minute budget for people waiting on a
 * page (see src/lib/ai/orchestration.ts). One wrapper here instead of a
 * setting on every call site; POST is the only verb that executes steps.
 */
export const POST = (...args: Parameters<typeof handler.POST>) =>
  runAsWorkload("background", () => handler.POST(...args));

