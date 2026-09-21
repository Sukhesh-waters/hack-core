"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ingestKnowledgeUrl, type IngestState } from "./knowledge-actions";

function SubmitButton({ wholeSite }: { wholeSite: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? (wholeSite ? "Reading the site…" : "Fetching…") : wholeSite ? "Ingest site" : "Ingest URL"}
    </Button>
  );
}

export function IngestForm({
  workspaceId,
  clientId,
  siteAvailable = false,
}: {
  workspaceId: string;
  clientId: string;
  /** Whole-site reading needs Firecrawl (FIRECRAWL_API_KEY). */
  siteAvailable?: boolean;
}) {
  const [wholeSite, setWholeSite] = useState(siteAvailable);
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
        {wholeSite ? <input type="hidden" name="scope" value="site" /> : null}
        <SubmitButton wholeSite={wholeSite} />
      </div>
      {siteAvailable ? (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={wholeSite}
            onChange={(e) => setWholeSite(e.target.checked)}
            className="h-3.5 w-3.5 accent-primary"
          />
          Also read the site&apos;s key pages — about, products, solutions, news (up to 9
          pages, about 10 Firecrawl credits, 20–40 seconds)
        </label>
      ) : null}
      {state?.error ? (
        <p className="text-sm text-destructive">{state.error}</p>
      ) : state?.notice ? (
        <p className="text-sm text-muted-foreground">{state.notice}</p>
      ) : null}
    </form>
  );
}
