import type { Metadata } from "next";
import Link from "next/link";

import { NavBar } from "@/components/nav-bar";
import { requireUser } from "@/lib/auth";
import { capitalize, formatAmount, formatDate } from "@/lib/format";
import {
  SORT_FIELDS,
  STATUS_FILTERS,
  listApprovers,
  listUsers,
  searchReports,
  type SearchFilters,
  type SortField,
  type StatusFilter,
} from "@/lib/reports";

export const metadata: Metadata = { title: "Reports · Expense Reimbursement" };

const PER_PAGE = 20;

type Params = {
  q?: string;
  status?: string;
  owner?: string;
  approver?: string;
  archived?: string;
  sort?: string;
  dir?: string;
  page?: string;
};

/** Everything the user can type into the URL is narrowed here, once. */
function parse(params: Params): SearchFilters {
  const page = Number.parseInt(params.page ?? "1", 10);
  return {
    q: params.q?.trim() || undefined,
    status: STATUS_FILTERS.includes(params.status as StatusFilter)
      ? (params.status as StatusFilter)
      : undefined,
    ownerId: params.owner || undefined,
    approverId: params.approver || undefined,
    archived: params.archived === "1",
    sort: SORT_FIELDS.includes(params.sort as SortField) ? (params.sort as SortField) : "submitted",
    dir: params.dir === "asc" ? "asc" : "desc",
    page: Number.isFinite(page) && page > 0 ? page : 1,
    perPage: PER_PAGE,
  };
}

/**
 * Rebuilds the query string, changing one thing and keeping the rest.
 *
 * The return type is spelled out so `typedRoutes` is satisfied without a cast:
 * the pathname is a literal the checker knows, and only the query varies.
 */
function href(params: Params, changes: Params): `/reports?${string}` | "/reports" {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...changes })) {
    if (value) next.set(key, String(value));
  }
  const query = next.toString();
  return query ? `/reports?${query}` : "/reports";
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const filters = parse(params);

  const [result, owners, approvers] = await Promise.all([
    searchReports(user, filters),
    listUsers(),
    listApprovers(),
  ]);

  const { rows, matchCount, page, pageCount } = result;
  const from = matchCount === 0 ? 0 : (page - 1) * PER_PAGE + 1;
  const to = Math.min(page * PER_PAGE, matchCount);

  return (
    <main>
      <NavBar user={user} />

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          flexWrap: "wrap",
          gap: "1rem",
        }}
      >
        <h1>{filters.archived ? "Archived reports" : "Reports"}</h1>
        <Link href="/reports/new" className="button-link">
          New report
        </Link>
      </div>

      {/* A plain GET form: the filters end up in the URL, so every result is
          linkable and the back button behaves. No JavaScript involved. */}
      <form method="get" className="card" style={{ marginTop: "1rem" }}>
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: "2 1 14rem" }}>
            <label htmlFor="q">Search titles</label>
            <input id="q" name="q" defaultValue={filters.q ?? ""} placeholder="e.g. Bengaluru" />
          </div>

          <div style={{ flex: "1 1 9rem" }}>
            <label htmlFor="status">Status</label>
            <select id="status" name="status" defaultValue={filters.status ?? ""}>
              <option value="">Any</option>
              {STATUS_FILTERS.map((status) => (
                <option key={status} value={status}>
                  {status === "returned" ? "Returned for changes" : capitalize(status)}
                </option>
              ))}
            </select>
          </div>

          <div style={{ flex: "1 1 10rem" }}>
            <label htmlFor="owner">Submitted by</label>
            <select id="owner" name="owner" defaultValue={filters.ownerId ?? ""}>
              <option value="">Anyone</option>
              {owners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.name}
                </option>
              ))}
            </select>
          </div>

          <div style={{ flex: "1 1 10rem" }}>
            <label htmlFor="approver">Assigned approver</label>
            <select id="approver" name="approver" defaultValue={filters.approverId ?? ""}>
              <option value="">Anyone</option>
              {approvers.map((approver) => (
                <option key={approver.id} value={approver.id}>
                  {approver.name}
                </option>
              ))}
            </select>
          </div>

          <div style={{ flex: "1 1 9rem" }}>
            <label htmlFor="sort">Sort by</label>
            <select id="sort" name="sort" defaultValue={filters.sort}>
              <option value="submitted">Submitted date</option>
              <option value="status">Status</option>
              <option value="total">Total amount</option>
            </select>
          </div>

          <div style={{ flex: "1 1 7rem" }}>
            <label htmlFor="dir">Order</label>
            <select id="dir" name="dir" defaultValue={filters.dir}>
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </select>
          </div>

          {filters.archived ? <input type="hidden" name="archived" value="1" /> : null}

          <div>
            <button type="submit">Apply</button>
          </div>
        </div>
      </form>

      <div className="muted" style={{ margin: "1rem 0" }}>
        {matchCount === 0 ? "No matches" : `${from}–${to} of ${matchCount} matching`}
        {matchCount > 0 && pageCount > 1 ? ` · page ${page} of ${pageCount}` : null}
        {" · "}
        <Link href={href(params, { archived: filters.archived ? "" : "1", page: "" })}>
          {filters.archived ? "Show active" : "Show archived"}
        </Link>
        {Object.keys(params).length > 0 ? (
          <>
            {" · "}
            <Link href="/reports">Clear filters</Link>
          </>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            Nothing matches these filters.
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Submitted by</th>
                <th>Period</th>
                <th>Status</th>
                <th>Submitted</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((report) => (
                <tr key={report.id}>
                  <td>
                    <Link href={`/reports/${report.id}`}>{report.title}</Link>
                  </td>
                  <td className="muted">
                    {report.ownerId === user.id ? "You" : report.ownerName}
                  </td>
                  <td className="muted">
                    {formatDate(report.periodStart)} – {formatDate(report.periodEnd)}
                  </td>
                  <td>
                    {/* No stored `rejected` status — Decision 3. */}
                    <span className="pill">
                      {report.returnedForChanges ? "returned" : report.status}
                    </span>
                  </td>
                  <td className="muted">
                    {report.submittedAt ? formatDate(report.submittedAt.toISOString().slice(0, 10)) : "—"}
                  </td>
                  <td>{formatAmount(report.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 ? (
        <div className="muted" style={{ marginTop: "1rem", display: "flex", gap: "1rem" }}>
          {page > 1 ? (
            <Link href={href(params, { page: String(page - 1) })}>← Previous</Link>
          ) : (
            <span>← Previous</span>
          )}
          {page < pageCount ? (
            <Link href={href(params, { page: String(page + 1) })}>Next →</Link>
          ) : (
            <span>Next →</span>
          )}
        </div>
      ) : null}
    </main>
  );
}
