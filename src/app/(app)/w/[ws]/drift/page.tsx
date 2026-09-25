import { redirect } from "next/navigation";
import Link from "next/link";
import { listClients } from "@/db/queries/clients";
import { driftSignal } from "@/db/queries/drift";
import { GlassCard } from "@/components/glass-card";
import { GaugeRing } from "@/components/drift/gauge-ring";
import { computeDrift, DRIFT_MIN_N, DRIFT_WINDOW_N } from "@/lib/drift";
import { ClientSelect } from "./client-select";
import { PageShell } from "@/components/page-shell";

export const metadata = { title: "Brand Drift" };
export const dynamic = "force-dynamic";

const NARRATIVE_COPY: Record<string, string> = {
  steady: "Content is landing within brand rules — no action needed.",
  drifting:
    "A rising share of recent drafts needed a compliance rewrite. Worth a look.",
  "needs attention":
    "A significant share of recent drafts are getting flagged. Review the brand rules or the drafts themselves.",
};

export default async function DriftPage(
  props: {
    params: Promise<{ ws: string }>;
    searchParams: Promise<{ client?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const clientsList = await listClients(params.ws);

  if (clientsList.length === 0) {
    return (
      <PageShell width="app">
        <p className="label-mono text-brand-teal">Brand Drift</p>
        <h1 className="mt-2 font-display text-4xl">No clients yet</h1>
        <GlassCard className="mt-8 p-8 text-center">
          <p className="text-sm text-muted-foreground/70">
            Add a client to start tracking compliance drift.
          </p>
        </GlassCard>
      </PageShell>
    );
  }

  const active =
    clientsList.find((c) => c.id === searchParams.client) ?? clientsList[0];
  if (active.id !== searchParams.client) {
    redirect(`/w/${params.ws}/drift?client=${active.id}`);
  }

  const signal = await driftSignal(params.ws, active.id, DRIFT_WINDOW_N);
  const result = computeDrift(signal);

  return (
    <PageShell width="app">
      <p className="label-mono text-brand-teal">Brand Drift</p>
      <div className="mt-2 flex items-center justify-between gap-4">
        <h1 className="font-display text-4xl">{active.name}</h1>
        <ClientSelect
          workspaceId={params.ws}
          clients={clientsList}
          activeId={active.id}
        />
      </div>
      <p className="mt-2 text-sm text-muted-foreground/70">
        How often this client&apos;s last {DRIFT_WINDOW_N} drafts needed a
        compliance rewrite — the closest signal this build has to brand-voice
        drift.
      </p>

      {result.status === "insufficient_data" ? (
        <GlassCard className="mt-8 p-8 text-center">
          <p className="text-sm text-muted-foreground/70">
            Insufficient data — drift shows once this client has at least{" "}
            {DRIFT_MIN_N} drafts. No numbers are faked below that line.
          </p>
        </GlassCard>
      ) : (
        <>
          <GlassCard className="mt-8 flex items-center gap-8 p-8">
            <GaugeRing
              magnitude={result.magnitude}
              narrative={result.narrative}
            />
            <div>
              <p className="label-mono text-muted-foreground/70">Status</p>
              <p className="mt-1 font-display text-2xl capitalize">
                {result.narrative}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {NARRATIVE_COPY[result.narrative]}
              </p>
              <p className="mt-2 font-mono text-xs text-muted-foreground/70">
                {Math.round(result.flaggedRate * 100)}% flagged ·{" "}
                {result.sampleSize} drafts checked
              </p>
            </div>
          </GlassCard>

          {result.thresholdCallout ? (
            <GlassCard className="mt-4 border-brand-amber/30 bg-brand-amber/5 p-4">
              <p className="text-sm text-brand-amber">
                Threshold crossed — 1 in 5 or more recent drafts needed a
                compliance rewrite.
              </p>
              {/* C3: suggestion, not an automation — lands on /tickets with
                  a real, editable draft; the user still reviews and submits.
                  Uses the structured `clientId` field (F9.5), not
                  linkedType=client — this is real aggregate data already
                  rendered above (narrative, flaggedRate, sampleSize), no
                  per-post violation detail exists at this layer to cite. */}
              <Link
                href={`/w/${params.ws}/tickets?${new URLSearchParams({
                  title: `Review compliance drift: ${active.name}`,
                  description: `${Math.round(result.flaggedRate * 100)}% of the last ${result.sampleSize} drafts needed a compliance rewrite — narrative: ${result.narrative}. Flagged from Brand Drift.`,
                  clientId: active.id,
                }).toString()}`}
                className="mt-2 inline-block text-xs text-brand-amber/70 hover:text-brand-amber hover:underline"
              >
                Create ticket to investigate →
              </Link>
            </GlassCard>
          ) : null}
        </>
      )}
    </PageShell>
  );
}
