import { PlatinaPage } from "@/components/platina/page";
import { getWorkspaceConfig, upsertWorkspaceConfig } from "@/db/queries/platina";

export const dynamic = "force-dynamic";

async function saveConfig(formData: FormData) {
  "use server";
  const ws = String(formData.get("workspaceId"));
  await upsertWorkspaceConfig(ws, {
    minBaselineN: Number(formData.get("minBaselineN") ?? 20),
    contestedFloor: Number(formData.get("contestedFloor") ?? 0.4),
    qualifiedFloor: Number(formData.get("qualifiedFloor") ?? 0.7),
  });
}

export default async function ConfigPage({
  params,
}: {
  params: { ws: string };
}) {
  const config = await getWorkspaceConfig(params.ws);

  return (
    <PlatinaPage eyebrow="SOP harness" title="Workspace config">
      <p className="mb-4 text-sm text-muted-foreground">
        Thresholds are per-workspace. Plane separation, one-round contradiction,
        and gate existence are not configurable.
      </p>
      <form action={saveConfig} className="grid max-w-sm gap-2">
        <input type="hidden" name="workspaceId" value={params.ws} />
        <label className="text-xs">
          Min-N
          <input
            name="minBaselineN"
            type="number"
            defaultValue={config?.minBaselineN ?? 20}
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1"
          />
        </label>
        <label className="text-xs">
          Contested floor
          <input
            name="contestedFloor"
            type="number"
            step="0.05"
            defaultValue={config?.contestedFloor ?? 0.4}
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1"
          />
        </label>
        <label className="text-xs">
          Qualified floor
          <input
            name="qualifiedFloor"
            type="number"
            step="0.05"
            defaultValue={config?.qualifiedFloor ?? 0.7}
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1"
          />
        </label>
        <button
          type="submit"
          className="mt-2 rounded-md border border-border px-3 py-1.5 text-sm"
        >
          Save
        </button>
      </form>
    </PlatinaPage>
  );
}
