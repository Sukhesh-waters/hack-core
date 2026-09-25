import Link from "next/link";
import { notFound } from "next/navigation";
import { CollectionBanner } from "@/components/platina/collection-banner";
import { PlatinaFormError } from "@/components/platina/form-error";
import { AutoRefresh } from "@/components/platina/auto-refresh";
import { PendingButton } from "@/components/platina/pending-button";
import { PlatinaPage } from "@/components/platina/page";
import { OwnSiteCard } from "@/components/platina/own-site-card";
import { firstPartyChunkCountsQuery, listOwnSitePages } from "@/db/queries/platina-learning";
import { summariseOwnSite } from "@/lib/platina/own-site";
import {
  countBrandStandardChunks,
  countDocsForBrands,
  getBrand,
  listEngagementDocsForBrands,
  getWorkspaceConfig,
  listAuditRuns,
  listCompetitorsOf,
  listFindingsForBrands,
  listScanSpecsForBrand,
} from "@/db/queries/platina";
import { profileIsConfirmable } from "@/lib/platina/brand-standard";
import { describeEngagement, summariseEngagement } from "@/lib/platina/engagement";
import { runSummary, type RunRow } from "@/lib/platina/run-summary";
import { confirmBrandStandardAction, readOwnSiteAction, refreshProfileAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Client" };

const KIND_LABEL: Record<string, string> = {
  competitor_site: "Website",
  press_release: "Press",
  conference: "Conference",
  trade_editorial: "Editorial",
  ad_library: "Ads",
  social_profile: "Social profile",
  social_posts: "Social posts",
};

const ago = (d: Date | null, now: Date) => {
  if (!d) return "not yet";
  const m = Math.floor((now.getTime() - d.getTime()) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.floor(m / 60)} h ago`;
  return `${Math.floor(m / 1440)} d ago`;
};

export default async function BrandPage(
  props: {
    params: Promise<{ ws: string; id: string }>;
    searchParams: Promise<{ error?: string; started?: string; analysing?: string; reading?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const brand = await getBrand(params.ws, params.id);
  if (!brand) notFound();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  const competitors = brand.kind === "own_brand" ? await listCompetitorsOf(params.ws, brand.id) : [];
  const ids = [brand.id, ...competitors.map((c) => c.id)];
  const [own, config, docCount, findings, runs, standardChunks, engagementDocs, sitePages, chunkCounts, ...competitorSpecs] = await Promise.all([
    listScanSpecsForBrand(params.ws, brand.id),
    getWorkspaceConfig(params.ws),
    countDocsForBrands(params.ws, ids),
    listFindingsForBrands(params.ws, ids, 8),
    listAuditRuns(params.ws, 60),
    countBrandStandardChunks(params.ws, brand.id),
    listEngagementDocsForBrands(params.ws, ids),
    brand.kind === "own_brand" ? listOwnSitePages(params.ws, brand.id) : Promise.resolve([]),
    brand.kind === "own_brand" ? firstPartyChunkCountsQuery(params.ws) : Promise.resolve([]),
    ...competitors.map((c) => listScanSpecsForBrand(params.ws, c.id)),
  ]);
  const specs = [...own, ...competitorSpecs.flat()];
  const nameOf = new Map([[brand.id, brand.name], ...competitors.map((c) => [c.id, c.name] as const)]);
  // One line per brand in scope that has any measured post. The min-N gate
  // lives in summariseEngagement: below it, the row says so (R4).
  const engagementRows = ids
    .map((id) => ({
      brandId: id,
      name: nameOf.get(id) ?? "Unknown",
      summary: summariseEngagement(
        engagementDocs.filter((d) => d.brandId === id),
      ),
    }))
    .filter((row) => row.summary.n > 0);
  const pagesToday = specs.reduce(
    (sum, s) => sum + (s.fetchesDay === today ? s.fetchesToday : 0),
    0,
  );
  const cap = config?.dailyActorCallCap ?? 40;

  // Newest run per source (runs arrive newest first).
  const latestRun = new Map<string, RunRow>();
  for (const r of runs) if (r.specId && !latestRun.has(r.specId)) latestRun.set(r.specId, r);
  const summaries = new Map(specs.map((sp) => [sp.id, runSummary(latestRun.get(sp.id), now)]));
  const scraping = [...summaries.values()].some((x) => x.active);
  const isClient = brand.kind === "own_brand";
  const hasApproved = specs.some((sp) => sp.status === "approved");
  // The profile is built right after the client's own pages are stored.
  const profilePending = isClient && hasApproved && !brand.profile && !brand.profileError;
  const siteSummary = summariseOwnSite(sitePages);
  const siteChunks = chunkCounts
    .filter((c) => c.brandId === brand.id && c.kind === "own_site")
    .reduce((sum, c) => sum + Number(c.chunks), 0);
  const siteReading = Boolean(searchParams.reading) && siteSummary.queued + siteSummary.changed > 0;

  return (
    <PlatinaPage
      eyebrow={brand.kind === "own_brand" ? "Client" : "Competitor"}
      title={brand.name}
      description={
        [brand.homepageUrl, brand.region].filter(Boolean).join(" · ") || undefined
      }
    >
      <AutoRefresh active={scraping || profilePending || Boolean(searchParams.analysing) || siteReading} />
      <CollectionBanner workspaceId={params.ws} />
      <PlatinaFormError message={searchParams.error} />
      {searchParams.started ? (
        <p className="mb-4 rounded-md border border-border bg-card p-3 text-sm">
          Collection is starting. The first results usually appear within a few
          minutes; if nothing shows up,{" "}
          <Link href={`/p/${params.ws}/admin/health`} className="underline underline-offset-4">
            check collection health
          </Link>
          .
        </p>
      ) : null}

      {brand.kind === "own_brand" ? (
        <p className="mb-6">
          <Link
            href={`/p/${params.ws}/plan?brand=${brand.id}`}
            className="inline-block rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
          >
            Plan a campaign for {brand.name}
          </Link>
        </p>
      ) : null}

      {isClient ? (
        <section aria-label="What we understand" className="mb-8 rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-lg font-medium">What we understand about {brand.name}</h2>
            {hasApproved ? (
              <form action={refreshProfileAction}>
                <input type="hidden" name="workspaceId" value={params.ws} />
                <input type="hidden" name="brandId" value={brand.id} />
                <PendingButton pendingLabel="Analysing…">Re-analyse</PendingButton>
              </form>
            ) : null}
          </div>
          {brand.profile ? (
            <div className="mt-3 space-y-3 text-sm">
              <p>{brand.profile.summary}</p>
              <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                {brand.profile.audience ? (
                  <div>
                    <dt className="text-xs text-muted-foreground">Audience</dt>
                    <dd>{brand.profile.audience}</dd>
                  </div>
                ) : null}
                {brand.profile.tone ? (
                  <div>
                    <dt className="text-xs text-muted-foreground">Tone</dt>
                    <dd>{brand.profile.tone}</dd>
                  </div>
                ) : null}
                {brand.profile.offers.length > 0 ? (
                  <div>
                    <dt className="text-xs text-muted-foreground">Offers</dt>
                    <dd>{brand.profile.offers.join(" · ")}</dd>
                  </div>
                ) : null}
                {brand.profile.keywords.length > 0 ? (
                  <div>
                    <dt className="text-xs text-muted-foreground">Recurring terms</dt>
                    <dd>{brand.profile.keywords.join(", ")}</dd>
                  </div>
                ) : null}
              </dl>
              {brand.profile.claims.length > 0 ? (
                <div>
                  <p className="text-xs text-muted-foreground">Claims it makes</p>
                  <ul className="list-disc pl-5">
                    {brand.profile.claims.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p className="text-xs text-muted-foreground">
                From {brand.profileSources?.length ?? 0} of {brand.name}&apos;s own page
                {(brand.profileSources?.length ?? 0) === 1 ? "" : "s"}
                {brand.profileUpdatedAt ? `, ${ago(brand.profileUpdatedAt, now)}` : ""}. Derived from
                what the site says; not verified.
              </p>
              <div className="mt-3 rounded-md border border-border bg-muted/30 p-3">
                {standardChunks > 0 ? (
                  <p className="text-sm">
                    <span className="font-medium">Confirmed as how we describe {brand.name}.</span>{" "}
                    Competitor moves are now compared against it.{" "}
                    <span className="text-muted-foreground">
                      Re-confirm after a re-analysis to update it.
                    </span>
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Confirm this as how we describe {brand.name}, and we will compare what
                    competitors say against it.
                  </p>
                )}
                {profileIsConfirmable(brand.profile) ? (
                  <form action={confirmBrandStandardAction} className="mt-2">
                    <input type="hidden" name="workspaceId" value={params.ws} />
                    <input type="hidden" name="brandId" value={brand.id} />
                    <PendingButton pendingLabel="Confirming…">
                      {standardChunks > 0 ? "Re-confirm" : "Confirm this description"}
                    </PendingButton>
                  </form>
                ) : null}
              </div>
            </div>
          ) : brand.profileError ? (
            <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              The analysis didn&apos;t work: {brand.profileError}
            </p>
          ) : profilePending ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Reading {brand.name}&apos;s website and analysing it. This page updates by itself, usually within a
              minute of the first scrape.
            </p>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              Nothing to analyse yet.{" "}
              <Link href={`/p/${params.ws}/start/${brand.id}`} className="text-primary underline-offset-4 hover:underline">
                Choose sources to watch
              </Link>
            </p>
          )}
        </section>
      ) : null}

      {isClient ? (
        <OwnSiteCard
          workspaceId={params.ws}
          brandId={brand.id}
          name={brand.name}
          homepageUrl={brand.homepageUrl}
          summary={siteSummary}
          chunks={siteChunks}
          mappedAt={brand.ownSiteMappedAt}
          mapError={brand.ownSiteError}
          failed={sitePages
            .filter((p) => p.status === "failed")
            .slice(0, 10)
            .map((p) => ({ url: p.url, error: p.error }))}
          action={readOwnSiteAction}
          now={now}
        />
      ) : null}

      {engagementRows.length > 0 ? (
        <section aria-label="Engagement" className="mb-8 rounded-lg border border-border bg-card p-4">
          <h2 className="font-display text-lg font-medium">What their posts actually get</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Measured on the posts we collected — never an estimate, and never a figure
            without the number of posts behind it.
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            {engagementRows.map((row) => (
              <li key={row.brandId} className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{row.name}</span>
                <span
                  className={
                    row.summary.status === "ready"
                      ? "text-muted-foreground"
                      : "text-muted-foreground/70"
                  }
                >
                  {describeEngagement(row.summary)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <dl className="mb-8 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <dt className="text-xs text-muted-foreground">Sources watched</dt>
          <dd className="mt-1 text-2xl font-medium">
            {specs.filter((s) => s.status === "approved").length}
          </dd>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <dt className="text-xs text-muted-foreground">Documents collected</dt>
          <dd className="mt-1 text-2xl font-medium">{docCount}</dd>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <dt className="text-xs text-muted-foreground">Pages read today</dt>
          <dd className="mt-1 text-2xl font-medium">
            {pagesToday}
            <span className="text-sm text-muted-foreground"> / {cap} workspace limit</span>
          </dd>
        </div>
      </dl>

      <h2 className="font-display text-lg font-medium">Sources</h2>
      {specs.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Nothing is being watched for this {brand.kind === "own_brand" ? "client" : "competitor"} yet.{" "}
          <Link href={`/p/${params.ws}/start/${brand.id}`} className="text-primary underline-offset-4 hover:underline">
            Choose sources
          </Link>
        </p>
      ) : (
        <div className="mt-2 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Source</th>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Last checked</th>
                <th className="px-4 py-2">Last new content</th>
              </tr>
            </thead>
            <tbody>
              {specs.map((s) => (
                <tr key={s.id} className="border-t border-border">
                  <td className="px-4 py-2">
                    {s.name}
                    {s.brandId && s.brandId !== brand.id ? (
                      <span className="block text-xs text-muted-foreground">
                        {nameOf.get(s.brandId)}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {KIND_LABEL[s.targets[0]?.kind ?? ""] ?? "—"}
                  </td>
                  <td className="px-4 py-2">
                    {s.status === "approved" ? (s.lastFailureAt && (!s.lastSuccessAt || s.lastFailureAt > s.lastSuccessAt) ? "Failing" : "Watching") : "Waiting for approval"}
                    {s.status === "approved" ? (
                      <span className="block text-xs text-muted-foreground">{summaries.get(s.id)?.text}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {ago(s.lastProbeAt ?? s.lastRunAt, now)}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{ago(s.lastSuccessAt, now)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mt-8 font-display text-lg font-medium">What we&apos;ve learned</h2>
      {findings.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Nothing yet. Findings appear here once collected pages have been analysed.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {findings.map((f) => (
            <li key={f.id} className="rounded-lg border border-border bg-card p-3">
              <p className="text-sm font-medium">{f.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{f.summary}</p>
            </li>
          ))}
        </ul>
      )}
      <Link
        href={`/p/${params.ws}/findings`}
        className="mt-3 inline-block text-sm text-primary underline-offset-4 hover:underline"
      >
        All findings
      </Link>
    </PlatinaPage>
  );
}
