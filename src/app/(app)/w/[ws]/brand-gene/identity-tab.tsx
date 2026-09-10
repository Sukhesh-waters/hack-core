import Link from "next/link";
import { getBrandProfile } from "@/db/queries/brand";
import { GlassCard } from "@/components/glass-card";
import { ResearchForm } from "./research-form";
import { VaultEditor } from "./vault-editor";

/**
 * Brand Gene → Identity tab: the declared vault (name/mission/tone/colors/
 * banned words — everything the spec's Identity tab wants) plus an optional
 * "Enrich with AI" trigger. AI-derived identity stays wired here (not shown
 * in this UI) because ideation/compliance/generation agents read it —
 * dropping the trigger would silently break enrichment going forward.
 */
export async function IdentityTab({
  workspaceId,
  clientId,
}: {
  workspaceId: string;
  clientId: string;
}) {
  const profile = await getBrandProfile(workspaceId, clientId);
  const hasContext = Boolean(profile?.declared || profile?.identity);
  const enrichmentStale = Boolean(
    profile?.identity &&
      profile.declaredUpdatedAt &&
      profile.declaredUpdatedAt > profile.updatedAt,
  );

  return (
    <div className="mt-8">
      {profile?.declared ? (
        <div>
          <VaultEditor
            workspaceId={workspaceId}
            clientId={clientId}
            declared={profile.declared}
            stale={enrichmentStale}
          />
        </div>
      ) : null}

      {profile?.identity ? (
        <div className="mt-6">
          <ResearchForm
            workspaceId={workspaceId}
            clientId={clientId}
            rerun
            enrich={Boolean(profile.declared)}
          />
        </div>
      ) : (
        <GlassCard className={profile?.declared ? "mt-6 p-6" : "p-6"}>
          <p className="text-sm text-muted-foreground">
            {hasContext
              ? "The declared context above already powers ideation and compliance. Optionally enrich it with AI: the agent reads the knowledge base and fills in voice and audience nuance — it never overwrites your declared rules."
              : "No brand context yet. Complete the intake wizard to declare this brand's context, or run research to derive it from the knowledge base."}
          </p>
          {profile?.status === "failed" ? (
            <p className="mt-3 text-sm text-destructive">
              Last run failed: {profile.error ?? "unknown error"}. Try again.
            </p>
          ) : null}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <ResearchForm
              workspaceId={workspaceId}
              clientId={clientId}
              enrich={Boolean(profile?.declared)}
            />
            {profile?.declared ? (
              <Link
                href={`/w/${workspaceId}/clients/${clientId}/import`}
                className="text-sm text-muted-foreground/70 underline-offset-4 hover:text-foreground hover:underline"
              >
                Seed knowledge base (optional)
              </Link>
            ) : null}
          </div>
        </GlassCard>
      )}
    </div>
  );
}
