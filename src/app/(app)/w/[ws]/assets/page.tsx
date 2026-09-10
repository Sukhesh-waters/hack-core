import { requireUser } from "@/auth";
import { listAssets, workspaceStorageUsed } from "@/db/queries/assets";
import { listClients } from "@/db/queries/clients";
import { listWorkspaceMembers, requireMembership } from "@/db/queries/memberships";
import { GlassCard } from "@/components/glass-card";
import { PageShell } from "@/components/page-shell";
import { formatBytes, MAX_WORKSPACE_BYTES } from "@/lib/assets";
import { roleCan } from "@/lib/permissions";
import { storageConfigured } from "@/lib/storage";
import { AssetList } from "./asset-list";
import { UploadForm } from "./upload-form";

export const metadata = { title: "Asset Library" };
export const dynamic = "force-dynamic";

export default async function AssetsPage({
  params,
}: {
  params: Promise<{ ws: string }> | { ws: string };
}) {
  const resolvedParams = await Promise.resolve(params);
  const user = await requireUser();
  const membership = await requireMembership(resolvedParams.ws, user.id);

  const [assets, clients, members, usedBytes] = await Promise.all([
    listAssets(resolvedParams.ws),
    listClients(resolvedParams.ws),
    listWorkspaceMembers(resolvedParams.ws),
    workspaceStorageUsed(resolvedParams.ws),
  ]);

  const clientNameById = Object.fromEntries(
    clients.map((client) => [client.id, client.name]),
  );
  const memberNameById = Object.fromEntries(
    members.map((member) => [member.userId, member.name ?? member.email]),
  );

  const pct = Math.min(
    100,
    Math.round((usedBytes / MAX_WORKSPACE_BYTES) * 100),
  );
  const configured = storageConfigured();

  return (
    <PageShell width="app">
      <div>
        <p className="label-mono text-brand-teal">Asset Library</p>
        <h1 className="mt-2 font-display text-4xl">
          The workspace&apos;s files
        </h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground/70">
          Client CSVs, brand guideline PDFs, briefs, and reference images —
          held per workspace, shared with the team, and never public. Files
          are served through short-lived links, not public URLs.
        </p>

        <GlassCard className="mt-6 p-5">
          <div className="flex items-baseline justify-between">
            <p className="label-mono text-muted-foreground/70">Storage used</p>
            <p className="font-mono text-xs text-muted-foreground/70">
              {formatBytes(usedBytes)} of {formatBytes(MAX_WORKSPACE_BYTES)}
            </p>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
            {/* Width is a runtime value Tailwind cannot express — the one
                inline-style exception allowed by CLAUDE.md. */}
            <div
              className="h-full rounded-full bg-brand-teal transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </GlassCard>

        {configured ? (
          <GlassCard className="mt-4 p-5">
            <p className="label-mono text-muted-foreground/70">Upload</p>
            <div className="mt-3">
              <UploadForm workspaceId={resolvedParams.ws} clients={clients} />
            </div>
          </GlassCard>
        ) : (
          <GlassCard className="mt-4 p-5">
            <p className="label-mono text-brand-amber">
              Storage not configured
            </p>
            <p className="mt-2 text-sm text-muted-foreground/70">
              File uploads are turned off because{" "}
              <span className="font-mono text-xs">
                SUPABASE_SERVICE_ROLE_KEY
              </span>{" "}
              is not set. Existing files are unaffected. Set it in the
              environment and reload to enable uploads.
            </p>
          </GlassCard>
        )}

        <div className="mt-8">
          <p className="label-mono text-muted-foreground/70">Files</p>
          <div className="mt-3">
            <AssetList
              workspaceId={resolvedParams.ws}
              assets={assets}
              clients={clients}
              clientNameById={clientNameById}
              memberNameById={memberNameById}
              canArchive={roleCan(membership.role, "asset.delete")}
            />
          </div>
        </div>
      </div>
    </PageShell>
  );
}
