import Link from "next/link";
import { notFound } from "next/navigation";
import { PlatinaFormError } from "@/components/platina/form-error";
import { PlatinaPage } from "@/components/platina/page";
import { PendingButton } from "@/components/platina/pending-button";
import { getBrand, getWorkspaceConfig } from "@/db/queries/platina";
import {
  DEFAULT_FIRST_PASS_PAGES,
  DEFAULT_WORKSPACE_DAY_CAP,
  describeBudget,
  firstPassRemaining,
} from "@/lib/platina/fetch/budget";
import {
  fetchSitemapText,
  headProbeFetch,
} from "@/lib/platina/fetch/probe-fetch";
import {
  proposeCompetitors,
  type CompetitorProposal,
} from "@/lib/platina/onboard/competitors";
import { deriveSources, normalizeHomepage } from "@/lib/platina/onboard/derive";
import { enrichFromSitemap } from "@/lib/platina/onboard/sitemap";
import {
  discoverCandidates,
  preselected,
  sitemapFound,
  type Discovered,
} from "@/lib/platina/onboard/discover";
import { approveClientSourcesAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "What we'll watch" };

const input =
  "w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm";
const BLANK_ROWS = 3;

function Found({ c }: { c: Discovered }) {
  if (c.exists === true)
    return <span className="text-brand-success">Found</span>;
  if (c.exists === false)
    return <span className="text-muted-foreground">Not found</span>;
  if (c.kind === "social_profile" || c.kind === "social_posts") return null;
  return <span className="text-muted-foreground">Couldn&apos;t check</span>;
}

export default async function SourcesPage(
  props: {
    params: Promise<{ ws: string; brandId: string }>;
    searchParams: Promise<{ error?: string; suggest?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const brand = await getBrand(params.ws, params.brandId);
  if (!brand || brand.kind !== "own_brand") notFound();

  const [probed, config] = await Promise.all([
    discoverCandidates(
      deriveSources({
        homepageUrl: brand.homepageUrl ?? "",
        handles: brand.handles,
        brandName: brand.name,
      }),
      headProbeFetch,
    ),
    getWorkspaceConfig(params.ws),
  ]);
  // When the site publishes a sitemap, replace guessing with what it lists.
  const origin = normalizeHomepage(brand.homepageUrl ?? "");
  const found = origin
    ? await enrichFromSitemap(probed, origin, fetchSitemapText)
    : probed;
  const sources = found.filter((c) => !c.discovery);
  const sitemap = sitemapFound(found);
  const dailyCap = config?.dailyActorCallCap ?? DEFAULT_WORKSPACE_DAY_CAP;
  // What this client may still spend from its one-time first-pass allowance,
  // so the operator knows the cost before approving anything (R7).
  const firstPassLeft = firstPassRemaining(
    brand.firstPassPagesUsed,
    config?.firstPassPageAllowance ?? DEFAULT_FIRST_PASS_PAGES,
  );
  const firstPass = sources
    .filter(preselected)
    .reduce((sum, c) => sum + c.maxPages, 0);

  let proposals: CompetitorProposal[] = [];
  let suggestError: string | null = null;
  if (searchParams.suggest === "1") {
    try {
      proposals = await proposeCompetitors({
        name: brand.name,
        homepageUrl: brand.homepageUrl,
        region: brand.region,
      });
      if (proposals.length === 0)
        suggestError =
          "We had no confident suggestions — add competitors yourself.";
    } catch {
      suggestError = "We couldn't suggest competitors — add them yourself.";
    }
  }
  const rows: { name: string; url: string; on: boolean }[] = [
    ...proposals.map((p) => ({ name: p.name, url: p.homepageUrl, on: true })),
    ...Array.from({ length: BLANK_ROWS }, () => ({
      name: "",
      url: "",
      on: false,
    })),
  ];

  return (
    <PlatinaPage
      eyebrow={`Add a client · ${brand.name}`}
      title="Here's what we'll watch"
      description="Untick anything you don't want. Nothing is collected until you press the button at the bottom."
    >
      <PlatinaFormError
        message={searchParams.error ?? suggestError ?? undefined}
      />
      <form action={approveClientSourcesAction} className="max-w-2xl">
        <input type="hidden" name="workspaceId" value={params.ws} />
        <input type="hidden" name="brandId" value={brand.id} />
        {sitemap ? <input type="hidden" name="sitemap" value="1" /> : null}

        <h2 className="font-display text-lg font-medium">{brand.name}</h2>
        {sources.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            There is nothing to derive yet — add a website or a social handle.{" "}
            <Link
              href={`/p/${params.ws}/start`}
              className="text-primary underline-offset-4 hover:underline"
            >
              Start again
            </Link>
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {sources.map((c) => (
              <li
                key={c.id}
                className="rounded-lg border border-border bg-card p-3"
              >
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    name="source"
                    value={c.id}
                    defaultChecked={preselected(c)}
                    className="mt-1"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block break-all text-sm font-medium">
                      {c.value}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {c.reason} · up to {c.maxPages}{" "}
                      {c.maxPages === 1 ? "page" : "pages"} per pass
                    </span>
                  </span>
                  <span className="text-xs">
                    <Found c={c} />
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {sitemap ? (
          <p className="mt-2 text-xs text-muted-foreground">
            This site publishes a sitemap, so we&apos;ll use it to reach more
            pages.
          </p>
        ) : null}

        <div className="mt-8 flex items-baseline justify-between">
          <h2 className="font-display text-lg font-medium">Competitors</h2>
          {searchParams.suggest === "1" ? null : (
            <Link
              href={`/p/${params.ws}/start/${brand.id}?suggest=1`}
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              Suggest competitors
            </Link>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Add the companies to watch alongside {brand.name}. Suggestions are
          drafts — check each website.
        </p>
        <ul className="mt-3 space-y-2">
          {rows.map((row, i) => (
            <li key={i} className="flex items-center gap-2">
              <input
                type="checkbox"
                name="compOn"
                value={i}
                defaultChecked={row.on}
                aria-label="Include"
              />
              <input
                name="compName"
                defaultValue={row.name}
                placeholder="Competitor name"
                className={input}
              />
              <input
                name="compUrl"
                defaultValue={row.url}
                placeholder="competitor.com"
                className={input}
              />
            </li>
          ))}
        </ul>

        <p className="mt-6 text-xs text-muted-foreground">
          A full first pass over the pre-ticked sources reads up to {firstPass}{" "}
          pages. {describeBudget(firstPassLeft, dailyCap)}
          {firstPass > firstPassLeft
            ? " Anything beyond that allowance spreads over the days after."
            : ""}
        </p>
        <div className="mt-3">
          <PendingButton pendingLabel="Starting…">
            Start collecting for {brand.name}
          </PendingButton>
        </div>
      </form>
    </PlatinaPage>
  );
}
