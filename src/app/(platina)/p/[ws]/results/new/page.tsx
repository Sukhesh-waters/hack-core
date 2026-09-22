import Link from "next/link";
import { PlatinaFormError } from "@/components/platina/form-error";
import { PlatinaPage } from "@/components/platina/page";
import { PendingButton } from "@/components/platina/pending-button";
import { getPlan, listBrands } from "@/db/queries/platina";
import { addCreativeAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Log a creative" };

const CHANNELS = ["linkedin", "instagram", "facebook", "tiktok", "youtube", "x", "email", "website", "event", "other"];
const FORMATS = ["single image", "carousel", "video", "document", "text", "article", "webinar", "event booth", "email", "other"];
const HOOKS = ["question", "stat", "proof", "story", "offer", "how-to", "news"];

const field = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

export default async function NewCreativePage({
  params,
  searchParams,
}: {
  params: { ws: string };
  searchParams: { brand?: string; plan?: string; phase?: string; opp?: string; topic?: string; error?: string };
}) {
  const [brands, plan] = await Promise.all([
    listBrands(params.ws),
    searchParams.plan ? getPlan(params.ws, searchParams.plan) : Promise.resolve(null),
  ]);
  const clients = brands.filter((b) => b.kind === "own_brand");
  const phase = plan && searchParams.phase ? plan.plan.phases.find((p) => p.id === searchParams.phase) ?? null : null;
  const brandId = searchParams.brand ?? plan?.brandId ?? clients[0]?.id ?? "";
  const channel = phase?.channel?.toLowerCase();

  return (
    <PlatinaPage
      eyebrow="Learning loop"
      title="Log a creative"
      description="One posted piece. Its descriptors are what results get credited to; the one-line expectation is what the review reads the numbers against."
    >
      <PlatinaFormError message={searchParams.error} />
      {plan ? (
        <p className="mb-4 rounded-md border border-border bg-card p-3 text-sm">
          From plan <span className="font-medium">{plan.title}</span>
          {phase ? (
            <>
              , phase <span className="font-medium">{phase.name}</span> ({phase.channel}): {phase.message}
            </>
          ) : null}
          . A result here is traced back to the evidence this phase cited.
        </p>
      ) : searchParams.opp ? (
        <p className="mb-4 rounded-md border border-border bg-card p-3 text-sm">
          Answers the opportunity <span className="font-medium">{searchParams.opp.replace(/^(topic|event):/, "")}</span>.
        </p>
      ) : null}

      <form action={addCreativeAction} className="grid max-w-3xl gap-4 sm:grid-cols-2">
        <input type="hidden" name="workspaceId" value={params.ws} />
        {searchParams.plan ? <input type="hidden" name="plan" value={searchParams.plan} /> : null}
        {searchParams.phase ? <input type="hidden" name="phase" value={searchParams.phase} /> : null}
        {searchParams.opp ? <input type="hidden" name="opp" value={searchParams.opp} /> : null}

        <label className="sm:col-span-2 text-sm">
          Title
          <input name="title" required minLength={3} defaultValue={phase?.name ?? ""} className={`mt-1 ${field}`} />
        </label>
        <label className="text-sm">
          Client
          <select name="brand" defaultValue={brandId} className={`mt-1 ${field}`}>
            <option value="">Workspace-wide</option>
            {clients.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Topic
          <input name="topic" defaultValue={searchParams.topic ?? ""} placeholder="e.g. mass spectrometry" className={`mt-1 ${field}`} />
        </label>
        <label className="text-sm">
          Channel
          <select name="channel" required defaultValue={CHANNELS.includes(channel ?? "") ? channel : "linkedin"} className={`mt-1 ${field}`}>
            {CHANNELS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Format
          <select name="format" required defaultValue="single image" className={`mt-1 ${field}`}>
            {FORMATS.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Hook
          <select name="hookType" defaultValue="" className={`mt-1 ${field}`}>
            <option value="">—</option>
            {HOOKS.map((h) => (
              <option key={h}>{h}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Call to action
          <input name="cta" placeholder="e.g. Book a demo" className={`mt-1 ${field}`} />
        </label>
        <label className="text-sm">
          Posted on
          <input type="date" name="postedAt" className={`mt-1 ${field}`} />
        </label>
        <label className="text-sm">
          Link to the post
          <input name="url" type="url" placeholder="https://www.linkedin.com/feed/update/..." className={`mt-1 ${field}`} />
          <span className="mt-1 block text-xs text-muted-foreground">Spreadsheet imports match rows by this link.</span>
        </label>
        <label className="sm:col-span-2 text-sm">
          What we expect, and why
          <textarea
            name="hypothesis"
            required
            minLength={10}
            rows={2}
            defaultValue={phase?.message ?? ""}
            placeholder="e.g. QC managers will engage more than usual because GLP-1 testing interest is rising"
            className={`mt-1 ${field}`}
          />
        </label>
        <div className="sm:col-span-2 flex items-center gap-3">
          <PendingButton pendingLabel="Saving…">Log creative</PendingButton>
          <Link href={`/p/${params.ws}/results`} className="text-sm text-muted-foreground underline-offset-4 hover:underline">
            Cancel
          </Link>
        </div>
      </form>
    </PlatinaPage>
  );
}
