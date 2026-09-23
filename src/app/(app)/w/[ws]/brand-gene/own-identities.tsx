"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { describeIdentity } from "@/lib/ingest/ownership";
import type { ClientIdentityRow } from "@/db/queries/client-identities";
import { addOwnIdentityAction, removeOwnIdentityAction, type IdentityState } from "./knowledge-actions";

function AddButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" disabled={pending}>
      {pending ? "Adding…" : "Add"}
    </Button>
  );
}

/**
 * The client's own websites and social pages (C7.0). The knowledge base only
 * takes pages that match one of these; everything else is someone else's page.
 */
export function OwnIdentities({
  workspaceId,
  clientId,
  clientName,
  identities,
}: {
  workspaceId: string;
  clientId: string;
  clientName: string;
  identities: ClientIdentityRow[];
}) {
  const [state, formAction] = useActionState<IdentityState, FormData>(addOwnIdentityAction, undefined);
  return (
    <div className="mt-4 rounded-lg border border-border p-4">
      <p className="text-sm font-medium">{clientName}&apos;s own sites and pages</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Only pages on these are read into this knowledge base. Competitor and other companies&apos; pages are refused,
        so they can&apos;t pass as {clientName}&apos;s own material.
      </p>
      {identities.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          None yet. Add the website, or ingest a page and tick &quot;Belongs to {clientName}&quot;.
        </p>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-2">
          {identities.map((i) => (
            <li key={i.id} className="flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs">
              <span>{describeIdentity(i)}</span>
              <form action={removeOwnIdentityAction}>
                <input type="hidden" name="workspaceId" value={workspaceId} />
                <input type="hidden" name="clientId" value={clientId} />
                <input type="hidden" name="id" value={i.id} />
                <button
                  type="submit"
                  aria-label={`Remove ${describeIdentity(i)}`}
                  className="ml-1 text-muted-foreground hover:text-destructive"
                >
                  ×
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <form action={formAction} className="mt-3 flex gap-2">
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <input type="hidden" name="clientId" value={clientId} />
        <Input name="identity" placeholder="waters.com or linkedin.com/company/waters" aria-label="Own website or page" required />
        <AddButton />
      </form>
      {state?.error ? (
        <p className="mt-2 text-sm text-destructive">{state.error}</p>
      ) : state?.notice ? (
        <p className="mt-2 text-sm text-muted-foreground">{state.notice}</p>
      ) : null}
    </div>
  );
}
