"use client";

import { useFormState, useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { runBrandResearch, type BrandActionState } from "./actions";

function SubmitButton({ rerun, enrich }: { rerun: boolean; enrich: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      disabled={pending}
      variant={rerun ? "outline" : "default"}
      size={rerun ? "sm" : "default"}
      className={rerun ? "" : "w-full"}
    >
      {pending
        ? "Reading the knowledge base…"
        : rerun
          ? enrich
            ? "Re-run enrichment"
            : "Re-run research"
          : enrich
            ? "Enrich with AI"
            : "Research brand"}
    </Button>
  );
}

export function ResearchForm({
  workspaceId,
  clientId,
  rerun = false,
  enrich = false,
}: {
  workspaceId: string;
  clientId: string;
  rerun?: boolean;
  enrich?: boolean;
}) {
  const [state, formAction] = useFormState<BrandActionState, FormData>(
    runBrandResearch,
    undefined,
  );

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="clientId" value={clientId} />
      {rerun ? <input type="hidden" name="force" value="true" /> : null}
      {state?.error ? (
        <p className="text-sm text-destructive">{state.error}</p>
      ) : null}
      <SubmitButton rerun={rerun} enrich={enrich} />
    </form>
  );
}
