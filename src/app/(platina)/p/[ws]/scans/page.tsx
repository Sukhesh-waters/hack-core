import { PlatinaFormError } from "@/components/platina/form-error";
import { PlatinaMovedNotice } from "@/components/platina/moved-notice";
import { PlatinaPage } from "@/components/platina/page";
import { listScanSpecs } from "@/db/queries/platina";
import { confirmScanAction, createScanSpecAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function ScansPage(
  props: {
    params: Promise<{ ws: string }>;
    searchParams: Promise<{ error?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const specs = await listScanSpecs(params.ws);

  return (
    <PlatinaPage eyebrow="Sources" title="Sources we watch">
      <PlatinaMovedNotice workspaceId={params.ws} to="audits" label="Audits" />
      <PlatinaFormError message={searchParams.error} />
      <form action={createScanSpecAction} className="mb-8 flex flex-col gap-2">
        <input type="hidden" name="workspaceId" value={params.ws} />
        <input
          name="name"
          required
          placeholder="Competitor watch — LC/MS"
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
        <input
          name="target"
          required
          placeholder="https://competitor.example.com"
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="w-fit rounded-md border border-border px-3 py-1.5 text-sm"
        >
          Save draft spec
        </button>
      </form>
      <ul className="space-y-3">
        {specs.map((spec) => (
          <li key={spec.id} className="rounded-md border border-border p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">{spec.name}</p>
                <p className="font-mono text-xs text-muted-foreground">
                  {spec.status} · {spec.targets.length} targets
                </p>
              </div>
              {spec.status === "draft" && (
                <form action={confirmScanAction}>
                  <input type="hidden" name="workspaceId" value={params.ws} />
                  <input type="hidden" name="specId" value={spec.id} />
                  <button
                    type="submit"
                    className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
                  >
                    Start collecting
                  </button>
                </form>
              )}
            </div>
          </li>
        ))}
      </ul>
    </PlatinaPage>
  );
}
