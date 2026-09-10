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
  ],
});

