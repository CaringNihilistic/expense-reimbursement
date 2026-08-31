import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");

  // A single unpooled connection for migrations — DDL and pgbouncer's
  // transaction pooling do not mix well.
  const client = postgres(url, { max: 1, prepare: false });

  console.log("Running migrations…");
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  console.log("Migrations applied.");

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
