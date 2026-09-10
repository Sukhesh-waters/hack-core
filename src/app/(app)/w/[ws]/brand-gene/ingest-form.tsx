"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ingestKnowledgeUrl, type IngestState } from "./knowledge-actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Fetching…" : "Ingest URL"}
    </Button>
  );
}

export function IngestForm({
  workspaceId,
  clientId,
}: {
  workspaceId: string;
  clientId: string;
}) {
  const [state, formAction] = useFormState<IngestState, FormData>(
    ingestKnowledgeUrl,
    undefined,
  );
  const [url, setUrl] = useState("");
  const lastState = useRef<IngestState>(undefined);

  useEffect(() => {
    if (state !== lastState.current) {
      lastState.current = state;
      if (!state?.error) setUrl("");
    }
  }, [state]);

  return (
    <form action={formAction} className="mt-4 space-y-2">
      <div className="flex gap-2">
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <input type="hidden" name="clientId" value={clientId} />
        <Input
          name="url"
          type="url"
          placeholder="https://example.com/about"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
        />
        <SubmitButton />
      </div>
      {state?.error ? (
        <p className="text-sm text-destructive">{state.error}</p>
      ) : null}
    </form>
  );
}
