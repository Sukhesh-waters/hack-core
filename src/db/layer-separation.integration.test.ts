import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import {
  clients,
  memberships,
  orgs,
  patternAds,
  patternPosts,
  posts,
  users,
  workspaces,
} from "@/db/schema";
import { getBaselinePoints } from "@/db/queries/posts";
import { countPatternPosts } from "@/db/queries/accounts";

/**
 * W3 "Done =" proof, against a real Postgres (CI service container):
 * a public row must never surface as performance truth. Runs only when
 * INTEGRATION_DB=1 (CI); local suites skip it.
 */
describe.skipIf(process.env.INTEGRATION_DB !== "1")(
  "layer separation (live database)",
  () => {
    const ids = {
      user: randomUUID(),
      org: randomUUID(),
      workspace: randomUUID(),
      client: randomUUID(),
    };

    afterAll(async () => {
      await db.delete(orgs).where(eq(orgs.id, ids.org)); // cascades workspace → rows
      await db.delete(users).where(eq(users.id, ids.user));
    });

    it("a public row never enters the baseline", async () => {
      await db
        .insert(users)
        .values({ id: ids.user, email: `${ids.user}@t.io` });
      await db.insert(orgs).values({
        id: ids.org,
        name: "T",
        slug: `t-${ids.org.slice(0, 8)}`,
        ownerUserId: ids.user,
      });
      await db.insert(workspaces).values({
        id: ids.workspace,
        orgId: ids.org,
        name: "T",
        slug: `tw-${ids.workspace.slice(0, 8)}`,
      });
      await db.insert(memberships).values({
        workspaceId: ids.workspace,
        userId: ids.user,
        role: "owner",
      });
      await db.insert(clients).values({
        id: ids.client,
        workspaceId: ids.workspace,
        name: "Test client",
      });

      // 25 first-party truth rows…
      await db.insert(posts).values(
        Array.from({ length: 25 }, (_, i) => ({
          workspaceId: ids.workspace,
          clientId: ids.client,
          source: "first_party" as const,
          postedAt: new Date(Date.UTC(2026, 0, 1 + i)),
          engagementRate: 0.05 + i * 0.001,
          scoreStatus: "scored" as const,
        })),
      );
      // …one misrouted public row in the posts table…
      await db.insert(posts).values({
        workspaceId: ids.workspace,
        clientId: ids.client,
        source: "public" as const,
        postedAt: new Date(Date.UTC(2026, 5, 1)),
        engagementRate: 99, // absurd — would wreck the baseline if it leaked
        scoreStatus: "unscored" as const,
      });
      // …and a proper pattern-layer row in its own namespace.
      await db.insert(patternPosts).values({
        workspaceId: ids.workspace,
        pageHandle: "competitor",
        postedAt: new Date(Date.UTC(2026, 5, 2)),
        caption: "public pattern",
      });

      // …and a pattern-ads row in its score-free namespace.
      await db.insert(patternAds).values({
        workspaceId: ids.workspace,
        pageHandle: "competitor_ad",
        postedAt: new Date(Date.UTC(2026, 5, 3)),
        adBody: "public ad pattern",
      });

      const baseline = await getBaselinePoints(ids.workspace, ids.client);
      expect(baseline).toHaveLength(25);
      expect(baseline.every((point) => point.value < 1)).toBe(true);

      expect(await countPatternPosts(ids.workspace)).toBe(1);

      // Workspace isolation: another workspace sees nothing.
      expect(await getBaselinePoints(randomUUID(), ids.client)).toHaveLength(
        0,
      );
    });
  },
);
