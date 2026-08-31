/**
 * Values shared by the edge middleware and the Node server runtime.
 *
 * This module exists so `src/middleware.ts` can learn the cookie name without
 * importing `@/lib/auth`, which pulls in the database client and bcrypt and
 * cannot run on the edge.
 */

export const SESSION_COOKIE = "session";

/** Days a report may sit in Submitted before it becomes a stale alert (goal 10). */
export const STALE_AFTER_DAYS = Number(process.env.STALE_AFTER_DAYS ?? 5);

/** Days a dismissal suppresses that alert before it returns (goal 10). */
export const ALERT_SNOOZE_DAYS = Number(process.env.ALERT_SNOOZE_DAYS ?? 3);
