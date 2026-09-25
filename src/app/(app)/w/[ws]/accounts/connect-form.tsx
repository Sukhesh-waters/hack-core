"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { connectMetaAccount, type AccountsActionState } from "./actions";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Working…" : label}
    </Button>
  );
}

export function ConnectForm({
  workspaceId,
  clients,
}: {
  workspaceId: string;
  clients: { id: string; name: string }[];
}) {
  const [state, formAction] = useActionState<AccountsActionState, FormData>(
    connectMetaAccount,
    undefined,
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <div className="space-y-1.5">
        <Label htmlFor="clientId">Client</Label>
        <select
          id="clientId"
          name="clientId"
          required
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
        >
          <option value="">Select a client…</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="igUserId">Instagram user id</Label>
        <Input
          id="igUserId"
          name="igUserId"
          placeholder="17841400000000000"
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="accessToken">Page access token</Label>
        <Input id="accessToken" name="accessToken" type="password" required />
        <p className="text-xs text-muted-foreground/70">
          Encrypted at rest. Dev-mode tokens work for pages you admin while
          app review is pending.
        </p>
      </div>
      {state?.error ? (
        <p className="text-sm text-destructive">{state.error}</p>
      ) : null}
      {state?.ok ? <p className="text-sm text-brand-teal">{state.ok}</p> : null}
      <SubmitButton label="Connect account" />
    </form>
  );
}
