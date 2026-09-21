import Link from "next/link";
import { CollectionBanner } from "@/components/platina/collection-banner";
import { PlatinaPage } from "@/components/platina/page";
import { listBrands, listScanSpecs } from "@/db/queries/platina";

export const dynamic = "force-dynamic";
export const metadata = { title: "Clients" };

export default async function BrandsPage({ params }: { params: { ws: string } }) {
  const [brands, specs] = await Promise.all([
    listBrands(params.ws),
    listScanSpecs(params.ws),
  ]);
  const clients = brands.filter((b) => b.kind === "own_brand");
  const sourcesOf = (brandId: string) =>
    specs.filter((s) => s.brandId === brandId && s.status === "approved").length;

  return (
    <PlatinaPage
      eyebrow="Clients"
      title="Clients and competitors"
      description="Everyone we are watching, grouped by the client they compete with."
    >
      <CollectionBanner workspaceId={params.ws} />
      {clients.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-6">
          <p className="font-medium">No clients yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Add your first client and we&apos;ll start collecting.
          </p>
          <Link
            href={`/p/${params.ws}/start`}
            className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
          >
            Add a client
          </Link>
        </div>
      ) : (
        <>
          <ul className="space-y-4">
            {clients.map((client) => {
              const competitors = brands.filter(
                (b) => b.kind === "competitor" && b.parentBrandId === client.id,
              );
              return (
                <li key={client.id} className="rounded-lg border border-border bg-card p-4">
                  <Link
                    href={`/p/${params.ws}/brands/${client.id}`}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {client.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {sourcesOf(client.id)} source(s) · {competitors.length} competitor(s)
                    {client.status === "paused" ? " · paused" : ""}
                  </p>
                  {competitors.length > 0 ? (
                    <ul className="mt-3 space-y-1 border-l border-border pl-4 text-sm">
                      {competitors.map((c) => (
                        <li key={c.id}>
                          {c.name}{" "}
                          <span className="text-xs text-muted-foreground">
                            {sourcesOf(c.id)} source(s)
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <Link
            href={`/p/${params.ws}/start`}
            className="mt-6 inline-block text-sm text-primary underline-offset-4 hover:underline"
          >
            Add another client
          </Link>
        </>
      )}
    </PlatinaPage>
  );
}
