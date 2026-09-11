import { PlatinaPage } from "@/components/platina/page";
import {
  listBrainChunks,
  listCampaigns,
  listGateEvents,
  listReceipts,
  listScanSpecs,
} from "@/db/queries/platina";

export const dynamic = "force-dynamic";
export const metadata = { title: "Platina cockpit" };

export default async function PlatinaCockpit({
  params,
}: {
  params: { ws: string };
}) {
  const [scans, brain, receipts, campaigns, gates] = await Promise.all([
    listScanSpecs(params.ws),
    listBrainChunks(params.ws),
    listReceipts(params.ws),
    listCampaigns(params.ws),
    listGateEvents(params.ws),
  ]);

  return (
    <PlatinaPage eyebrow="S2 · cockpit" title="Operational landing surface">
      <p className="mb-6 text-muted-foreground">
        Every Platina flow is triggered, monitored and audited from here. InstaMedia
        stays at <code className="font-mono text-xs">/w/{params.ws}</code>.
      </p>
      <dl className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {[
          ["Scan specs", scans.length],
          ["Brain insights", brain.length],
          ["Receipts", receipts.length],
          ["Campaigns", campaigns.length],
          ["Gate events", gates.length],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-lg border border-border p-4">
            <dt className="font-mono text-[10px] uppercase text-muted-foreground">
              {label}
            </dt>
            <dd className="font-display text-2xl">{value}</dd>
          </div>
        ))}
      </dl>
    </PlatinaPage>
  );
}
