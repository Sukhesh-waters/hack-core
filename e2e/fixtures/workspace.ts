/**
 * Single source of truth for the workspace used by the E2E suite.
 *
 * IMPORTANT: the `[ws]` route param is the workspace UUID, NOT the slug.
 * `/w/<uuid>/...` renders the real page; `/w/<slug>/...` returns HTTP 200
 * with a soft-404 body (Next.js notFound()), so never swap this for the
 * slug below.
 *
 * Points at the isolated `e2e-fixture` workspace created by
 * `scripts/seed-e2e-fixture.ts` (idempotent — re-run it any time):
 *
 *   set -a; source .env.local; set +a; npx tsx scripts/seed-e2e-fixture.ts
 *
 * Deliberately NOT a workspace holding real client data. Mutating specs
 * (start a run, assign a step, decide a gate) write real rows, so pointing
 * them at a live client workspace would make the suite order-dependent and
 * destructive. This fixture is also the only workspace with TWO members,
 * which the dual-user realtime specs require.
 */
export const WORKSPACE_ID = "1f3f82d4-470a-494d-8e56-29ac9372e94f";

/** Human-readable slug for the same workspace — for reference/logging only.
 *  Never use this in a route path; see the warning above. */
export const WORKSPACE_SLUG = "e2e-fixture";

export function workspacePath(subPath: string): string {
  const trimmed = subPath.startsWith("/") ? subPath.slice(1) : subPath;
  return `/w/${WORKSPACE_ID}/${trimmed}`;
}

/** Text that appears in the body whenever Next.js's notFound() renders,
 *  which happens with HTTP 200 (not a 4xx) — so tests must assert its
 *  absence explicitly rather than trusting response status. */
export const NOT_FOUND_TEXT = "This page could not be found";
