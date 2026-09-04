import type { TimelineEvent } from "@/lib/reports";

/**
 * Goal 9. Nothing here can be edited or deleted — not by an approver, not by
 * the owner, not by a stray script — because `report_events` is append-only
 * in the database (drizzle/0001_append_only_events.sql), not merely in the
 * absence of a button.
 */

const STATUS_CHANGE_LABELS: Record<string, string> = {
  "draft>submitted": "submitted this report",
  "submitted>approved": "approved this report",
  "submitted>draft": "returned this report for changes",
  "approved>paid": "marked this report as paid",
};

function describe(event: TimelineEvent): string {
  if (event.kind === "comment") return "commented";
  const key = `${event.fromStatus}>${event.toStatus}`;
  return STATUS_CHANGE_LABELS[key] ?? `moved this report to ${event.toStatus}`;
}

function when(value: Date): string {
  return value.toLocaleString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function Timeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="muted" style={{ margin: 0 }}>
        Nothing has happened yet.
      </p>
    );
  }

  return (
    <ol className="timeline">
      {events.map((event) => (
        <li key={event.id}>
          <div>
            <strong>{event.actorName}</strong> {describe(event)}
            {event.fromStatus && event.toStatus ? (
              <>
                {" "}
                <span className="pill">{event.fromStatus}</span>
                {" → "}
                <span className="pill">{event.toStatus}</span>
              </>
            ) : null}
          </div>
          {event.reason ? (
            <div className="timeline-body">
              <span className="muted">Reason: </span>
              {event.reason}
            </div>
          ) : null}
          {event.body ? <div className="timeline-body">{event.body}</div> : null}
          <div className="muted" style={{ fontSize: "0.8rem" }}>
            {when(event.createdAt)}
          </div>
        </li>
      ))}
    </ol>
  );
}
