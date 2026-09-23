import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { platinaBrands, platinaScanSpecs, type PlatinaBrandHandles, type PlatinaScanTarget } from "@/db/platina-schema";
import { clientIdentities } from "@/db/schema";
import { identityOfUrl, type Identity, type IdentityKind, type KnownParty } from "@/lib/ingest/ownership";

/**
 * The client's own sites and pages (C7.0) — the allowlist first-party
 * knowledge ingest checks every URL against. See lib/ingest/ownership.ts.
 */
export function clientIdentitiesQuery(workspaceId: string, clientId: string) {
  return db
    .select()
    .from(clientIdentities)
    .where(and(eq(clientIdentities.workspaceId, workspaceId), eq(clientIdentities.clientId, clientId)))
    .orderBy(clientIdentities.createdAt);
}

export type ClientIdentityRow = Identity & { id: string; source: string };

export async function listClientIdentities(workspaceId: string, clientId: string): Promise<ClientIdentityRow[]> {
  const rows = await clientIdentitiesQuery(workspaceId, clientId);
  return rows.map((r) => ({ id: r.id, kind: r.kind as IdentityKind, value: r.value, source: r.source }));
}

/** All identities in a workspace, grouped by client (the refresh job checks every source). */
export function workspaceIdentitiesQuery(workspaceId: string) {
  return db.select().from(clientIdentities).where(eq(clientIdentities.workspaceId, workspaceId));
}

export async function addClientIdentity(input: {
  workspaceId: string;
  clientId: string;
  identity: Identity;
  source: "seed" | "confirmed";
  addedById: string | null;
}): Promise<void> {
  await db
    .insert(clientIdentities)
    .values({
      workspaceId: input.workspaceId,
      clientId: input.clientId,
      kind: input.identity.kind,
      value: input.identity.value.toLowerCase(),
      source: input.source,
      addedById: input.addedById,
    })
    .onConflictDoNothing();
}

export function removeClientIdentityQuery(workspaceId: string, clientId: string, id: string) {
  return db
    .delete(clientIdentities)
    .where(
      and(
        eq(clientIdentities.workspaceId, workspaceId),
        eq(clientIdentities.clientId, clientId),
        eq(clientIdentities.id, id),
      ),
    );
}

export async function removeClientIdentity(workspaceId: string, clientId: string, id: string): Promise<void> {
  await removeClientIdentityQuery(workspaceId, clientId, id);
}

// ---------------------------------------------------------------------------
// Known third parties: the competitors this workspace already watches, so a
// refused URL can say "this looks like Thermo Fisher's page".
// ---------------------------------------------------------------------------

export function competitorBrandsQuery(workspaceId: string) {
  return db
    .select({
      id: platinaBrands.id,
      name: platinaBrands.name,
      homepageUrl: platinaBrands.homepageUrl,
      handles: platinaBrands.handles,
    })
    .from(platinaBrands)
    .where(and(eq(platinaBrands.workspaceId, workspaceId), eq(platinaBrands.kind, "competitor")));
}

export function brandScanTargetsQuery(workspaceId: string) {
  return db
    .select({ brandId: platinaScanSpecs.brandId, targets: platinaScanSpecs.targets })
    .from(platinaScanSpecs)
    .where(eq(platinaScanSpecs.workspaceId, workspaceId));
}

/** A scan target's value ("linkedin:@waters", a URL) as an identity, or null. */
function identityOfTarget(value: string): Identity | null {
  const tagged = /^(instagram|tiktok|linkedin):@?([A-Za-z0-9._-]+)$/i.exec(value.trim());
  if (tagged) {
    const kind = tagged[1].toLowerCase() as IdentityKind;
    const handle = tagged[2].toLowerCase();
    return { kind, value: kind === "linkedin" ? `company/${handle}` : handle };
  }
  return identityOfUrl(value);
}

/** Pure: competitor brands + their scan targets -> named parties with identities. */
export function buildKnownParties(
  brands: { id: string; name: string; homepageUrl: string | null; handles: PlatinaBrandHandles | null }[],
  specs: { brandId: string | null; targets: PlatinaScanTarget[] }[],
): KnownParty[] {
  return brands.map((b) => {
    const found: Identity[] = [];
    const push = (i: Identity | null) => {
      if (i && !found.some((f) => f.kind === i.kind && f.value === i.value)) found.push(i);
    };
    if (b.homepageUrl) push(identityOfUrl(b.homepageUrl));
    for (const [platform, handle] of Object.entries(b.handles ?? {})) {
      if (handle) push(identityOfTarget(`${platform}:@${String(handle).replace(/^@/, "")}`));
    }
    for (const spec of specs) {
      if (spec.brandId !== b.id) continue;
      for (const t of spec.targets) {
        const id = identityOfTarget(t.value);
        // An ad-library or event URL names the platform, not the company.
        if (id && !(id.kind === "domain" && /facebook\.com|linkedin\.com/.test(id.value))) push(id);
      }
    }
    return { name: b.name, identities: found };
  });
}

export async function listKnownParties(workspaceId: string): Promise<KnownParty[]> {
  const [brands, specs] = await Promise.all([competitorBrandsQuery(workspaceId), brandScanTargetsQuery(workspaceId)]);
  return buildKnownParties(brands, specs);
}
