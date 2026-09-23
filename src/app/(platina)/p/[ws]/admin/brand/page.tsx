import { PlatinaFormError } from "@/components/platina/form-error";
import { PlatinaPage } from "@/components/platina/page";
import {
  listBrandChunks,
  listBrandSources,
  listGateEvents,
} from "@/db/queries/platina";
import {
  addBrandSourceAction,
  confirmBrandSourceAction,
  declareBrandAction,
  refreshBrandSourceAction,
} from "../../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Platina admin — brand standard" };

export default async function AdminBrandPage(
  props: {
    params: Promise<{ ws: string }>;
    searchParams: Promise<{ error?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const [chunks, gates, sources] = await Promise.all([
    listBrandChunks(params.ws),
    listGateEvents(params.ws),
    listBrandSources(params.ws),
  ]);
  const confirmed = gates.filter((g) => g.gate === "declare");

  return (
    <PlatinaPage
      eyebrow="Platina · Admin"
      title="Brand standard"
      description="Declare the approved standard — voice, terminology, claims the brand never makes. Declaring writes an immutable approval record."
    >
      <PlatinaFormError message={searchParams.error} />

      <section aria-label="Declare directly" className="mb-8">
        <form
          action={declareBrandAction}
          className="rounded-lg border border-border bg-card p-4"
        >
          <h2 className="text-sm font-medium">Declare directly</h2>
          <input type="hidden" name="workspaceId" value={params.ws} />
          <textarea
            name="content"
            required
            rows={4}
            placeholder="Declare the brand standard — voice, claims we never make, terminology."
            className="mt-2 w-full rounded-md border border-input bg-background p-3 text-sm"
          />
          <button
            type="submit"
            className="mt-3 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
          >
            Confirm brand standard
          </button>
        </form>
      </section>

      <section aria-label="Brand sources" className="mb-8">
        <h2 className="font-display text-lg font-medium">Sources</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Approved origins of the standard, re-fetched daily. A changed source
          re-chunks and supersedes its old evidence; an unchanged source
          produces nothing.
        </p>
        <form
          action={addBrandSourceAction}
          className="mt-3 grid gap-2 rounded-lg border border-border bg-card p-4 md:grid-cols-2"
        >
          <input type="hidden" name="workspaceId" value={params.ws} />
          <input
            name="title"
            required
            placeholder="Brand guidelines (public URL or pasted text)"
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <input
            name="url"
            placeholder="https://example.com/brand-guidelines (optional)"
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <textarea
            name="pasted"
            rows={2}
            placeholder="…or paste the standard text"
            className="rounded-md border border-input bg-background p-3 text-sm md:col-span-2"
          />
          <button
            type="submit"
            className="w-fit rounded-md border border-border px-3 py-1.5 text-sm"
          >
            Add source (draft)
          </button>
        </form>

        {sources.length > 0 && (
          <ul className="mt-3 space-y-2">
            {sources.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3 text-sm"
              >
                <div>
                  <p className="font-medium">{s.title}</p>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {s.status}
                    {s.lastFetchedAt
                      ? ` · checked ${s.lastFetchedAt.toISOString().slice(0, 10)}`
                      : ""}
                    {s.lastChangedAt
                      ? ` · changed ${s.lastChangedAt.toISOString().slice(0, 10)}`
                      : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  {s.status === "draft" && (
                    <form action={confirmBrandSourceAction}>
                      <input type="hidden" name="workspaceId" value={params.ws} />
                      <input type="hidden" name="sourceId" value={s.id} />
                      <button
                        type="submit"
                        className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground"
                      >
                        Confirm source
                      </button>
                    </form>
                  )}
                  {s.status === "approved" && s.url && (
                    <form action={refreshBrandSourceAction}>
                      <input type="hidden" name="workspaceId" value={params.ws} />
                      <input type="hidden" name="sourceId" value={s.id} />
                      <button
                        type="submit"
                        className="rounded-md border border-border px-3 py-1.5 text-xs"
                      >
                        Refresh now
                      </button>
                    </form>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="The standard">
        <h2 className="font-display text-lg font-medium">
          The approved standard
        </h2>
        <p className="mt-1 font-mono text-[11px] text-muted-foreground">
          {chunks.length} active chunks · {confirmed.length} confirmations
          recorded
        </p>
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
                {c.title && (
                  <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {c.title}
                  </p>
                )}
                {c.content}
              </li>
            ))}
          </ul>
        )}
      </section>
    </PlatinaPage>
  );
}
