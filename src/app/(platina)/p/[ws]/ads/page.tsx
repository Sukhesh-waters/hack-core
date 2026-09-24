import Link from "next/link";
import { PlatinaFormError } from "@/components/platina/form-error";
import { PlatinaPage } from "@/components/platina/page";
import { PendingButton } from "@/components/platina/pending-button";
import { RunProgress } from "@/components/platina/run-progress";
import { loadAdsView } from "@/lib/platina/ads-load";
import { prepareAdScan } from "@/lib/platina/ads-scan-run";
import type { AdCard, AdColumn, AdDetection } from "@/lib/platina/ads-view";
import { cn } from "@/lib/utils";
import { scanAdsAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ads" };

const card = "rounded-lg border border-border bg-card p-4";
const heading = "font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground";
const chip = "rounded-full border px-2.5 py-0.5 text-xs";
const link = "text-primary underline-offset-4 hover:underline";

/** Ads shown per company before "show all". */
const SHOWN = 6;

const KIND_LABEL: Record<AdDetection["kind"], string> = {
  region_gap: "Region gap",
  push: "Competitor push",
  theme_gap: "Ad white space",
  long_runner: "Long runner",
};

const fmtDay = (d: string | null) =>
  d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—";

function AdCardView({ ad }: { ad: AdCard }) {
  return (
    <li className="rounded-md border border-border bg-background p-3 text-sm">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className={cn(chip, "border-border py-0 text-[11px]")}>{ad.platform === "linkedin" ? "LinkedIn" : "Meta"}</span>
        {ad.active ? <span className={cn(chip, "border-primary/40 py-0 text-[11px] text-primary")}>running</span> : <span className="text-muted-foreground">ended</span>}
        {ad.isNew ? <span className={cn(chip, "border-amber-500/50 py-0 text-[11px] text-amber-700 dark:text-amber-400")}>new this week</span> : null}
        {ad.inRegion ? <span className={cn(chip, "border-emerald-500/50 py-0 text-[11px] text-emerald-700 dark:text-emerald-400")}>shown in the Gulf</span> : null}
      </div>
      {ad.headline ? <p className="mt-2 font-medium leading-snug">{ad.headline}</p> : null}
      <details className="mt-1 text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none line-clamp-2 [&::-webkit-details-marker]:hidden">{ad.text}</summary>
        <p className="mt-1 whitespace-pre-line">{ad.text}</p>
      </details>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs">
        <dt className="text-muted-foreground">Ran</dt>
        <dd>
          {fmtDay(ad.startedOn)} → {ad.active ? "now" : fmtDay(ad.endedOn)}
          {ad.daysRunning !== null ? ` · ${ad.daysRunning} day${ad.daysRunning === 1 ? "" : "s"}` : ""}
        </dd>
        <dt className="text-muted-foreground">Impressions</dt>
        <dd>{ad.impressions ? `${ad.impressions} (the library's range)` : "not published"}</dd>
        {ad.countries.length > 0 ? (
          <>
            <dt className="text-muted-foreground">Shown in</dt>
            <dd>
              {ad.countries
                .slice(0, 5)
                .map((c) => `${c.name}${c.share ? ` ${c.share}` : ""}`)
                .join(", ")}
              {ad.countries.length > 5 ? ` +${ad.countries.length - 5} more` : ""}
            </dd>
          </>
        ) : null}
        {ad.topics.length > 0 ? (
          <>
            <dt className="text-muted-foreground">About</dt>
            <dd className="capitalize">{ad.topics.join(", ")}</dd>
          </>
        ) : null}
      </dl>
      <p className="mt-2 flex flex-wrap gap-3 text-xs">
        <a href={ad.libraryUrl} target="_blank" rel="noopener noreferrer" className={link}>
          In the ad library ↗
        </a>
        {ad.landingUrl ? (
          <a href={ad.landingUrl} target="_blank" rel="noopener noreferrer" className={link}>
            Landing page ↗
          </a>
        ) : null}
      </p>
    </li>
  );
}

function Column({ col }: { col: AdColumn }) {
  const shown = col.ads.slice(0, SHOWN);
  const rest = col.ads.slice(SHOWN);
  return (
    <section className={cn(card, "w-[19rem] shrink-0", col.isClient && "border-primary/50")} aria-label={`${col.name} ads`}>
      <h3 className="font-medium">
        {col.name}
        {col.isClient ? <span className="ml-2 text-xs font-normal text-primary">client</span> : null}
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        {col.ads.length} ads · {col.active} running · {col.newThisWeek} new this week · {col.regionAds} shown in the Gulf
      </p>
      {col.topTopics.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {col.topTopics.map((t) => (
            <li key={t.topic} className={cn(chip, "border-border capitalize")}>
              {t.topic} <span className="text-muted-foreground">· {t.ads}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {col.ads.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {col.lastRead ? "No ads by this advertiser in the library." : "Not scanned yet."}
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {shown.map((a) => (
            <AdCardView key={a.key} ad={a} />
          ))}
          {rest.length > 0 ? (
            <li>
              <details>
                <summary className="cursor-pointer text-xs text-primary">Show {rest.length} more</summary>
                <ul className="mt-2 space-y-2">
                  {rest.map((a) => (
                    <AdCardView key={a.key} ad={a} />
                  ))}
                </ul>
              </details>
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}

/**
 * Ads (C8.3): what the client and its competitors advertise, read from the
 * public LinkedIn and Meta ad libraries through Apify. No ad account is
 * connected and nothing is ever written to one. Every measure is activity
 * (which ads ran, when, how long, where), never performance.
 */
export default async function AdsPage(props: {
  params: Promise<{ ws: string }>;
  searchParams: Promise<{ runs?: string; error?: string }>;
}) {
  const { ws } = await props.params;
  const sp = await props.searchParams;
  const now = new Date();
  const [loaded, prepared] = await Promise.all([loadAdsView(ws, now), prepareAdScan(ws)]);
  if (!loaded || !prepared) {
    return (
      <PlatinaPage eyebrow="Watch" title="Ads">
        <p className="text-sm text-muted-foreground">
          Add a client first.{" "}
          <Link href={`/p/${ws}/start`} className={link}>
            Add a client
          </Link>
        </p>
      </PlatinaPage>
    );
  }
  const { client, view } = loaded;
  const { plan } = prepared;
  const runIds = (sp.runs ?? "").split(",").filter((r) => /^[\w-]{8,}$/.test(r)).slice(0, 12);

  return (
    <PlatinaPage
      eyebrow="Watch"
      title="Ads"
      description={`What ${client.name} and its competitors advertise, from the public LinkedIn and Meta ad libraries. Activity, not performance: no library publishes spend, clicks or results, so none is shown.`}
    >
      <PlatinaFormError message={sp.error} />

      <section aria-label="Scan now" className={card}>
        <form action={scanAdsAction}>
          <input type="hidden" name="workspaceId" value={ws} />
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className={heading}>Scan the LinkedIn Ad Library now</h2>
            <p className="text-xs text-muted-foreground">
              Up to {plan.maxAds} ads · up to ${plan.projectedUsd.toFixed(2)} on Apify
              {prepared.usedUsd !== null && prepared.capUsd !== null
                ? ` · $${(prepared.capUsd - prepared.usedUsd).toFixed(2)} left this month${prepared.resetsOn ? ` (resets ${fmtDay(prepared.resetsOn)})` : ""}`
                : " · Apify usage could not be read"}
            </p>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {plan.rows.map((r) => (
              <label key={r.brandId} className="text-sm">
                <span className="text-xs text-muted-foreground">
                  {r.name}
                  {r.isClient ? " (client)" : ""} · advertiser name on LinkedIn
                </span>
                <input
                  name={`advertiser:${r.brandId}`}
                  defaultValue={r.advertiser}
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                />
              </label>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <PendingButton pendingLabel="Starting…" disabled={!plan.allowed}>
              Scan now
            </PendingButton>
            <p className="text-xs text-muted-foreground">
              {plan.allowed
                ? `Reads up to ${plan.rows[0]?.maxAds ?? 0} recent ads per advertiser with their dates, impression range and countries. Scanned again every week.`
                : plan.reason}{" "}
              The library&apos;s search is loose (&quot;Waters&quot; also finds water utilities), so use the exact advertiser name; other advertisers are dropped.
            </p>
          </div>
        </form>
      </section>

      {runIds.length > 0 ? (
        <section aria-label="Scan progress" className="mt-4 grid gap-3 md:grid-cols-2">
          {runIds.map((id) => (
            <RunProgress key={id} ws={ws} runId={id} />
          ))}
        </section>
      ) : null}

      <section aria-label="What the ads show" className="mt-6">
        <h2 className={heading}>What the ads show</h2>
        {view.detections.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {view.totals.ads === 0
              ? "No ads collected yet. Scan now to read the libraries."
              : "Nothing passed the evidence thresholds yet (a push needs 3 new ads on one subject in 30 days; a region gap needs 2 competitor ads shown in the Gulf)."}
          </p>
        ) : (
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {view.detections.map((d) => (
              <li key={d.key} className={card}>
                <p className="text-[11px] font-medium uppercase tracking-wide text-primary">{KIND_LABEL[d.kind]}</p>
                <h3 className="mt-1 font-medium">{d.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{d.detail}</p>
                <ul className="mt-2 space-y-0.5 text-xs">
                  {d.proofs.map((p) => (
                    <li key={p.url}>
                      <a href={p.url} target="_blank" rel="noopener noreferrer" className={link}>
                        {p.label} ↗
                      </a>
                    </li>
                  ))}
                </ul>
                {d.kind !== "long_runner" ? (
                  <p className="mt-2 text-xs">
                    <Link href={`/p/${ws}/plan?goal=${encodeURIComponent(`${client.name}: answer — ${d.title}`)}`} className={link}>
                      Plan a response →
                    </Link>
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          These findings also go to the Brain, so Opportunities, the planner and the Brain map use them.
        </p>
      </section>

      <section aria-label="Side by side" className="mt-6">
        <h2 className={heading}>
          Side by side · {view.totals.ads} ads ({view.totals.linkedin} LinkedIn, {view.totals.meta} Meta) · {view.totals.active} running ·{" "}
          {view.totals.newThisWeek} new this week
        </h2>
        <div className="mt-3 flex gap-3 overflow-x-auto pb-2">
          {view.columns.map((c) => (
            <Column key={c.brandId} col={c} />
          ))}
        </div>
      </section>
    </PlatinaPage>
  );
}
