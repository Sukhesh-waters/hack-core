import { PlatinaFormError } from "@/components/platina/form-error";
import { PlatinaPage } from "@/components/platina/page";
import { listBrandChunks, listGateEvents } from "@/db/queries/platina";
import { declareBrandAction } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Platina admin — brand standard" };

export default async function AdminBrandPage({
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
  const confirmed = gates.filter((g) => g.gate === "declare");

  return (
    <PlatinaPage
      eyebrow="Platina · Admin"
      title="Brand standard"
      description="Declare the approved standard — voice, terminology, claims the brand never makes. Declaring writes an immutable approval record."
    >
      <PlatinaFormError message={searchParams.error} />
      <form
        action={declareBrandAction}
        className="mb-8 rounded-lg border border-border bg-card p-4"
      >
        <input type="hidden" name="workspaceId" value={params.ws} />
        <textarea
          name="content"
          required
          rows={5}
          placeholder="Declare the brand standard — voice, claims we never make, terminology."
          className="w-full rounded-md border border-input bg-background p-3 text-sm"
        />
        <button
          type="submit"
          className="mt-3 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
        >
          Confirm brand standard
        </button>
      </form>

      <h2 className="font-display text-lg font-medium">Approved evidence</h2>
      {chunks.length === 0 ? (
        <div className="mt-3 rounded-lg border border-border bg-secondary p-5 text-sm text-secondary-foreground">
          No declared standards yet. Solutions cannot be drafted until the
          standard is confirmed here.
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {chunks.map((c) => (
            <li
              key={c.id}
              className="rounded-lg border border-border bg-card p-3 text-sm"
            >
              {c.content}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 font-mono text-[11px] text-muted-foreground">
        {confirmed.length} confirmations recorded
      </p>
    </PlatinaPage>
  );
}
