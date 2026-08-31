import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
}

/**
 * `prepare: false` is required, not optional.
 *
 * Neon's pooled endpoint (and Supabase's, and any other pgbouncer in
 * transaction mode) hands a different backend connection to each statement,
 * so server-side prepared statements break with "prepared statement already
 * exists". Turning them off is the documented cost of connection pooling.
 *
 * The connection is cached on globalThis so Next's dev-server hot reload does
 * not open a new pool on every edit.
 */
const globalForDb = globalThis as unknown as { __sql?: postgres.Sql };

const client =
  globalForDb.__sql ??
  postgres(process.env.DATABASE_URL, {
    prepare: false,
    max: 5,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__sql = client;
}

export const db = drizzle(client, { schema });
export { schema };
