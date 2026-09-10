"use client";

import { useState, useTransition } from "react";
import { BookOpen, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/glass-card";
import { formatBytes, type AssetKind } from "@/lib/assets";
import { archiveAssetAction, getAssetDownloadUrl } from "./actions";
import { ingestAssetToKnowledgeBaseAction } from "./ingest-action";

export type AssetRow = {
  id: string;
  filename: string;
  bytes: number;
  kind: AssetKind;
  clientId: string | null;
  uploadedById: string;
  createdAt: Date;
};

const KIND_LABEL: Record<AssetKind, string> = {
  csv: "CSV",
  doc: "Doc",
  image: "Image",
  other: "File",
};

export function AssetList({
  workspaceId,
  assets,
  clients,
  clientNameById,
  memberNameById,
  canArchive,
}: {
  workspaceId: string;
  assets: AssetRow[];
  clients: { id: string; name: string }[];
  clientNameById: Record<string, string>;
  memberNameById: Record<string, string>;
  canArchive: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedClientForAsset, setSelectedClientForAsset] = useState<
    Record<string, string>
  >({});
  const [, startTransition] = useTransition();

  /**
   * The signed URL is fetched on click, never rendered into the page. A URL
   * baked into an href at render time would still be live in the HTML long
   * after the reader stopped looking at it.
   */
  function download(assetId: string) {
    setError(null);
    setSuccessMsg(null);
    setBusyId(assetId);
    startTransition(async () => {
      const result = await getAssetDownloadUrl(workspaceId, assetId);
      setBusyId(null);
      if (result.error || !result.url) {
        setError(result.error ?? "Could not open that file.");
        return;
      }
      window.open(result.url, "_blank", "noopener,noreferrer");
    });
  }

  function archive(assetId: string) {
    setError(null);
    setSuccessMsg(null);
    setBusyId(assetId);
    startTransition(async () => {
      const form = new FormData();
      form.set("workspaceId", workspaceId);
      form.set("assetId", assetId);
      const result = await archiveAssetAction(undefined, form);
      setBusyId(null);
      if (result?.error) setError(result.error);
    });
  }

  function ingest(asset: AssetRow) {
    const targetClientId =
      asset.clientId ||
      selectedClientForAsset[asset.id] ||
      (clients.length === 1 ? clients[0]?.id : "");

    if (!targetClientId) {
      setError(
        `Select a client to ingest "${asset.filename}" into their Knowledge Base.`,
      );
      return;
    }

    setError(null);
    setSuccessMsg(null);
    setBusyId(asset.id);

    startTransition(async () => {
      const form = new FormData();
      form.set("workspaceId", workspaceId);
      form.set("clientId", targetClientId);
      form.set("assetId", asset.id);
      const result = await ingestAssetToKnowledgeBaseAction(undefined, form);
      setBusyId(null);
      if (result?.error) setError(result.error);
      if (result?.ok) setSuccessMsg(result.ok);
    });
  }

  if (assets.length === 0) {
    return (
      <GlassCard className="p-5">
        <p className="text-sm text-muted-foreground/70">
          No files yet — upload the first one above.
        </p>
      </GlassCard>
    );
  }

  return (
    <div className="space-y-2">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {successMsg ? (
        <p className="text-sm text-brand-teal">{successMsg}</p>
      ) : null}
      {assets.map((asset) => {
        const canIngest = asset.kind === "doc" || asset.kind === "csv";
        const needsClientPicker = canIngest && !asset.clientId && clients.length > 1;

        return (
          <GlassCard key={asset.id} className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="rounded-full border border-brand-teal/40 bg-brand-teal/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-brand-teal">
                    {KIND_LABEL[asset.kind]}
                  </span>
                  <p className="truncate text-sm font-medium text-foreground">
                    {asset.filename}
                  </p>
                </div>
                <p className="mt-1 font-mono text-xs text-muted-foreground/50">
                  {formatBytes(asset.bytes)} ·{" "}
                  {asset.clientId
                    ? (clientNameById[asset.clientId] ?? "a client")
                    : "workspace-wide"}{" "}
                  · {memberNameById[asset.uploadedById] ?? "a teammate"} ·{" "}
                  {asset.createdAt.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {needsClientPicker ? (
                  <select
                    value={selectedClientForAsset[asset.id] ?? ""}
                    onChange={(e) =>
                      setSelectedClientForAsset((prev) => ({
                        ...prev,
                        [asset.id]: e.target.value,
                      }))
                    }
                    className="h-8 rounded-md border border-input bg-transparent px-2 py-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">Choose client for KB…</option>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </select>
                ) : null}

                {canIngest ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="gap-1 text-xs"
                    disabled={busyId === asset.id}
                    onClick={() => ingest(asset)}
                  >
                    {busyId === asset.id ? (
                      <>
                        <Loader2 className="size-3 animate-spin" /> Ingesting…
                      </>
                    ) : (
                      <>
                        <BookOpen className="size-3" /> Add to KB
                      </>
                    )}
                  </Button>
                ) : null}

                <Button
                  variant="outline"
                  size="sm"
                  disabled={busyId === asset.id}
                  onClick={() => download(asset.id)}
                >
                  {busyId === asset.id ? "Opening…" : "Download"}
                </Button>

                {canArchive ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busyId === asset.id}
                    onClick={() => archive(asset.id)}
                  >
                    Archive
                  </Button>
                ) : null}
              </div>
            </div>
          </GlassCard>
        );
      })}
    </div>
  );
}
