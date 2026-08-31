-- Goal 9: "Nothing in this timeline can be edited or deleted after the fact,
-- including by approvers."
--
-- Enforced here rather than in application code on purpose. A guard in the
-- service layer holds only as long as every future code path remembers to go
-- through it; a trigger holds against a bug, a stray migration, a background
-- script, and anyone sitting at a psql prompt. This is the clearest example in
-- the schema of a constraint that belongs to the database rather than the app
-- (see docs/schema.md).

CREATE OR REPLACE FUNCTION report_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'report_events is append-only; % is not permitted on this table', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint

CREATE TRIGGER report_events_no_update
  BEFORE UPDATE ON report_events
  FOR EACH ROW EXECUTE FUNCTION report_events_append_only();
--> statement-breakpoint

CREATE TRIGGER report_events_no_delete
  BEFORE DELETE ON report_events
  FOR EACH ROW EXECUTE FUNCTION report_events_append_only();
--> statement-breakpoint

-- Row-level triggers do not fire on TRUNCATE, so that route needs closing too.
CREATE TRIGGER report_events_no_truncate
  BEFORE TRUNCATE ON report_events
  FOR EACH STATEMENT EXECUTE FUNCTION report_events_append_only();
