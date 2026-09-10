"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { launchCampaignSprintAction } from "./actions";
import { Sparkles, Rocket, Loader2, CheckCircle2, Zap } from "lucide-react";

export type ClientOption = {
  id: string;
  name: string;
  handle?: string | null;
};

export function LaunchSprintDialog({
  workspaceId,
  clients,
  templates = [],
}: {
  workspaceId: string;
  clients: ClientOption[];
  templates?: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState(clients[0]?.id || "");
  const [templateId, setTemplateId] = useState(templates[0]?.id || "");
  const [theme, setTheme] = useState("");
  const [targetCount, setTargetCount] = useState(4);
  const [durationDays, setDurationDays] = useState(14);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!theme.trim()) {
      setError("Please enter a campaign theme or goal.");
      return;
    }
    setError(null);

    const formData = new FormData();
    formData.append("workspaceId", workspaceId);
    formData.append("clientId", clientId);
    if (templateId) {
      formData.append("templateId", templateId);
    }
    formData.append("theme", theme);
    formData.append("targetCount", String(targetCount));
    formData.append("durationDays", String(durationDays));

    startTransition(async () => {
      const res = await launchCampaignSprintAction(undefined, formData);
      if (!res.ok) {
        setError(res.error);
      } else {
        setOpen(false);
        router.push(`/w/${workspaceId}/sprint/${res.data.runId}`);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-gradient-to-r from-teal-600 to-teal-500 hover:from-teal-500 hover:to-teal-400 text-primary-foreground font-medium shadow-lg shadow-teal-900/30 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-teal-200 animate-pulse" />
          <span>Launch Autopilot Sprint</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[540px] bg-popover backdrop-blur-xl border border-border text-foreground shadow-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2 text-teal-400 font-mono text-xs font-semibold tracking-wider uppercase">
            <Zap className="w-3.5 h-3.5" />
            <span>Autonomous Content Engine</span>
          </div>
          <DialogTitle className="text-xl font-display text-foreground">
            Launch Campaign Sprint
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-sm">
            AI instantly matches client Brand DNA, drafts 4–8 multi-hook posts with compliance scoring, and sets up a linked SOP execution run.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {error && (
            <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-destructive text-sm">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="client" className="text-xs font-mono text-muted-foreground">
              TARGET CLIENT
            </Label>
            <select
              id="client"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.handle ? `(@${c.handle})` : ""}
                </option>
              ))}
            </select>
          </div>

          {templates.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="template" className="text-xs font-mono text-muted-foreground">
                SOP WORKFLOW TEMPLATE
              </Label>
              <select
                id="template"
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="theme" className="text-xs font-mono text-muted-foreground">
              CAMPAIGN THEME & OBJECTIVE
            </Label>
            <Input
              id="theme"
              placeholder="e.g. Summer Product Drop, Q3 Growth Sprint, High-Protein Recipe Blitz"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              className="bg-background border-border text-foreground placeholder:text-muted-foreground focus:ring-teal-500"
              disabled={isPending}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="targetCount" className="text-xs font-mono text-muted-foreground">
                POSTS TO GENERATE
              </Label>
              <select
                id="targetCount"
                value={targetCount}
                onChange={(e) => setTargetCount(Number(e.target.value))}
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:ring-teal-500"
                disabled={isPending}
              >
                <option value={2}>2 Posts (Quick Test)</option>
                <option value={4}>4 Posts (1-Week Sprint)</option>
                <option value={6}>6 Posts (2-Week Sprint)</option>
                <option value={8}>8 Posts (Full Campaign)</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="duration" className="text-xs font-mono text-muted-foreground">
                TIMELINE WINDOW
              </Label>
              <select
                id="duration"
                value={durationDays}
                onChange={(e) => setDurationDays(Number(e.target.value))}
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:ring-teal-500"
                disabled={isPending}
              >
                <option value={7}>7 Days</option>
                <option value={14}>14 Days (Standard)</option>
                <option value={30}>30 Days (Monthly)</option>
              </select>
            </div>
          </div>

          <div className="p-3 bg-muted/40 rounded-lg border border-border text-xs text-muted-foreground space-y-1.5">
            <div className="flex items-center gap-2 text-foreground font-medium">
              <CheckCircle2 className="w-3.5 h-3.5 text-teal-400" />
              <span>What happens automatically:</span>
            </div>
            <ul className="list-disc list-inside space-y-1 pl-1 text-muted-foreground">
              <li>Generates full captions, video scripts, hooks & CTAs</li>
              <li>Scans against client Brand DNA for tone & banned words</li>
              <li>Slots deliverables into the calendar grid</li>
              <li>Instantiates an SOP task pipeline with bidirectional sync</li>
            </ul>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isPending}
              className="border-border text-foreground hover:bg-muted"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending}
              className="bg-teal-600 hover:bg-teal-500 text-primary-foreground font-medium flex items-center gap-2 min-w-[140px]"
            >
              {isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-teal-200" />
                  <span>Synthesizing...</span>
                </>
              ) : (
                <>
                  <Rocket className="w-4 h-4" />
                  <span>Generate Sprint</span>
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
