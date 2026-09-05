import { z } from "zod";

/**
 * The per-report outcome of a bulk action (goal 7), carried back to the page
 * in the URL.
 *
 * Why the URL rather than a database lookup: a bulk *rejection* returns those
 * reports to draft, and a draft is visible only to its owner — so by the time
 * the results render, the approver can no longer read the very rows they just
 * acted on. Re-querying them would mean bypassing canView, and a page that
 * bypasses canView while taking report ids from the query string is an
 * information leak: anyone could ask it to name a report they cannot see.
 *
 * So the result is self-contained. The page renders what the URL says and
 * touches no data at all, which means forging one only fools the forger.
 * React escapes the text on the way out.
 */

const Outcome = z.union([
  z.object({ title: z.string().max(200), ok: z.literal(true) }),
  z.object({
    title: z.string().max(200),
    ok: z.literal(false),
    code: z.string().max(40),
    message: z.string().max(300),
  }),
]);

const Result = z.object({
  action: z.enum(["approve", "reject"]),
  outcomes: z.array(Outcome).max(25),
});

export type BulkOutcome = z.infer<typeof Outcome>;
export type BulkResult = z.infer<typeof Result>;

export function encodeBulkResult(result: BulkResult): string {
  return Buffer.from(JSON.stringify(result), "utf8").toString("base64url");
}

/** Returns null for anything malformed. Never throws — the input is a URL. */
export function decodeBulkResult(encoded: string | undefined): BulkResult | null {
  if (!encoded) return null;
  try {
    const json = Buffer.from(encoded, "base64url").toString("utf8");
    const parsed = Result.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function summarise(result: BulkResult): { approved: number; refused: number; selfOwned: number } {
  return {
    approved: result.outcomes.filter((o) => o.ok).length,
    refused: result.outcomes.filter((o) => !o.ok).length,
    selfOwned: result.outcomes.filter((o) => !o.ok && o.code === "SELF_APPROVAL").length,
  };
}
