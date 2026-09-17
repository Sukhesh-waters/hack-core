/**
 * Tier-1 change probe (R1). A header-only conditional request that retrieves
 * no page content — permitted as own code by the constitution; Tier-2 content
 * fetches remain Apify-only.
 *
 * Never blocks a fetch: any probe failure or missing validator returns
 * "unsupported", and the scheduler falls back to the adaptive cadence.
 */

export type ProbePrior = {
  etag?: string | null;
  lastModified?: string | null;
};

export type ProbeResult =
  | { outcome: "changed"; etag: string | null; lastModified: string | null }
  | { outcome: "unchanged" }
  | { outcome: "unsupported" };

export type ProbeFetch = (
  url: string,
  init: { method: string; headers: Record<string, string> },
) => Promise<{ status: number; headers: { get(name: string): string | null } }>;

export async function probeSource(
  url: string,
  prior: ProbePrior,
  fetchImpl: ProbeFetch,
): Promise<ProbeResult> {
  const headers: Record<string, string> = { "user-agent": "platina-probe/1.0" };
  if (prior.etag) headers["if-none-match"] = prior.etag;
  if (prior.lastModified) headers["if-modified-since"] = prior.lastModified;

  let res: Awaited<ReturnType<ProbeFetch>>;
  try {
    res = await fetchImpl(url, { method: "GET", headers });
  } catch {
    return { outcome: "unsupported" };
  }

  if (res.status === 304) return { outcome: "unchanged" };
  if (res.status === 405 || res.status === 501) return { outcome: "unsupported" };
  if (res.status >= 400) return { outcome: "unsupported" };

  const etag = res.headers.get("etag");
  const lastModified = res.headers.get("last-modified");
  if (!etag && !lastModified) return { outcome: "unsupported" };

  // Null priors (never probed) cannot equal a present validator, so the
  // first successful probe reports "changed" and the baseline fetch runs.
  if (etag && prior.etag && etag !== prior.etag) {
    return { outcome: "changed", etag, lastModified };
  }
  if (
    lastModified &&
    prior.lastModified &&
    lastModified !== prior.lastModified
  ) {
    return { outcome: "changed", etag, lastModified };
  }
  if (etag === (prior.etag ?? null) && lastModified === (prior.lastModified ?? null)) {
    return { outcome: "unchanged" };
  }
  // Validators appeared/disappeared between probes — treat as changed so the
  // fresh baseline is stored.
  return { outcome: "changed", etag, lastModified };
}
