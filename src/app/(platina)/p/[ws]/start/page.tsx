import Link from "next/link";
import { PlatinaFormError } from "@/components/platina/form-error";
import { PlatinaPage } from "@/components/platina/page";
import { PendingButton } from "@/components/platina/pending-button";
import { listBrands } from "@/db/queries/platina";
import { createClientAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add a client" };

const input =
  "mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm";

export default async function StartPage({
  params,
  searchParams,
}: {
  params: { ws: string };
  searchParams: { error?: string };
}) {
  const brands = (await listBrands(params.ws)).filter(
    (b) => b.kind === "own_brand",
  );

  return (
    <PlatinaPage
      eyebrow="Add a client"
      title="Who are we working for?"
      description="Tell us who the client is. Next we suggest what to watch, you adjust it, and collection starts."
    >
      <PlatinaFormError message={searchParams.error} />
      <form action={createClientAction} className="grid max-w-md gap-3">
        <input type="hidden" name="workspaceId" value={params.ws} />
        <label className="text-xs font-medium">
          Client name
          <input name="name" required placeholder="Acme Labs" className={input} />
        </label>
        <label className="text-xs font-medium">
          Website
          <input name="homepageUrl" placeholder="acme.com" className={input} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs font-medium">
            Instagram
            <input name="instagram" placeholder="@acme" className={input} />
          </label>
          <label className="text-xs font-medium">
            TikTok
            <input name="tiktok" placeholder="@acme" className={input} />
          </label>
        </div>
        <label className="text-xs font-medium">
          Region (optional)
          <input name="region" placeholder="North America" className={input} />
        </label>
        <div className="mt-1">
          <PendingButton pendingLabel="Saving…">Continue</PendingButton>
        </div>
      </form>

      {brands.length > 0 ? (
        <section className="mt-10 max-w-md">
          <h2 className="font-display text-lg font-medium">Your clients</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {brands.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/p/${params.ws}/brands/${b.id}`}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  {b.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </PlatinaPage>
  );
}
