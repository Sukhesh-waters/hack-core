/**
 * E2E fixture seed — creates an isolated workspace for dual-user realtime
 * tests (user A mutates, user B observes) plus gate-decision flows.
 *
 * Why this exists (Phase 0 audit): every existing workspace has exactly ONE
 * member, so there is no live workspace where two users can be signed in at
 * once for a realtime spec. The dev-bypass identity (`dev@localhost.test`)
 * belongs only to `aurora-skincare-client-work`, which holds real client
 * data — asserting against it would make specs order-dependent and
 * destructive. This script builds a small, purpose-built workspace instead.
 *
 * Strictly additive: every statement is either a SELECT or an INSERT scoped
 * to rows this script owns (keyed off FIXTURE_* constants below). It never
 * UPDATEs, DELETEs, or TRUNCATEs anything — including the dev user's own
 * `users` row, which it only reads. Nothing outside the fixture workspace is
 * touched.
 *
 * Idempotent: every insert is preceded by a lookup on a stable identity
 * (org/workspace slug, user email, workspace+name for client/template, or
 * template+title for steps). Safe to run any number of times — reruns
 * report what already existed instead of duplicating rows.
 *
 * Run:
 *   set -a; source .env.local; set +a; npx tsx scripts/seed-e2e-fixture.ts
 */
import * as fs from "fs";
import * as path from "path";

// Same manual .env.local parser drizzle.config.ts / seed-workflows.ts use —
// this repo deliberately has no dotenv dependency. Values already present in
// the environment (e.g. from `source .env.local`) win over the file.
const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      process.env[match[1]] ??= match[2].replace(/^["']|["']$/g, "");
    }
  }
}

// ---------------------------------------------------------------------------
// Fixture identity — stable and recognizable, never derived from Date.now()
// or randomness, so reruns always resolve back to the same rows.
// ---------------------------------------------------------------------------

const ORG_SLUG = "e2e-fixture-org";
const ORG_NAME = "E2E Fixture Org";

const WORKSPACE_SLUG = "e2e-fixture";
const WORKSPACE_NAME = "E2E Fixture Workspace";

// The real dev-bypass identity (src/auth.ts DEV_BYPASS_EMAIL). Hardcoded
// rather than imported from "@/auth" — importing that module evaluates the
// full NextAuth config (Google/Resend providers, secrets) as a side effect,
// which this standalone script has no business triggering. This script only
// ever SELECTs this user; it never inserts or mutates their `users` row.
const DEV_USER_EMAIL = "dev@localhost.test";

// The second, purpose-built fixture member — this script owns this user
// end-to-end (creates it if missing, never touches any other user).
const FIXTURE_USER_EMAIL = "e2e-fixture-teammate@localhost.test";
const FIXTURE_USER_NAME = "E2E Fixture Teammate";

const CLIENT_NAME = "E2E Fixture Client";

const SOP_TEMPLATE_NAME = "E2E Fixture SOP Template";
const SOP_STEP_DRAFT_TITLE = "Draft content";
const SOP_STEP_APPROVAL_TITLE = "Client approval";

async function main() {
  const { db } = await import("../src/db");
  const { eq, and } = await import("drizzle-orm");
  const { orgs, workspaces, users, memberships, clients, sopTemplates, sopSteps } =
    await import("../src/db/schema");

  const summary: string[] = [];
  const note = (line: string) => {
    summary.push(line);
    console.log(line);
  };

  console.log(`Seeding E2E fixture (workspace slug "${WORKSPACE_SLUG}")…\n`);

  const result = await db.transaction(async (tx) => {
    // --- users --------------------------------------------------------
    // Dev-bypass user: READ ONLY. This script must never create or edit
    // this row — if dev-bypass has never been used, membership simply
    // waits for that user to exist (see below).
    const existingDevUser = await tx
      .select()
      .from(users)
      .where(eq(users.email, DEV_USER_EMAIL))
      .limit(1);
    const devUser = existingDevUser[0] ?? null;
    note(
      devUser
        ? `  user (dev-bypass): found "${DEV_USER_EMAIL}" (${devUser.id})`
        : `  user (dev-bypass): NOT FOUND — "${DEV_USER_EMAIL}" has never signed in via dev-bypass yet; skipping its membership this run (safe to rerun later once it exists)`,
    );

    // Fixture teammate user: this script's own, fully owned.
    let fixtureUser = (
      await tx
        .select()
        .from(users)
        .where(eq(users.email, FIXTURE_USER_EMAIL))
        .limit(1)
    )[0];
    let fixtureUserCreated = false;
    if (!fixtureUser) {
      [fixtureUser] = await tx
        .insert(users)
        .values({ email: FIXTURE_USER_EMAIL, name: FIXTURE_USER_NAME })
        .returning();
      fixtureUserCreated = true;
    }
    note(
      `  user (fixture teammate): ${fixtureUserCreated ? "created" : "found"} "${FIXTURE_USER_EMAIL}" (${fixtureUser.id})`,
    );

    // --- org ------------------------------------------------------------
    let org = (
      await tx.select().from(orgs).where(eq(orgs.slug, ORG_SLUG)).limit(1)
    )[0];
    let orgCreated = false;
    if (!org) {
      [org] = await tx
        .insert(orgs)
        .values({
          name: ORG_NAME,
          slug: ORG_SLUG,
          ownerUserId: fixtureUser.id,
        })
        .returning();
      orgCreated = true;
    }
    note(`  org: ${orgCreated ? "created" : "found"} "${ORG_SLUG}" (${org.id})`);

    // --- workspace --------------------------------------------------------
    let workspace = (
      await tx
        .select()
        .from(workspaces)
        .where(eq(workspaces.slug, WORKSPACE_SLUG))
        .limit(1)
    )[0];
    let workspaceCreated = false;
    if (!workspace) {
      [workspace] = await tx
        .insert(workspaces)
        .values({ orgId: org.id, name: WORKSPACE_NAME, slug: WORKSPACE_SLUG })
        .returning();
      workspaceCreated = true;
    }
    note(
      `  workspace: ${workspaceCreated ? "created" : "found"} "${WORKSPACE_SLUG}" (${workspace.id})`,
    );

    // --- memberships --------------------------------------------------
    async function ensureMembership(
      userId: string,
      role: "owner" | "member",
      label: string,
    ) {
      const existing = await tx
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.workspaceId, workspace.id),
            eq(memberships.userId, userId),
          ),
        )
        .limit(1);
      if (existing[0]) {
        note(`  membership (${label}): already exists (${existing[0].id})`);
        return existing[0];
      }
      const [created] = await tx
        .insert(memberships)
        .values({ workspaceId: workspace.id, userId, role })
        .returning();
      note(`  membership (${label}): created (${created.id})`);
      return created;
    }

    if (devUser) {
      await ensureMembership(devUser.id, "owner", "dev-bypass");
    }
    await ensureMembership(fixtureUser.id, "member", "fixture teammate");

    // --- client -----------------------------------------------------------
    let client = (
      await tx
        .select()
        .from(clients)
        .where(
          and(
            eq(clients.workspaceId, workspace.id),
            eq(clients.name, CLIENT_NAME),
          ),
        )
        .limit(1)
    )[0];
    let clientCreated = false;
    if (!client) {
      [client] = await tx
        .insert(clients)
        .values({ workspaceId: workspace.id, name: CLIENT_NAME })
        .returning();
      clientCreated = true;
    }
    note(
      `  client: ${clientCreated ? "created" : "found"} "${CLIENT_NAME}" (${client.id})`,
    );

    // --- SOP template -------------------------------------------------
    let template = (
      await tx
        .select()
        .from(sopTemplates)
        .where(
          and(
            eq(sopTemplates.workspaceId, workspace.id),
            eq(sopTemplates.name, SOP_TEMPLATE_NAME),
          ),
        )
        .limit(1)
    )[0];
    let templateCreated = false;
    if (!template) {
      [template] = await tx
        .insert(sopTemplates)
        .values({
          workspaceId: workspace.id,
          name: SOP_TEMPLATE_NAME,
          description: "Fixture SOP template for E2E gate-decision specs.",
          anchorLabel: "Publish date",
          createdById: fixtureUser.id,
        })
        .returning();
      templateCreated = true;
    }
    note(
      `  sop_template: ${templateCreated ? "created" : "found"} "${SOP_TEMPLATE_NAME}" (${template.id})`,
    );

    // --- SOP steps --------------------------------------------------------
    async function ensureStep(
      title: string,
      position: number,
      dueOffsetDays: number,
      gate: "none" | "approval" | "compliance",
    ) {
      const existing = await tx
        .select()
        .from(sopSteps)
        .where(
          and(eq(sopSteps.templateId, template.id), eq(sopSteps.title, title)),
        )
        .limit(1);
      if (existing[0]) {
        note(`  sop_step: already exists "${title}" (${existing[0].id})`);
        return existing[0];
      }
      const [created] = await tx
        .insert(sopSteps)
        .values({
          workspaceId: workspace.id,
          templateId: template.id,
          position,
          title,
          dueOffsetDays,
          gate,
        })
        .returning();
      note(`  sop_step: created "${title}" (${created.id})`);
      return created;
    }

    await ensureStep(SOP_STEP_DRAFT_TITLE, 0, -3, "none");
    await ensureStep(SOP_STEP_APPROVAL_TITLE, 1, -1, "approval");

    return { workspace, org, devUser, fixtureUser, client, template };
  });

  console.log(`\n=== FIXTURE WORKSPACE ID ===`);
  console.log(result.workspace.id);
  console.log(`============================\n`);
  console.log(`Done. ${summary.length} step(s) reported above.`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
