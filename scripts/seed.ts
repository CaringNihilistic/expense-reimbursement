import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import bcrypt from "bcryptjs";

import { users, type Role } from "../src/db/schema";

/**
 * Session 1 seed: accounts only. The realistic dataset — forty reports spread
 * over eight weeks, several already stale — arrives in session 6, once there
 * are reports to seed.
 *
 * Re-runnable: existing accounts are left alone.
 */

const DEMO_PASSWORD = "demo1234";

const PEOPLE: { name: string; email: string; role: Role; note?: string }[] = [
  { name: "Meera Iyer", email: "meera@northwind.test", role: "approver" },
  { name: "Rajat Bose", email: "rajat@northwind.test", role: "approver" },
  {
    name: "Sandeep Rao",
    email: "sandeep@northwind.test",
    role: "approver",
    // The most important row in this file. Without an approver who also
    // submits, there is no way to demonstrate goal 1's rule that an approver
    // may never decide their own report, or goal 7's requirement that a bulk
    // action name exactly which selections were refused for that reason.
    note: "approver who also submits — the segregation-of-duties demo",
  },
  { name: "Ayush Yadav", email: "ayush@northwind.test", role: "employee" },
  { name: "Neha Kulkarni", email: "neha@northwind.test", role: "employee" },
  { name: "Tomas Vidal", email: "tomas@northwind.test", role: "employee" },
  { name: "Grace Okafor", email: "grace@northwind.test", role: "employee" },
  { name: "Wei Chen", email: "wei@northwind.test", role: "employee" },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");

  const client = postgres(url, { max: 1, prepare: false });
  const db = drizzle(client);

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const inserted = await db
    .insert(users)
    .values(PEOPLE.map(({ name, email, role }) => ({ name, email, role, passwordHash })))
    .onConflictDoNothing()
    .returning({ email: users.email });

  console.log(`Seeded ${inserted.length} of ${PEOPLE.length} accounts.`);
  if (inserted.length < PEOPLE.length) {
    console.log("(The rest already existed and were left untouched.)");
  }
  console.log(`\nPassword for every demo account: ${DEMO_PASSWORD}`);
  for (const person of PEOPLE) {
    console.log(`  ${person.email.padEnd(26)} ${person.role}${person.note ? ` — ${person.note}` : ""}`);
  }

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
