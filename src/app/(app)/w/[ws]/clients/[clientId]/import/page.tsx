import { notFound } from "next/navigation";
import { getClientById } from "@/db/queries/clients";
import { GlassCard } from "@/components/glass-card";
import { UploadForm } from "./upload-form";

export const metadata = { title: "Import posts" };
export const dynamic = "force-dynamic";

export default async function ImportPage({
  params,
}: {
  params: { ws: string; clientId: string };
}) {
  const client = await getClientById(params.ws, params.clientId);
  if (!client) notFound();

  return (
    <div className="mx-auto max-w-lg">
      <p className="label-mono text-brand-teal">Knowledge base · add-on</p>
      <h1 className="mt-2 font-display text-3xl">
        Import {client.name}&apos;s post history
      </h1>
      <p className="mt-2 text-sm text-muted-foreground/70">
        Optional: declared Brand DNA already powers ideation. Importing
        history sharpens the baseline — rows are normalized, scored against
        this account&apos;s own baseline, and embedded into the knowledge
        base. First-party layer only.
      </p>
      <GlassCard className="mt-8 p-6">
        <UploadForm workspaceId={params.ws} clientId={params.clientId} />
      </GlassCard>
    </div>
  );
}
