"use client";

import { useFormState } from "react-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/glass-card";
import {
  disconnectAccount,
  syncAccount,
  type AccountsActionState,
} from "./actions";

export type AccountView = {
  id: string;
  clientName: string;
  igUserId: string;
  status: "connected" | "error" | "disconnected";
  freshness: { status: "never" | "fresh" | "stale"; ageDays?: number };
  lastError: string | null;
  metaEnabled: boolean;
};

function FreshnessBadge({
  freshness,
}: {
  freshness: AccountView["freshness"];
}) {
  if (freshness.status === "never") {
    return (
      <Badge variant="outline" className="border-border text-muted-foreground/70">
        Never pulled
      </Badge>
    );
  }
  if (freshness.status === "stale") {
    return (
      <Badge
        variant="outline"
        className="border-brand-amber/40 text-brand-amber"
      >
        Stale · {freshness.ageDays}d
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-brand-teal/40 text-brand-teal">
      Fresh · {freshness.ageDays}d
    </Badge>
  );
}

export function AccountCard({
  workspaceId,
  account,
}: {
  workspaceId: string;
  account: AccountView;
}) {
  const [syncState, syncFormAction] = useFormState<
    AccountsActionState,
    FormData
  >(syncAccount, undefined);
  const [, disconnectFormAction] = useFormState<AccountsActionState, FormData>(
    disconnectAccount,
    undefined,
  );

  return (
    <GlassCard className="flex items-center justify-between p-5">
      <div>
        <p className="font-display text-xl">{account.clientName}</p>
        <p className="mt-1 font-mono text-xs text-muted-foreground/70">
          Meta · {account.igUserId}
        </p>
        {account.lastError ? (
          <p className="mt-1 text-xs text-destructive">{account.lastError}</p>
        ) : null}
        {syncState?.error ? (
          <p className="mt-1 text-xs text-destructive">{syncState.error}</p>
        ) : null}
      </div>
      <div className="flex items-center gap-3">
        <FreshnessBadge freshness={account.freshness} />
        {account.status !== "disconnected" ? (
          <>
            <form action={syncFormAction}>
              <input type="hidden" name="workspaceId" value={workspaceId} />
              <input type="hidden" name="accountId" value={account.id} />
              <Button size="sm" type="submit" disabled={!account.metaEnabled}>
                {account.metaEnabled ? "Sync now" : "Awaiting review"}
              </Button>
            </form>
            <form action={disconnectFormAction}>
              <input type="hidden" name="workspaceId" value={workspaceId} />
              <input type="hidden" name="accountId" value={account.id} />
              <Button size="sm" variant="ghost" type="submit">
                Disconnect
              </Button>
            </form>
          </>
        ) : (
          <Badge variant="outline" className="border-border text-muted-foreground/70">
            Disconnected
          </Badge>
        )}
      </div>
    </GlassCard>
  );
}
