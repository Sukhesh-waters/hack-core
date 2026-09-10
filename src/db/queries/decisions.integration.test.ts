import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { clients, orgs, patternPosts, posts, users, workspaces } from "@/db/schema";
import { validateDecisionEvidence } from "@/lib/decisions";
import { createDecision, getDecisionById, recordDecisionOutcome } from "./decisions";

/**
 * G2's two-layer rule, against a real Postgres (CI service container). This
 * is the most important test in Phase G: it proves that even if a pattern-
 * layer id somehow reaches this table, it never survives the write — not
 * just that the pure function says so in isolation, but that the actual
 * persisted row reflects it. Runs only when INTEGRATION_DB=1 (CI); local
 * suites skip it.
 */
describe.skipIf(process.env.INTEGRATION_DB !== "1")(
  "decisions — two-layer evidence rule (live database)",
  () => {
    const ids = {
      user: randomUUID(),
      org: randomUUID(),
      workspace: randomUUID(),
      client: randomUUID(),
      // Assigned once createDecision returns its real inserted id — Drizzle
      // generates ids client-side ($defaultFn), so this can't be pre-picked.
      decision: "",
    };

    afterAll(async () => {
      await db.delete(orgs).where(eq(orgs.id, ids.org)); // cascades workspace → rows
      await db.delete(users).where(eq(users.id, ids.user));
    });

    it("seeds base fixtures plus one first-party post and one pattern post", async () => {
      await db.insert(users).values({ id: ids.user, email: `${ids.user}@t.io` });
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
      await db.insert(clients).values({
        id: ids.client,
        workspaceId: ids.workspace,
        name: "Test client",
      });
      await db.insert(posts).values({
        workspaceId: ids.workspace,
        clientId: ids.client,
        source: "first_party",
        postedAt: new Date(Date.UTC(2026, 0, 1)),
        engagementRate: 0.05,
      });
      await db.insert(patternPosts).values({
        workspaceId: ids.workspace,
        pageHandle: "competitor",
        postedAt: new Date(Date.UTC(2026, 0, 2)),
        caption: "public pattern",
      });
    });

    it("strips the pattern id and persists ONLY the first-party id", async () => {
      const [firstPartyRow] = await db
        .select({ id: posts.id })
        .from(posts)
        .where(eq(posts.workspaceId, ids.workspace));
      const [patternRow] = await db
        .select({ id: patternPosts.id })
        .from(patternPosts)
        .where(eq(patternPosts.workspaceId, ids.workspace));

      const allowedFirstPartyIds = [firstPartyRow.id];
      const validated = validateDecisionEvidence(
        [firstPartyRow.id, patternRow.id],
        allowedFirstPartyIds,
      );
      expect(validated).toEqual([firstPartyRow.id]);

      ids.decision = await createDecision({
        workspaceId: ids.workspace,
        clientId: ids.client,
        goalId: null,
        title: "Test decision",
        reason: "Testing the two-layer guard",
        evidencePostIds: validated,
        insightId: null,
        expectedOutcome: "Engagement rises",
        reviewAt: new Date(Date.UTC(2026, 1, 1)),
        ownerId: ids.user,
      });

      const stored = await getDecisionById(ids.workspace, ids.decision);
      expect(stored).not.toBeNull();
      expect(stored!.evidencePostIds).toEqual([firstPartyRow.id]);
      expect(stored!.evidencePostIds).not.toContain(patternRow.id);
    });

    it("recordDecisionOutcome returns false on a second call — the guard holds", async () => {
      const first = await recordDecisionOutcome({
        workspaceId: ids.workspace,
        decisionId: ids.decision,
        outcome: "worked",
        outcomeNote: "Confirmed via reporting",
      });
      expect(first).toBe(true);

      const second = await recordDecisionOutcome({
        workspaceId: ids.workspace,
        decisionId: ids.decision,
        outcome: "did_not_work",
        outcomeNote: "Should never apply",
      });
      expect(second).toBe(false);

      const stored = await getDecisionById(ids.workspace, ids.decision);
      expect(stored!.outcome).toBe("worked");
      expect(stored!.outcomeNote).toBe("Confirmed via reporting");
    });
  },
);
