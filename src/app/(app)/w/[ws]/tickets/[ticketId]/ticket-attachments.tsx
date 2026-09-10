"use client";

import { useState, useTransition } from "react";
import { Download, Loader2, Paperclip, Trash2, Upload } from "lucide-react";
import { GlassCard } from "@/components/glass-card";
import { Button } from "@/components/ui/button";
import { formatBytes, type AssetKind } from "@/lib/assets";
import {
  getAssetDownloadUrl,
  unlinkAssetAction,
  uploadAssetAction,
} from "@/app/(app)/w/[ws]/assets/actions";
import type { AssetListRow } from "@/db/queries/assets";

const KIND_LABEL: Record<AssetKind, string> = {
  csv: "CSV",
  doc: "DOC",
  image: "IMG",
  other: "FILE",
};

export function TicketAttachments({
  workspaceId,
  ticketId,
  attachments,
  memberNameById,
}: {
  workspaceId: string;
  ticketId: string;
  attachments: AssetListRow[];
  memberNameById: Record<string, string>;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isUploading, startUpload] = useTransition();

  async function handleDownload(assetId: string) {
    setBusyId(assetId);
    setError(null);
    const res = await getAssetDownloadUrl(workspaceId, assetId);
    setBusyId(null);
    if (res.error) {
      setError(res.error);
    } else if (res.url) {
      window.open(res.url, "_blank", "noopener,noreferrer");
    }
  }

  async function handleDetach(assetId: string) {
    setBusyId(assetId);
    setError(null);
    const form = new FormData();
    form.set("workspaceId", workspaceId);
    form.set("assetId", assetId);
    form.set("linkedType", "ticket");
    form.set("linkedId", ticketId);

    const res = await unlinkAssetAction(undefined, form);
    setBusyId(null);
    if (res?.error) {
      setError(res.error);
    }
  }

  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];

    setError(null);
    setSuccess(null);

    const form = new FormData();
    form.set("workspaceId", workspaceId);
    form.set("file", file);
    form.set("linkedType", "ticket");
    form.set("linkedId", ticketId);

    startUpload(async () => {
      const res = await uploadAssetAction(undefined, form);
      if (res?.error) {
        setError(res.error);
      } else if (res?.ok) {
        setSuccess(res.ok);
      }
      e.target.value = "";
    });
  }

  return (
    <GlassCard className="mt-6 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Paperclip className="size-4 text-brand-teal" />
          <p className="label-mono text-brand-teal">Attachments</p>
          <span className="font-mono text-xs text-muted-foreground/60">
            ({attachments.length})
          </span>
        </div>

        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-card/60 px-2.5 py-1 text-xs font-medium text-foreground transition hover:bg-muted/70">
          {isUploading ? (
            <Loader2 className="size-3.5 animate-spin text-brand-teal" />
          ) : (
            <Upload className="size-3.5 text-brand-teal" />
          )}
          <span>{isUploading ? "Uploading…" : "Attach File"}</span>
          <input
            type="file"
            onChange={handleUpload}
            disabled={isUploading}
            className="hidden"
          />
        </label>
      </div>

      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
      {success ? <p className="mt-2 text-xs text-brand-teal">{success}</p> : null}

      {attachments.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground/70">
          No files attached yet. Attach briefs, screenshots, or reference docs.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {attachments.map((att) => (
            <li
              key={att.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-card/40 p-2.5 transition hover:border-border"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="rounded bg-brand-teal/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-brand-teal">
                  {KIND_LABEL[att.kind] ?? "FILE"}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-foreground">
                    {att.filename}
                  </p>
                  <p className="font-mono text-[10px] text-muted-foreground/60">
                    {formatBytes(att.bytes)} · {memberNameById[att.uploadedById] ?? "Teammate"} ·{" "}
                    {att.createdAt.toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs"
                  disabled={busyId === att.id}
                  onClick={() => handleDownload(att.id)}
                >
                  <Download className="size-3" />
                  {busyId === att.id ? "Opening…" : "Download"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-1.5 text-xs text-muted-foreground hover:text-destructive"
                  disabled={busyId === att.id}
                  onClick={() => handleDetach(att.id)}
                  title="Detach file"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </GlassCard>
  );
}
