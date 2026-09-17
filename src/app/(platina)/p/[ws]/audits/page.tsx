import { PlatinaFormError } from "@/components/platina/form-error";
import { PlatinaPage } from "@/components/platina/page";
import { listScanSpecs } from "@/db/queries/platina";
import { confirmScanAction, createScanSpecAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Platina audits" };

const STATUS_LABEL: Record<string, string> = {
  draft: "Awaiting scope approval",
  approved: "Approved — scheduled",
  running: "Running",
  done: "Completed",
  failed: "Failed",
};

export default async function AuditsPage({
  params,
  searchParams,
}: {
  params: { ws: string };
  searchParams: { error?: string };
}) {
  const specs = await listScanSpecs(params.ws);

  return (
    <PlatinaPage
      eyebrow="Platina · Audits"
      title="Audit sources"
      description="Define the public sources Platina observes — competitor sites, product pages, trade press, conference pages, ad libraries. Nothing is fetched until the scope is approved."
    >
      <PlatinaFormError message={searchParams.error} />
      <form
        action={createScanSpecAction}
        className="mb-8 rounded-lg border border-border bg-card p-4"
      >
        <h2 className="text-sm font-medium">New audit source</h2>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <input type="hidden" name="workspaceId" value={params.ws} />
          <input
            name="name"
            required
            placeholder="Competitor watch — LC/MS"
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <input
            name="target"
            required
            placeholder="https://competitor.example.com"
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          className="mt-3 rounded-md border border-border px-3 py-1.5 text-sm"
        >
          Save as draft
        </button>
      </form>

      {specs.length === 0 ? (
        <div className="rounded-lg border border-border bg-secondary p-5 text-sm text-secondary-foreground">
          No audit sources yet. Add one above — it stays in draft until you
          approve the scope.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary text-left">
                <th className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Source
                </th>
                <th className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Targets
                </th>
                <th className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Status
                </th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {specs.map((spec) => (
                <tr key={spec.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium">{spec.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {spec.targets.length}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        spec.status === "draft"
                          ? "rounded bg-secondary px-2 py-0.5 font-mono text-[11px] text-secondary-foreground"
                          : "rounded bg-accent px-2 py-0.5 font-mono text-[11px] text-accent-foreground"
                      }
                    >
                      {STATUS_LABEL[spec.status] ?? spec.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {spec.status === "draft" && (
                      <form action={confirmScanAction}>
                        <input
                          type="hidden"
                          name="workspaceId"
                          value={params.ws}
                        />
                        <input type="hidden" name="specId" value={spec.id} />
                        <button
                          type="submit"
                          className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground"
                        >
                          Approve audit scope
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PlatinaPage>
  );
}
