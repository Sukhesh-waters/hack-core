import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import {
  activity,
  memberships,
  orgs,
  sopRunSteps,
  sopRuns,
  tickets,
  users,
  workspaces,
} from "@/db/schema";
import {
  getCycleTimeByState,
  getOverdueLoad,
  getOwnerLoad,
  MIN_N_THRESHOLD,
} from "./metrics";

/**
 * D2 metrics, against a real Postgres (CI service container). Every other
 * query test in this repo asserts on .toSQL() string output only, which is
 * exactly why cycleTimeByStateQuery shipped with a "missing FROM-clause
 * entry" bug that no test caught. Runs only when INTEGRATION_DB=1 (CI);
 * local suites skip it.
 */
describe.skipIf(process.env.INTEGRATION_DB !== "1")(
  "metrics queries (live database)",
  () => {
    const ids = {
      user: randomUUID(),
      org: randomUUID(),
      workspace: randomUUID(),
      run: randomUUID(),
    };

    afterAll(async () => {
      await db.delete(orgs).where(eq(orgs.id, ids.org)); // cascades workspace → rows
      await db.delete(users).where(eq(users.id, ids.user));
    });

    it("seeds base fixtures", async () => {
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
      await db.insert(memberships).values({
        workspaceId: ids.workspace,
        userId: ids.user,
        role: "owner",
      });
    });

    it("getCycleTimeByState executes without throwing and returns rows below the Min-N gate", async () => {
      const contentId = randomUUID();
      const base = new Date(Date.UTC(2026, 0, 1, 9, 0, 0));

      // Two transitions for the same subject → one lag-derived sample.
      // Below MIN_N_THRESHOLD (5), so avgHours must gate to null.
      await db.insert(activity).values([
        {
          workspaceId: ids.workspace,
          subjectType: "content",
          subjectId: contentId,
          verb: "stage_advanced",
          meta: { from: "brief", to: "shoot_day" },
          createdAt: base,
        },
        {
          workspaceId: ids.workspace,
          subjectType: "content",
          subjectId: contentId,
          verb: "stage_advanced",
          meta: { from: "shoot_day", to: "in_progress" },
          createdAt: new Date(base.getTime() + 3 * 3600 * 1000),
        },
      ]);

      const rows = await getCycleTimeByState(ids.workspace);
      const stateRow = rows.find((r) => r.stateKey === "in_progress");

      expect(stateRow).toBeDefined();
      expect(stateRow!.sampleCount).toBe(1);
      expect(stateRow!.sampleCount).toBeLessThan(MIN_N_THRESHOLD);
      expect(stateRow!.hasEnoughData).toBe(false);
      expect(stateRow!.avgHours).toBeNull();
    });

    it("getOverdueLoad returns only open steps past due_at on active runs", async () => {
      await db.insert(sopRuns).values({
        id: ids.run,
        workspaceId: ids.workspace,
        name: "Integration test run",
        anchorDate: new Date(Date.UTC(2026, 0, 1)),
        status: "active",
        startedById: ids.user,
      });
      await db.insert(sopRunSteps).values([
        {
          workspaceId: ids.workspace,
          runId: ids.run,
          title: "Overdue step",
          status: "ready",
          assigneeId: ids.user,
          dueAt: new Date(Date.UTC(2020, 0, 1)),
        },
        {
          workspaceId: ids.workspace,
          runId: ids.run,
          title: "Done step (excluded)",
          status: "done",
          assigneeId: ids.user,
          dueAt: new Date(Date.UTC(2020, 0, 1)),
        },
      ]);

      const rows = await getOverdueLoad(ids.workspace);
      expect(rows.map((r) => r.stepTitle)).toContain("Overdue step");
      expect(rows.map((r) => r.stepTitle)).not.toContain("Done step (excluded)");
    });

    it("getOwnerLoad aggregates open steps and tickets per member", async () => {
      await db.insert(tickets).values({
        workspaceId: ids.workspace,
        title: "Integration test ticket",
        status: "open",
        assigneeId: ids.user,
        createdById: ids.user,
      });

      const rows = await getOwnerLoad(ids.workspace);
      const me = rows.find((r) => r.userId === ids.user);

      expect(me).toBeDefined();
      expect(me!.openTicketCount).toBeGreaterThanOrEqual(1);
      expect(me!.openStepCount).toBeGreaterThanOrEqual(1);
      expect(me!.totalLoad).toBe(
        me!.openStepCount + me!.openTicketCount + me!.openContentCount,
      );
    });
  },
);
