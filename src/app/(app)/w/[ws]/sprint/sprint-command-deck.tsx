"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { type SprintDeckData, type SprintDeckPost } from "@/db/queries/sprint";
import {
  quickRewritePostAction,
  autoFixComplianceAction,
  batchApproveSprintAction,
} from "./actions";
import {
  createCascadeProposalAction,
} from "../sop/runs/[runId]/cascade-actions";
import { CascadeProposalDrawer } from "../sop/runs/[runId]/cascade-proposal-drawer";
import type { CascadeResult } from "@/lib/sop/cascade";
import {
  Sparkles,
  AlertTriangle,
  Clock,
  Send,
  Calendar,
  Layers,
  Wand2,
  ShieldCheck,
  Check,
  Loader2,
  ChevronRight,
  Zap,
  GitPullRequest,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const REWRITE_PRESETS = [
  { label: "Make Punchier", icon: Zap, prompt: "Make this punchier and remove any filler words while keeping the core message." },
  { label: "Add Urgency", icon: Sparkles, prompt: "Add strong urgency and FOMO to hook the audience immediately." },
  { label: "More Conversational", icon: Wand2, prompt: "Make the tone more relaxed, relatable, and conversational." },
  { label: "Stronger CTA", icon: Send, prompt: "Rewrite the call-to-action to be direct, compelling, and actionable." },
];

export function SprintCommandDeck({
  workspaceId,
  data,
}: {
  workspaceId: string;
  data: SprintDeckData;
}) {
  const { run, steps, posts, metrics } = data;
  const [selectedPostId, setSelectedPostId] = useState<string>(
    posts[0]?.id || "",
  );
  const [activePosts, setActivePosts] = useState<SprintDeckPost[]>(posts);
  const [isRewriting, setIsRewriting] = useState(false);
  const [isAutoFixing, setIsAutoFixing] = useState(false);
  const [isApprovingBatch, startBatchTransition] = useTransition();
  const [batchApproved, setBatchApproved] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Cascade Proposal State
  const [activeProposal, setActiveProposal] = useState<{
    proposalId: string;
    cascade: CascadeResult;
  } | null>(null);
  const [isProposingCascade, setIsProposingCascade] = useState<string | null>(null);

  const selectedPost =
    activePosts.find((p) => p.id === selectedPostId) || activePosts[0];

  const handleQuickRewrite = async (instruction: string) => {
    if (!selectedPost) return;
    setIsRewriting(true);
    setActionMessage(null);

    const res = await quickRewritePostAction({
      workspaceId,
      contentId: selectedPost.id,
      instruction,
    });

    setIsRewriting(false);
    if (res.ok) {
      setActivePosts((prev) =>
        prev.map((p) =>
          p.id === selectedPost.id
            ? {
                ...p,
                body: res.body,
                complianceStatus: res.complianceStatus as "passed" | "flagged" | "pending",
                complianceReport:
                  res.complianceStatus === "passed" ? [] : p.complianceReport,
              }
            : p,
        ),
      );
      setActionMessage("Draft rewritten and re-audited successfully!");
    } else {
      setActionMessage(`Error: ${res.error}`);
    }
  };

  const handleAutoFixCompliance = async () => {
    if (!selectedPost) return;
    setIsAutoFixing(true);
    setActionMessage(null);

    const res = await autoFixComplianceAction({
      workspaceId,
      contentId: selectedPost.id,
    });

    setIsAutoFixing(false);
    if (res.ok) {
      setActivePosts((prev) =>
        prev.map((p) =>
          p.id === selectedPost.id
            ? {
                ...p,
                complianceStatus: "passed",
                complianceReport: [],
              }
            : p,
        ),
      );
      setActionMessage("Violations automatically resolved! Compliance: 100% Passed.");
    } else {
      setActionMessage(`Auto-fix failed: ${res.error}`);
    }
  };

  const handleTriggerCascade = async (stepId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setIsProposingCascade(stepId);
    setActionMessage(null);

    // Simulate slipped date (e.g. 2 days slip from today)
    const slipDate = new Date();
    slipDate.setDate(slipDate.getDate() + 2);

    const res = await createCascadeProposalAction({
      workspaceId,
      runId: run.id,
      slippedStepId: stepId,
      actualCompletionDate: slipDate,
    });

    setIsProposingCascade(null);
    if (res.ok) {
      setActiveProposal({
        proposalId: res.proposalId,
        cascade: res.cascade,
      });
    } else {
      setActionMessage(`Cascade calculation: ${res.error}`);
    }
  };

  const handleBatchApprove = () => {
    startBatchTransition(async () => {
      const res = await batchApproveSprintAction({
        workspaceId,
        runId: run.id,
      });

      if (res.ok) {
        setBatchApproved(true);
        setActivePosts((prev) =>
          prev.map((p) => ({ ...p, status: "approved" })),
        );
        setActionMessage(`All ${res.count ?? "sprint"} posts approved! SOP reverse-sync active.`);
      } else {
        setActionMessage(`Approval failed: ${res.error}`);
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Cascade Proposal Drawer Mount */}
      {activeProposal && (
        <CascadeProposalDrawer
          workspaceId={workspaceId}
          runId={run.id}
          proposalId={activeProposal.proposalId}
          cascade={activeProposal.cascade}
          aiExplanation={`Schedule slip detected on sprint step. Downstream dates shifted by ${activeProposal.cascade.slipDays} days.`}
          onClose={() => setActiveProposal(null)}
        />
      )}

      {/* Top Banner & Control Deck */}
      <div className="p-6 rounded-2xl bg-card border border-border shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-medium bg-sky-500/10 text-sky-400 border border-sky-500/20">
              AUTOPILOT SPRINT DECK
            </span>
            <span className="text-xs text-muted-foreground font-mono">
              CLIENT: <strong className="text-foreground">{run.clientName ?? "Workspace"}</strong>
            </span>
          </div>
          <h1 className="text-2xl font-display text-foreground mt-1.5">{run.name}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Unified control deck: SOP execution graph on the left, live creative & compliance engine on the right.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Link href={`/w/${workspaceId}/calendar`}>
            <Button
              variant="outline"
              size="sm"
              className="border-border text-foreground hover:bg-muted flex items-center gap-1.5"
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>Calendar</span>
            </Button>
          </Link>
          <Link href={`/w/${workspaceId}/sop/runs/${run.id}`}>
            <Button
              variant="outline"
              size="sm"
              className="border-border text-foreground hover:bg-muted flex items-center gap-1.5"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>SOP Graph</span>
            </Button>
          </Link>
          <Button
            onClick={handleBatchApprove}
            disabled={isApprovingBatch || batchApproved}
            className="bg-sky-600 hover:bg-sky-500 text-primary-foreground font-medium shadow-md shadow-sky-900/20 flex items-center gap-2"
          >
            {isApprovingBatch ? (
              <Loader2 className="w-4 h-4 animate-spin text-sky-200" />
            ) : batchApproved ? (
              <Check className="w-4 h-4 text-emerald-300" />
            ) : (
              <ShieldCheck className="w-4 h-4 text-sky-200" />
            )}
            <span>{batchApproved ? "Sprint Approved" : "Approve All Deliverables"}</span>
          </Button>
        </div>
      </div>

      {/* Metrics Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-card border border-border">
          <div className="text-xs font-mono text-muted-foreground">TOTAL POSTS</div>
          <div className="text-2xl font-display text-foreground mt-1">{metrics.totalPosts}</div>
          <div className="text-xs text-sky-400 mt-0.5">Pre-slotted on calendar</div>
        </div>
        <div className="p-4 rounded-xl bg-card border border-border">
          <div className="text-xs font-mono text-muted-foreground">COMPLIANCE HEALTH</div>
          <div className="text-2xl font-display text-emerald-400 mt-1">
            {metrics.totalPosts > 0
              ? Math.round((metrics.passedCompliance / metrics.totalPosts) * 100)
              : 100}%
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {metrics.flaggedCompliance > 0 ? `${metrics.flaggedCompliance} need auto-fix` : "All rules passed"}
          </div>
        </div>
        <div className="p-4 rounded-xl bg-card border border-border">
          <div className="text-xs font-mono text-muted-foreground">SOP STEPS COMPLETED</div>
          <div className="text-2xl font-display text-sky-400 mt-1">
            {metrics.completedSteps} / {metrics.totalSteps}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">{metrics.progressPercentage}% pipeline progress</div>
        </div>
        <div className="p-4 rounded-xl bg-card border border-border">
          <div className="text-xs font-mono text-muted-foreground">APPROVAL STATUS</div>
          <div className="text-2xl font-display text-amber-300 mt-1">
            {metrics.approvedPosts} / {metrics.totalPosts}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">Ready for live publishing</div>
        </div>
      </div>

      {actionMessage && (
        <div className="p-3 rounded-lg bg-sky-950/40 border border-sky-800/80 text-sky-200 text-sm flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-sky-400" />
          <span>{actionMessage}</span>
        </div>
      )}

      {/* Main Split-Screen Control Deck */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: SOP Workflow Stepper */}
        <div className="lg:col-span-5 space-y-4">
          <div className="p-5 rounded-2xl bg-card border border-border backdrop-blur-sm">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-sky-400" />
                <h2 className="text-sm font-mono font-semibold text-foreground uppercase tracking-wider">
                  SOP Execution Pipeline
                </h2>
              </div>
              <span className="text-xs font-mono text-muted-foreground">
                {steps.length} Steps in DAG
              </span>
            </div>

            <div className="space-y-3 mt-4">
              {steps.map((step, idx) => {
                const isDone = step.status === "done";
                const isBlocked = step.status === "blocked";
                const isLinkedToActive =
                  step.linkedId && step.linkedId === selectedPostId;
                const isCalculatingThis = isProposingCascade === step.id;

                return (
                  <div
                    key={step.id}
                    onClick={() => {
                      if (step.linkedId) setSelectedPostId(step.linkedId);
                    }}
                    className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                      isLinkedToActive
                        ? "bg-sky-950/30 border-sky-500/50 shadow-md shadow-sky-950/30"
                        : "bg-muted/40 border-border hover:border-muted-foreground/40"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div
                          className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-mono font-bold ${
                            isDone
                              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                              : isBlocked
                              ? "bg-muted text-muted-foreground border border-border"
                              : "bg-sky-500/20 text-sky-300 border border-sky-500/40"
                          }`}
                        >
                          {isDone ? <Check className="w-3.5 h-3.5" /> : idx + 1}
                        </div>
                        <div>
                          <div className="text-sm font-medium text-foreground">
                            {step.title}
                          </div>
                          {step.description && (
                            <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                              {step.description}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {step.gate !== "none" && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-muted text-muted-foreground border border-border">
                            {step.gate}
                          </span>
                        )}
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase ${
                            isDone
                              ? "bg-emerald-500/10 text-emerald-400"
                              : isBlocked
                              ? "bg-muted text-muted-foreground"
                              : "bg-amber-500/10 text-amber-400"
                          }`}
                        >
                          {step.status}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-border text-xs font-mono text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-muted-foreground" />
                        <span>Due: {new Date(step.dueAt).toLocaleDateString()}</span>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        {!isDone && (
                          <button
                            type="button"
                            onClick={(e) => handleTriggerCascade(step.id, e)}
                            disabled={Boolean(isProposingCascade)}
                            className="text-amber-400/90 hover:text-amber-300 flex items-center gap-1 hover:underline"
                            title="Calculate downstream timeline adjustments"
                          >
                            {isCalculatingThis ? (
                              <Loader2 className="w-3 h-3 animate-spin text-amber-300" />
                            ) : (
                              <GitPullRequest className="w-3 h-3" />
                            )}
                            <span>Cascade</span>
                          </button>
                        )}
                        {step.linkedId && (
                          <span className="text-sky-400 flex items-center gap-1 hover:underline">
                            <span>Post</span>
                            <ChevronRight className="w-3 h-3" />
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column: Live Studio Post Inspector & AI Copilot */}
        <div className="lg:col-span-7 space-y-4">
          <div className="p-6 rounded-2xl bg-card border border-border backdrop-blur-sm space-y-5">
            {/* Post Selector Tabs */}
            <div className="flex items-center gap-2 overflow-x-auto pb-2 border-b border-border scrollbar-thin">
              {activePosts.map((post, idx) => {
                const isSelected = post.id === selectedPostId;
                return (
                  <button
                    key={post.id}
                    onClick={() => setSelectedPostId(post.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all flex items-center gap-2 border ${
                      isSelected
                        ? "bg-sky-600 text-primary-foreground border-sky-500 shadow-sm"
                        : "bg-muted/60 text-muted-foreground border-border hover:bg-muted"
                    }`}
                  >
                    <span className="font-mono text-[10px] uppercase opacity-75">
                      #{idx + 1} {post.type}
                    </span>
                    <span>{post.title.slice(0, 18)}...</span>
                  </button>
                );
              })}
            </div>

            {selectedPost ? (
              <div className="space-y-5">
                {/* Post Header & Compliance Badge */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-muted/30 border border-border">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-xs font-mono uppercase bg-sky-500/10 text-sky-400 border border-sky-500/20">
                        {selectedPost.type}
                      </span>
                      <span className="px-2 py-0.5 rounded text-xs font-mono uppercase bg-muted text-muted-foreground">
                        Pillar: {selectedPost.pillar ?? "Campaign"}
                      </span>
                      {selectedPost.scheduledFor && (
                        <span className="text-xs text-muted-foreground font-mono flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-muted-foreground" />
                          {new Date(selectedPost.scheduledFor).toLocaleDateString()} @ 11:00 AM
                        </span>
                      )}
                    </div>
                    <h3 className="text-lg font-medium text-foreground mt-1.5">
                      {selectedPost.title}
                    </h3>
                  </div>

                  <div className="flex items-center gap-2">
                    <div
                      className={`px-3 py-1.5 rounded-lg border flex items-center gap-1.5 text-xs font-mono font-medium ${
                        selectedPost.complianceStatus === "passed"
                          ? "bg-emerald-950/40 border-emerald-800 text-emerald-300"
                          : "bg-amber-950/40 border-amber-800 text-amber-300"
                      }`}
                    >
                      {selectedPost.complianceStatus === "passed" ? (
                        <>
                          <ShieldCheck className="w-4 h-4 text-emerald-400" />
                          <span>Brand DNA: Passed</span>
                        </>
                      ) : (
                        <>
                          <AlertTriangle className="w-4 h-4 text-amber-400" />
                          <span>Brand DNA: Flagged</span>
                        </>
                      )}
                    </div>

                    {selectedPost.complianceStatus === "flagged" && (
                      <Button
                        size="sm"
                        onClick={handleAutoFixCompliance}
                        disabled={isAutoFixing}
                        className="bg-amber-600 hover:bg-amber-500 text-primary-foreground text-xs font-medium flex items-center gap-1"
                      >
                        {isAutoFixing ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Wand2 className="w-3.5 h-3.5" />
                        )}
                        <span>Auto-Fix</span>
                      </Button>
                    )}
                  </div>
                </div>

                {/* Violations Warning Box */}
                {selectedPost.complianceReport &&
                  selectedPost.complianceReport.length > 0 && (
                    <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-800/60 text-xs text-amber-200 space-y-2">
                      <div className="font-semibold flex items-center gap-1.5 text-amber-300">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>Rule Violations Detected ({selectedPost.complianceReport.length}):</span>
                      </div>
                      {selectedPost.complianceReport.map((v, i) => (
                        <div key={i} className="pl-5 border-l-2 border-amber-700/50 space-y-0.5">
                          <div className="font-medium text-amber-100">{v.rule}</div>
                          <div className="text-amber-300/80">{v.why}</div>
                        </div>
                      ))}
                    </div>
                  )}

                {/* AI Quick Polish Action Strip */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-sky-400" />
                      <span>AI Copilot Quick Rewriters</span>
                    </span>
                    {isRewriting && (
                      <span className="text-xs text-sky-400 flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span>Polishing with AI...</span>
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {REWRITE_PRESETS.map((preset, idx) => {
                      const Icon = preset.icon;
                      return (
                        <Button
                          key={idx}
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={isRewriting}
                          onClick={() => handleQuickRewrite(preset.prompt)}
                          className="border-border bg-muted/40 hover:bg-muted text-foreground text-xs flex items-center gap-1.5 justify-center"
                        >
                          <Icon className="w-3 h-3 text-sky-400" />
                          <span>{preset.label}</span>
                        </Button>
                      );
                    })}
                  </div>
                </div>

                {/* Live Post Draft Content */}
                <div className="space-y-2">
                  <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                    Generated Content & Direction
                  </div>
                  <div className="p-4 rounded-xl bg-background border border-border text-sm font-sans leading-relaxed text-foreground whitespace-pre-wrap font-mono text-xs">
                    {selectedPost.body ?? "(Empty body)"}
                  </div>
                </div>

                {/* Footer metadata & Strategy note */}
                {selectedPost.strategyNote && (
                  <div className="p-3 rounded-lg bg-muted/30 border border-border text-xs text-muted-foreground">
                    <span className="font-mono text-foreground font-medium">Strategy Note: </span>
                    {selectedPost.strategyNote}
                  </div>
                )}
              </div>
            ) : (
              <div className="p-8 text-center text-muted-foreground text-sm">
                No deliverables found in this sprint.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
