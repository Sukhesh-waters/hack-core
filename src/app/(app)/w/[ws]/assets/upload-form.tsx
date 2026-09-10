"use client";

import { useFormState, useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { uploadAssetAction, type UploadAssetState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Uploading…" : "Upload file"}
    </Button>
  );
}

export function UploadForm({
  workspaceId,
  clients,
}: {
  workspaceId: string;
  clients: { id: string; name: string }[];
}) {
  const [state, formAction] = useFormState<UploadAssetState, FormData>(
    uploadAssetAction,
    undefined,
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="workspaceId" value={workspaceId} />

      <div className="space-y-1.5">
        <Label htmlFor="file">File</Label>
        <Input
          id="file"
          name="file"
          type="file"
          accept=".csv,.txt,.md,.pdf,.docx,.xlsx,.png,.jpg,.jpeg,.webp"
          required
        />
        <p className="text-xs text-muted-foreground/70">
          CSV, PDF, Word, Excel, text, Markdown, or an image. Max 10 MB per
          file.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="clientId">Client (optional)</Label>
        <select
          id="clientId"
          name="clientId"
          defaultValue=""
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="">Workspace-wide</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </select>
      </div>

      {state?.error ? (
        <p className="text-sm text-destructive">{state.error}</p>
      ) : null}
      {state?.ok ? (
        <p className="text-sm text-brand-teal">{state.ok}</p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
