import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { orgs, users, workspaces } from "@/db/schema";
import {
  listBrandChunks,
  listFindings,
  listReceipts,
  listScanSpecs,
  listSolutionTasks,
} from "./platina";
import {
  insertBrandChunk,
  insertFinding,
  insertReceipt,
  insertScanSpec,
} from "./platina";

/**
 * Cross-workspace isolation on a live database (CI service container;
 * INTEGRATION_DB=1). The app-layer rule from the constitution: every Platina
 * query filters by workspace_id explicitly, so workspace A never sees
 * workspace B's rows — proven against real Postgres, not just the SQL shape.
 */
describe.skipIf(process.env.INTEGRATION_DB !== "1")(
  "platina cross-workspace isolation (live database)",
  () => {
    const ids = {
      user: randomUUID(),
      org: randomUUID(),
      wsA: randomUUID(),
      wsB: randomUUID(),
    };

    afterAll(async () => {
      await db.delete(orgs).where(eq(orgs.id, ids.org)); // cascades
      await db.delete(users).where(eq(users.id, ids.user));
    });

    it("workspace A's queries return none of workspace B's rows", async () => {
      await db.insert(users).values({
        id: ids.user,
        email: `${ids.user}@isolation.test`,
      });
      await db.insert(orgs).values({
        id: ids.org,
        name: "Isolation",
        slug: `iso-${ids.org.slice(0, 8)}`,
        ownerUserId: ids.user,
      });
      await db.insert(workspaces).values({
        id: ids.wsA,
        orgId: ids.org,
        name: "A",
        slug: `a-${ids.wsA.slice(0, 8)}`,
      });
      await db.insert(workspaces).values({
        id: ids.wsB,
        orgId: ids.org,
        name: "B",
        slug: `b-${ids.wsB.slice(0, 8)}`,
      });

      // Seed workspace B across four Platina surfaces.
      await insertBrandChunk({ workspaceId: ids.wsB, content: "B's standard" });
      await insertScanSpec({
        workspaceId: ids.wsB,
        name: "B's source",
        targets: [{ kind: "competitor_site", value: "https://b.example.com" }],
        createdById: ids.user,
      });
      await insertFinding({
        workspaceId: ids.wsB,
        title: "B's finding",
        summary: "B",
        status: "new",
      });
      await insertReceipt({
        workspaceId: ids.wsB,
        title: "B's receipt",
        hypothesis: "B",
        expectedOutcome: "B",
        evidenceBrandIds: [],
        evidenceBrainIds: [],
        reviewAt: new Date(Date.now() + 86_400_000),
        ownerId: ids.user,
      });

      // Workspace A sees none of it, on any surface.
      expect(await listBrandChunks(ids.wsA)).toEqual([]);
      expect(await listScanSpecs(ids.wsA)).toEqual([]);
      expect(await listFindings(ids.wsA)).toEqual([]);
      expect(await listReceipts(ids.wsA)).toEqual([]);
      expect(await listSolutionTasks(ids.wsA, "any")).toEqual([]);

      // And B's rows are intact under B.
      expect((await listBrandChunks(ids.wsB)).length).toBe(1);
      expect((await listScanSpecs(ids.wsB)).length).toBe(1);
      expect((await listFindings(ids.wsB)).length).toBe(1);
      expect((await listReceipts(ids.wsB)).length).toBe(1);
    });
  },
);
