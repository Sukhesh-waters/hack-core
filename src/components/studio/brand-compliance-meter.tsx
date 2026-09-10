"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle, Shield, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { BrandContext } from "@/db/schema";
import { evaluateBrandCompliance } from "@/lib/brand-compliance";
import { cn } from "@/lib/utils";

export function BrandComplianceMeter({
  text,
  declared,
  onFixWithAi,
  isFixing,
}: {
  text: string;
  declared?: BrandContext | null;
  onFixWithAi?: () => void;
  isFixing?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  const { score, violations } = useMemo(
    () => evaluateBrandCompliance(text, declared),
    [text, declared],
  );

  const scoreColor =
    score >= 90
      ? "text-emerald-400 border-emerald-500/40 bg-emerald-500/10"
      : score >= 70
        ? "text-amber-400 border-amber-500/40 bg-amber-500/10"
        : "text-rose-400 border-rose-500/40 bg-rose-500/10";

  return (
    <div className="rounded-xl border border-border bg-background/50 p-3.5 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Shield className="size-4 text-brand-teal" />
          <span className="label-mono text-xs text-foreground">
            Live Brand Compliance
          </span>
          <Badge variant="outline" className={cn("text-xs font-mono font-bold", scoreColor)}>
            {score}% Compliant
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          {violations.length > 0 && onFixWithAi ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onFixWithAi}
              disabled={isFixing}
              className="h-7 border-brand-teal/40 bg-brand-teal/10 px-2.5 text-xs text-brand-teal hover:bg-brand-teal/20"
            >
              <Sparkles className="mr-1.5 size-3" />
              {isFixing ? "Fixing with AI…" : "Fix with Brand AI"}
            </Button>
          ) : null}

          {violations.length > 0 ? (
            <button
              type="button"
              onClick={() => setIsExpanded((v) => !v)}
              className="text-xs text-muted-foreground underline-offset-4 hover:underline"
            >
              {isExpanded ? "Hide issues" : `${violations.length} issue${violations.length > 1 ? "s" : ""}`}
            </button>
          ) : (
            <span className="flex items-center gap-1 text-xs text-emerald-400">
              <CheckCircle className="size-3.5" /> All brand rules passed
            </span>
          )}
        </div>
      </div>

      {/* Expanded Violations List */}
      {isExpanded && violations.length > 0 ? (
        <div className="mt-3 space-y-1.5 border-t border-border pt-2.5">
          {violations.map((v, i) => (
            <div
              key={`${v.matchedText}-${i}`}
              className="flex items-center gap-2 text-xs text-rose-300"
            >
              <AlertTriangle className="size-3.5 shrink-0" />
              <span>{v.message}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
