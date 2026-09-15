import { PlatinaFormError } from "@/components/platina/form-error";
import { PlatinaPage } from "@/components/platina/page";
import { listBrandChunks, listGateEvents } from "@/db/queries/platina";
import { declareBrandAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function BrandPage({
  params,
  searchParams,
}: {
  params: { ws: string };
  searchParams: { error?: string };
}) {
  const [chunks, gates] = await Promise.all([
    listBrandChunks(params.ws),
    listGateEvents(params.ws),
  ]);
  const declared = gates.filter((g) => g.gate === "declare");

  return (
    <PlatinaPage eyebrow="S1 · gate 1" title="Brand Gene">
      <PlatinaFormError message={searchParams.error} />
      <form action={declareBrandAction} className="mb-8 space-y-3">
        <input type="hidden" name="workspaceId" value={params.ws} />
        <textarea
          name="content"
          required
          rows={5}
          placeholder="Declare the brand standard — voice, claims we never make, terminology."
          className="w-full rounded-md border border-border bg-background p-3 text-sm"
        />
        <button
          type="submit"
          className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
        >
          Declare standard
        </button>
      </form>
      <h2 className="mb-2 text-sm font-medium">Plane A chunks</h2>
      <ul className="space-y-2">
        {chunks.map((c) => (
          <li key={c.id} className="rounded-md border border-border p-3 text-sm">
            {c.content}
          </li>
        ))}
      </ul>
      <p className="mt-4 font-mono text-xs text-muted-foreground">
        {declared.length} Gate 1 events written
      </p>
    </PlatinaPage>
  );
}
