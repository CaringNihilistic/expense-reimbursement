/**
 * Every identifier in this schema is a `uuid`, and every one of them reaches
 * the server from somewhere untrusted — a route parameter, or a form field on
 * a Server Action, which is a public HTTP endpoint.
 *
 * Postgres rejects a malformed uuid at the type cast rather than returning no
 * rows, so `where id = 'not-a-uuid'` raises `invalid input syntax for type
 * uuid` and the request becomes a 500. That is not a security problem — the
 * query is parameterised, and the value never reaches SQL as code — but "not a
 * real id" should be indistinguishable from "no such report", which is a 404.
 *
 * So ids are checked before they are used in a query.
 */

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
