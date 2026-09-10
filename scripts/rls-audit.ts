/**
 * RLS Audit Script — read-only diagnostic
 *
 * Checks the live Supabase DB to determine:
 *   1. What Postgres role the DATABASE_URL connection authenticates as
 *   2. Whether RLS is enabled/forced on pattern_runs and harness_rules
 *   3. What policies exist on those tables
 *   4. Whether app-level queries actually return rows (or are silently empty)
 *   5. What auth.uid() evaluates to in this connection context
 *
 * Usage: npx tsx scripts/rls-audit.ts
 *
 * ⚠️  This script is 100% read-only. It runs only SELECT statements.
 */

import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("❌ DATABASE_URL not set");
  process.exit(1);
}

const sql = postgres(url, { prepare: false, connect_timeout: 10 });

async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  RLS Audit — Read-Only Diagnostic");
  console.log("═══════════════════════════════════════════════════════\n");

  // 1. Current role
  const [{ current_user: role }] = await sql`SELECT current_user`;
  const [{ current_setting: sessionRole }] =
    await sql`SELECT current_setting('role', true)`;
  console.log(`🔑 Connected as role: ${role}`);
  console.log(`   Session role:      ${sessionRole}`);

  // Check if this role is a superuser or has bypassrls
  const roleInfo = await sql`
    SELECT rolsuper, rolbypassrls, rolreplication
    FROM pg_catalog.pg_roles
    WHERE rolname = ${role}
  `;
  if (roleInfo.length > 0) {
    const r = roleInfo[0];
    console.log(
      `   Superuser: ${r.rolsuper}  |  Bypass RLS: ${r.rolbypassrls}  |  Replication: ${r.rolreplication}`,
    );
  }

  // 2. What does auth.uid() return in this context?
  let authUid = "<function does not exist>";
  try {
    const [{ uid }] = await sql`SELECT auth.uid() as uid`;
    authUid = uid === null ? "NULL" : String(uid);
  } catch (e: any) {
    if (e.message?.includes("does not exist")) {
      authUid = "<auth.uid() function not available to this role>";
    } else {
      authUid = `<error: ${e.message}>`;
    }
  }
  console.log(`   auth.uid():        ${authUid}\n`);

  // 3. RLS status on both tables
  const TABLES = ["pattern_runs", "harness_rules"];
  for (const tableName of TABLES) {
    console.log(`───────────────────────────────────────────────────────`);
    console.log(`  Table: ${tableName}`);
    console.log(`───────────────────────────────────────────────────────`);

    const tableInfo = await sql`
      SELECT relrowsecurity, relforcerowsecurity
      FROM pg_catalog.pg_class
      WHERE relname = ${tableName}
        AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
    `;

    if (tableInfo.length === 0) {
      console.log(`  ⚠️  Table not found in public schema\n`);
      continue;
    }

    const { relrowsecurity, relforcerowsecurity } = tableInfo[0];
    console.log(`  RLS enabled:  ${relrowsecurity}`);
    console.log(`  RLS forced:   ${relforcerowsecurity}`);

    // 4. List policies
    const policies = await sql`
      SELECT polname, polpermissive, polroles::regrole[], polcmd, polqual, polwithcheck
      FROM pg_catalog.pg_policy
      WHERE polrelid = (
        SELECT oid FROM pg_class
        WHERE relname = ${tableName}
          AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      )
    `;

    if (policies.length === 0) {
      console.log(`  Policies:     NONE (⚠️ RLS enabled with 0 policies = all queries return empty)`);
    } else {
      console.log(`  Policies:     ${policies.length}`);
      for (const p of policies) {
        const cmdMap: Record<string, string> = {
          r: "SELECT",
          a: "INSERT",
          w: "UPDATE",
          d: "DELETE",
          "*": "ALL",
        };
        console.log(
          `    • ${p.polname} (${cmdMap[p.polcmd] ?? p.polcmd}, ${p.polpermissive ? "PERMISSIVE" : "RESTRICTIVE"})`,
        );
        console.log(`      Roles: ${p.polroles}`);
      }
    }

    // 5. Can the app actually read rows?
    const countResult =
      await sql`SELECT count(*)::int as cnt FROM ${sql(tableName)}`;
    const cnt = countResult[0]?.cnt ?? 0;
    console.log(
      `  Row count:    ${cnt}${cnt === 0 ? " (⚠️ either genuinely empty or RLS blocking)" : " ✅"}`,
    );
    console.log();
  }

  // 6. Quick summary
  console.log("═══════════════════════════════════════════════════════");
  console.log("  Summary");
  console.log("═══════════════════════════════════════════════════════");

  const isBypass =
    roleInfo.length > 0 &&
    (roleInfo[0].rolsuper || roleInfo[0].rolbypassrls);

  if (isBypass) {
    console.log(
      `  ✅ Role "${role}" has bypass/superuser — RLS policies are evaluated but never block this connection.`,
    );
    console.log(
      `     Impact: RLS on these tables is a no-op for the app. Safe to drop.`,
    );
  } else {
    console.log(
      `  ⚠️  Role "${role}" does NOT bypass RLS.`,
    );
    console.log(
      `     If FORCE ROW LEVEL SECURITY is on, queries WILL be filtered by policies.`,
    );
    console.log(
      `     Since auth.uid() = ${authUid}, any policy using auth.uid() will never match.`,
    );
    console.log(
      `     → pattern_runs with FORCE + auth.uid() policies = silently empty results.`,
    );
    console.log(
      `     → harness_rules with ENABLE + 0 policies = silently empty results.`,
    );
  }

  await sql.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
