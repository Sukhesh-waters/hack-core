import Link from "next/link";
import { PlatinaPage } from "@/components/platina/page";
import { getWorkspaceConfig, getWorkspaceProfile } from "@/db/queries/platina";
import { saveConfigAction, saveProfileAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Platina admin" };

export default async function AdminPage({
  params,
}: {
  params: { ws: string };
}) {
  const [config, profile] = await Promise.all([
    getWorkspaceConfig(params.ws),
    getWorkspaceProfile(params.ws),
  ]);

  return (
    <PlatinaPage
      eyebrow="Platina · Admin"
      title="Workspace administration"
      description="Configuration for authorized users. Changes apply to future runs only — they never rewrite recorded history."
    >
      <div className="mb-8 grid gap-3 md:grid-cols-2">
        <Link
          href={`/p/${params.ws}/admin/brand`}
          className="rounded-lg border border-border bg-card p-4 transition-colors hover:bg-accent/50"
        >
          <p className="font-medium">Brand standard</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Declare and confirm the approved brand standard — the evidence
            every solution must anchor to.
          </p>
        </Link>
        <Link
          href={`/p/${params.ws}/admin/claims`}
          className="rounded-lg border border-border bg-card p-4 transition-colors hover:bg-accent/50"
        >
          <p className="font-medium">Claims and terminology</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Screen marketing copy against the claims rules.
          </p>
        </Link>
      </div>

      <section aria-label="Division and region" className="mb-8 max-w-md">
        <h2 className="font-display text-lg font-medium">
          Division and region
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          One workspace is one division × region operating boundary. This
          labels the scope on every primary surface; it never changes which
          data the workspace can see.
        </p>
        <form action={saveProfileAction} className="mt-4 grid gap-3">
          <input type="hidden" name="workspaceId" value={params.ws} />
          <label className="text-xs font-medium">
            Division
            <input
              name="division"
              defaultValue={profile?.division ?? ""}
              placeholder="Life Sciences"
              className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs font-medium">
            Region
            <input
              name="region"
              defaultValue={profile?.region ?? ""}
              placeholder="North America"
              className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs font-medium">
            Business unit (optional)
            <input
              name="businessUnit"
              defaultValue={profile?.businessUnit ?? ""}
              className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <button
            type="submit"
            className="mt-1 w-fit rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
          >
            Save profile
          </button>
        </form>
      </section>

      <section aria-label="Thresholds" className="max-w-md">
        <h2 className="font-display text-lg font-medium">Thresholds</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Minimum evidence and validation floors. Plane separation, the
          single-round validation pass, and the existence of approvals are not
          configurable.
        </p>
        <form action={saveConfigAction} className="mt-4 grid gap-3">
          <input type="hidden" name="workspaceId" value={params.ws} />
          <label className="text-xs font-medium">
            Minimum approved-evidence sample
            <input
              name="minBaselineN"
              type="number"
              defaultValue={config?.minBaselineN ?? 20}
              className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs font-medium">
            Contested floor
            <input
              name="contestedFloor"
              type="number"
              step="0.05"
              defaultValue={config?.contestedFloor ?? 0.4}
              className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs font-medium">
            Qualified floor
            <input
              name="qualifiedFloor"
              type="number"
              step="0.05"
              defaultValue={config?.qualifiedFloor ?? 0.7}
              className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <button
            type="submit"
            className="mt-1 w-fit rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
          >
            Save thresholds
          </button>
        </form>
      </section>
    </PlatinaPage>
  );
}
