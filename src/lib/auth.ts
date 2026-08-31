import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";

import { db } from "@/db";
import { users, type Role, type User } from "@/db/schema";
import { SESSION_COOKIE } from "@/lib/constants";

export { SESSION_COOKIE };

const SESSION_DAYS = 7;
const BCRYPT_COST = 10;

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) {
    throw new Error("AUTH_SECRET must be set to at least 32 characters.");
  }
  return new TextEncoder().encode(value);
}

/* ------------------------------------------------------------------ *
 * Passwords
 * ------------------------------------------------------------------ */

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/* ------------------------------------------------------------------ *
 * Session cookie
 *
 * A signed JWT in an httpOnly cookie. Deliberately hand-rolled rather than
 * pulled from an auth framework: it is about sixty lines, the assignment asks
 * only for email and password, and every line here is one I can explain.
 * ------------------------------------------------------------------ */

export async function createSession(userId: string): Promise<void> {
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret());

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/* ------------------------------------------------------------------ *
 * Reading the current actor
 *
 * `cache()` dedupes this within a single request, so a page that calls
 * requireUser() and also renders a nav badge hits the database once.
 * ------------------------------------------------------------------ */

export const getCurrentUser = cache(async (): Promise<User | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  let userId: string;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub) return null;
    userId = payload.sub;
  } catch {
    // Expired, tampered with, or signed by a rotated secret. Treat all three
    // the same: no session.
    return null;
  }

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return user ?? null;
});

/* ------------------------------------------------------------------ *
 * Guards
 *
 * These are the real security boundary and must be called INSIDE every
 * Server Action, route handler and data-loading function.
 *
 * They are not called from middleware on purpose. Next.js middleware has been
 * bypassable via a crafted request header (CVE-2025-29927), and Server Actions
 * are public HTTP endpoints that anyone can invoke directly no matter what the
 * UI chooses to render. src/middleware.ts only redirects logged-out browsers
 * so they land on the login page instead of an empty dashboard.
 * ------------------------------------------------------------------ */

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireApprover(): Promise<User> {
  const user = await requireUser();
  if (user.role !== ("approver" satisfies Role)) redirect("/dashboard");
  return user;
}

export function isApprover(user: Pick<User, "role">): boolean {
  return user.role === "approver";
}

/* ------------------------------------------------------------------ *
 * Login
 * ------------------------------------------------------------------ */

export async function findUserByEmail(email: string): Promise<User | null> {
  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`)
    .limit(1);
  return user ?? null;
}

/**
 * Verifies credentials. Returns null for both "no such user" and "wrong
 * password", and runs a throwaway comparison in the first case so the two do
 * not differ in timing.
 */
export async function authenticate(email: string, password: string): Promise<User | null> {
  const user = await findUserByEmail(email);
  if (!user) {
    await bcrypt.compare(password, "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva");
    return null;
  }
  const ok = await verifyPassword(password, user.passwordHash);
  return ok ? user : null;
}
