import Link from "next/link";
import { notFound } from "next/navigation";
import { getBrandProfile } from "@/db/queries/brand";
import { getContentById } from "@/db/queries/clients";
import { listComments } from "@/db/queries/comments";
import { listWorkspaceMembers } from "@/db/queries/memberships";
import { listLinkedAssets } from "@/db/queries/assets";
import { parseDraftBody, generateMultimodalAssets } from "@/lib/ai/agents/content";
import { brandDnaFromProfile } from "@/lib/ai/brand-merge";
import { GlassCard } from "@/components/glass-card";
import { Badge } from "@/components/ui/badge";
import { RefineForm } from "./refine-form";
import { ComplianceForm } from "./compliance-form";
import { CommentForm } from "./comment-form";
import { MarkPublishedForm } from "./mark-published-form";
import { StartDraftForm } from "./start-draft-form";
import { PushToTeamForm } from "./push-to-team-form";
import { DraftEditor } from "./draft-editor";
import { DraftAttachments } from "./draft-attachments";
import { MultimodalAssetDrawer } from "@/components/studio/multimodal-asset-drawer";
import { PageShell } from "@/components/page-shell";

export const metadata = { title: "Draft" };
export const dynamic = "force-dynamic";

export default async function DraftPage(
  props: {
    params: Promise<{ ws: string; contentId: string }>;
  }
) {
  const params = await props.params;
  const row = await getContentById(params.ws, params.contentId);
  if (!row) notFound();
  const [brandProfile, thread, members, attachments] = await Promise.all([
    getBrandProfile(params.ws, row.clientId),
    listComments(params.ws, params.contentId),
    listWorkspaceMembers(params.ws),
    listLinkedAssets(params.ws, "content", params.contentId),
  ]);
  const brandDna = brandDnaFromProfile(brandProfile);
  const draft = row.body ? parseDraftBody(row.body) : null;
  const multimodalAssets =
    draft && brandDna ? generateMultimodalAssets({ draft, brand: brandDna }) : null;
  const memberNameById: Record<string, string> = Object.fromEntries(
    members.map((m) => [m.userId, m.name ?? m.email]),
  );

  return (
    <PageShell width="prose">
      <Link
        href={`/w/${params.ws}/studio`}
        className="text-xs text-muted-foreground/70 hover:text-foreground"
      >
        ← All drafts
      </Link>
      <div className="mt-2 flex items-center justify-between">
        <h1 className="font-display text-3xl">{row.title}</h1>
        <Badge variant="outline" className="border-border text-muted-foreground/70">
          {row.status}
        </Badge>
      </div>

      {draft ? (
        <>
          <DraftEditor
            workspaceId={params.ws}
            contentId={params.contentId}
            initialDraft={draft}
            declaredBrand={brandProfile?.declared ?? null}
          />
          {multimodalAssets ? (
            <MultimodalAssetDrawer assets={multimodalAssets} />
          ) : null}
        </>
      ) : row.body ? (
        <GlassCard className="mt-6 p-5">
          <pre className="whitespace-pre-wrap text-sm text-muted-foreground">
            {row.body}
          </pre>
        </GlassCard>
      ) : (
        <GlassCard className="mt-6 p-5">
          <p className="label-mono text-brand-purple">Start the draft</p>
          <p className="mt-2 text-xs text-muted-foreground/70">
            This card was added directly to Production or the calendar, so it
            has no AI-generated draft yet. Write the caption, script, hashtags,
            and CTA here to move it into the compliance and approval pipeline.
          </p>
          <div className="mt-4">
            <StartDraftForm
              workspaceId={params.ws}
              contentId={params.contentId}
            />
          </div>
        </GlassCard>
      )}

      <DraftAttachments
        workspaceId={params.ws}
        contentId={row.id}
        clientId={row.clientId ?? undefined}
        attachments={attachments}
        memberNameById={memberNameById}
      />

      {row.body ? (
        <>
          <GlassCard className="mt-6 p-5">
            <p className="label-mono text-brand-purple">Refinement loop</p>
            <div className="mt-3">
              <RefineForm
                workspaceId={params.ws}
                contentId={params.contentId}
              />
            </div>
          </GlassCard>

          <GlassCard className="mt-6 p-5">
            <div className="flex items-center justify-between">
              <p className="label-mono text-brand-amber">Compliance</p>
              <Badge
                variant="outline"
                className={
                  row.complianceStatus === "passed"
                    ? "border-brand-teal/40 text-brand-teal"
                    : row.complianceStatus === "flagged"
                      ? "border-destructive/40 text-destructive"
                      : "border-border text-muted-foreground/70"
                }
              >
                {row.complianceStatus}
              </Badge>
            </div>
            {row.complianceStatus === "flagged" &&
            row.complianceReport?.length ? (
              <ul className="mt-3 space-y-2">
                {row.complianceReport.map((v, i) => (
                  <li
                    key={i}
                    className="rounded-md border border-destructive/20 p-3"
                  >
                    <p className="text-sm font-medium text-destructive">{v.rule}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      “{v.excerpt}” — {v.why}
                    </p>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-3 text-xs text-muted-foreground/70">
              Audits the draft against Brand DNA rules. One auto-fix retry, then
              a human decides. Passing moves the draft to review.
            </p>
            <div className="mt-3">
              <ComplianceForm
                workspaceId={params.ws}
                contentId={params.contentId}
                checked={row.complianceStatus !== "pending"}
              />
            </div>
          </GlassCard>
        </>
      ) : null}

      {row.body ? (
        <GlassCard className="mt-6 p-5">
          <p className="label-mono text-brand-teal">Push to team</p>
          <p className="mt-2 text-xs text-muted-foreground/70">
            Assigns this draft, opens a linked ticket, posts a line in the
            Hub and notifies the owner — all at once, or not at all.
          </p>
          <div className="mt-3">
            <PushToTeamForm
              workspaceId={params.ws}
              contentId={params.contentId}
              members={members.map((m) => ({
                id: m.userId,
                label: m.name ?? m.email,
              }))}
            />
          </div>
        </GlassCard>
      ) : null}

      {row.status === "approved" || row.status === "scheduled" ? (
        <GlassCard className="mt-6 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="label-mono text-brand-teal">Meta Ad Campaign</p>
              <p className="mt-1 text-xs text-muted-foreground/70">
                Deploy this approved creative asset directly into a Meta Ads campaign.
              </p>
            </div>
            <Link
              href={`/w/${params.ws}/ads/new?client=${row.clientId}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-teal px-3.5 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-brand-teal/90"
            >
              🚀 Launch Meta Campaign
            </Link>
          </div>
        </GlassCard>
      ) : null}

      {row.status === "approved" || row.status === "scheduled" ? (
        <GlassCard className="mt-6 p-5">
          <p className="label-mono text-brand-teal">Publish-back</p>
          <p className="mt-2 text-xs text-muted-foreground/70">
            Post went live? Mark it published — real metrics sync in
            separately and feed the learning loop.
          </p>
          <div className="mt-3">
            <MarkPublishedForm
              workspaceId={params.ws}
              contentId={params.contentId}
            />
          </div>
        </GlassCard>
      ) : null}

      <GlassCard className="mt-6 p-5">
        <p className="label-mono text-brand-teal">Performance</p>
        <p className="mt-2 text-xs text-muted-foreground/70">
          Metrics sync automatically from your connected Meta account. No
          connection yet?{" "}
          <Link
            href={`/w/${params.ws}/clients/${row.clientId}/import`}
            className="text-brand-teal hover:underline"
          >
            Backfill history with a CSV import
          </Link>
          , or{" "}
          <Link
            href={`/w/${params.ws}/accounts`}
            className="text-brand-teal hover:underline"
          >
            connect an account
          </Link>
          .
        </p>
      </GlassCard>

      <GlassCard className="mt-6 p-5">
        <div className="flex items-center justify-between">
          <p className="label-mono text-muted-foreground/70">Team thread</p>
          <span className="font-mono text-xs text-muted-foreground/50">
            {thread.length} comment{thread.length === 1 ? "" : "s"} ·
            refreshes every 10s
          </span>
        </div>
        {thread.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground/70">
            No comments yet — leave feedback or a sign-off note.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {thread.map((comment) => (
              <li
                key={comment.id}
                className="rounded-md border border-border p-3"
              >
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground">
                    {comment.authorName ?? comment.authorEmail ?? "Teammate"}
                  </p>
                  <p className="font-mono text-xs text-muted-foreground/50">
                    {comment.createdAt.toLocaleString()}
                  </p>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                  {comment.body}
                </p>
              </li>
            ))}
          </ul>
        )}
        <CommentForm workspaceId={params.ws} contentId={params.contentId} />
      </GlassCard>
    </PageShell>
  );
}
