import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
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
import { platinaBrainMaintenance } from "@/inngest/functions/platina/brain-maintenance";
import { platinaReceiptReview } from "@/inngest/functions/platina/receipt-review";
import { platinaOutcomeIngest } from "@/inngest/functions/platina/outcome-ingest";
import { platinaAlertSweep } from "@/inngest/functions/platina/alert-sweep";
import { platinaEventWindow } from "@/inngest/functions/platina/event-window";
import { platinaDivergenceScan } from "@/inngest/functions/platina/divergence-scan";
import { platinaBrandRefresh } from "@/inngest/functions/platina/brand-refresh";

export const { GET, POST, PUT } = serve({
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
    platinaBrainMaintenance,
    platinaReceiptReview,
    platinaOutcomeIngest,
    platinaAlertSweep,
    platinaEventWindow,
    platinaDivergenceScan,
    platinaBrandRefresh,
  ],
});

