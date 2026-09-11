import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as instamediaSchema from "./schema";
import * as platinaSchema from "./platina-schema";

const schema = { ...instamediaSchema, ...platinaSchema };

export function isDbConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

// postgres.js does not connect until the first query, so building without
// DATABASE_URL is fine — the placeholder host only surfaces if something
// actually queries an unconfigured database.
const url =
  process.env.DATABASE_URL ??
  "postgresql://unconfigured:unconfigured@database-not-configured:5432/unconfigured";

// prepare: false — required for Supabase's transaction-mode pooler.
// The client is cached on globalThis in dev: next dev re-evaluates this
// module on every recompile, and a fresh client pays a ~2s TLS+auth
// handshake to the pooler on its first query. Production gets a plain
// module-scope client (one evaluation per process).
const makeClient = () => postgres(url, { prepare: false, connect_timeout: 10 });

const globalForDb = globalThis as unknown as {
  __pgClient?: ReturnType<typeof makeClient>;
};

const client =
  process.env.NODE_ENV === "production"
    ? makeClient()
    : (globalForDb.__pgClient ??= makeClient());

export const db = drizzle(client, { schema });

export * as tables from "./schema";
