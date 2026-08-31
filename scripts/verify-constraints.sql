-- Proves that the guarantees claimed in docs/schema.md are actually enforced
-- by Postgres, not merely intended. Run against a scratch database:
--
--   docker compose exec -T db psql -U expense -d expense -f - < scripts/verify-constraints.sql
--
-- Every check prints PASS or FAIL. Nothing here is left behind.

\set ON_ERROR_STOP on
\pset pager off

BEGIN;

-- Fixtures ------------------------------------------------------------------

INSERT INTO users (id, email, password_hash, name, role)
VALUES ('11111111-1111-1111-1111-111111111111', 'verify@northwind.test', 'x', 'Verify', 'employee');

INSERT INTO expense_reports (id, owner_id, title, period_start, period_end, status)
VALUES ('22222222-2222-2222-2222-222222222222',
        '11111111-1111-1111-1111-111111111111',
        'Verification report', '2026-08-01', '2026-08-31', 'draft');

INSERT INTO report_events (id, report_id, actor_id, kind, from_status, to_status)
VALUES ('33333333-3333-3333-3333-333333333333',
        '22222222-2222-2222-2222-222222222222',
        '11111111-1111-1111-1111-111111111111',
        'status_change', 'draft', 'submitted');

-- Checks --------------------------------------------------------------------

DO $$
DECLARE
  passed int := 0;
  failed int := 0;
BEGIN
  -- 1. Goal 9: the timeline cannot be rewritten.
  BEGIN
    UPDATE report_events SET reason = 'tampered with'
     WHERE id = '33333333-3333-3333-3333-333333333333';
    RAISE NOTICE 'FAIL  1  UPDATE on report_events was allowed';
    failed := failed + 1;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'PASS  1  UPDATE on report_events blocked';
    passed := passed + 1;
  END;

  BEGIN
    DELETE FROM report_events WHERE id = '33333333-3333-3333-3333-333333333333';
    RAISE NOTICE 'FAIL  2  DELETE on report_events was allowed';
    failed := failed + 1;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'PASS  2  DELETE on report_events blocked';
    passed := passed + 1;
  END;

  BEGIN
    TRUNCATE report_events CASCADE;
    RAISE NOTICE 'FAIL  3  TRUNCATE on report_events was allowed';
    failed := failed + 1;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'PASS  3  TRUNCATE on report_events blocked';
    passed := passed + 1;
  END;

  -- 2. Event shape: a status change carries statuses, a comment carries a body.
  BEGIN
    INSERT INTO report_events (report_id, actor_id, kind, to_status, body)
    VALUES ('22222222-2222-2222-2222-222222222222',
            '11111111-1111-1111-1111-111111111111',
            'status_change', 'approved', 'a body it should not have');
    RAISE NOTICE 'FAIL  4  malformed status_change event accepted';
    failed := failed + 1;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS  4  malformed status_change event rejected';
    passed := passed + 1;
  END;

  -- 3. Role, status and category vocabularies.
  BEGIN
    INSERT INTO users (email, password_hash, name, role)
    VALUES ('bogus@northwind.test', 'x', 'Bogus', 'administrator');
    RAISE NOTICE 'FAIL  5  unknown role accepted';
    failed := failed + 1;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS  5  unknown role rejected';
    passed := passed + 1;
  END;

  BEGIN
    UPDATE expense_reports SET status = 'rejected'
     WHERE id = '22222222-2222-2222-2222-222222222222';
    RAISE NOTICE 'FAIL  6  status outside the vocabulary accepted';
    failed := failed + 1;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS  6  status outside the vocabulary rejected';
    passed := passed + 1;
  END;

  BEGIN
    INSERT INTO expense_lines (report_id, incurred_on, amount, category, description)
    VALUES ('22222222-2222-2222-2222-222222222222', '2026-08-04', 42.00, 'bribes', 'nope');
    RAISE NOTICE 'FAIL  7  category outside the fixed list accepted';
    failed := failed + 1;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS  7  category outside the fixed list rejected';
    passed := passed + 1;
  END;

  -- 4. Money must be positive.
  BEGIN
    INSERT INTO expense_lines (report_id, incurred_on, amount, category, description)
    VALUES ('22222222-2222-2222-2222-222222222222', '2026-08-04', 0, 'meals', 'free lunch');
    RAISE NOTICE 'FAIL  8  zero-amount line accepted';
    failed := failed + 1;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS  8  zero-amount line rejected';
    passed := passed + 1;
  END;

  -- 5. A date range must run forwards.
  BEGIN
    INSERT INTO expense_reports (owner_id, title, period_start, period_end)
    VALUES ('11111111-1111-1111-1111-111111111111', 'Backwards', '2026-08-31', '2026-08-01');
    RAISE NOTICE 'FAIL  9  inverted period accepted';
    failed := failed + 1;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS  9  inverted period rejected';
    passed := passed + 1;
  END;

  -- 6. Email uniqueness is case-insensitive.
  BEGIN
    INSERT INTO users (email, password_hash, name, role)
    VALUES ('VERIFY@NORTHWIND.TEST', 'x', 'Duplicate', 'employee');
    RAISE NOTICE 'FAIL 10  case-variant duplicate email accepted';
    failed := failed + 1;
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS 10  case-variant duplicate email rejected';
    passed := passed + 1;
  END;

  RAISE NOTICE '';
  RAISE NOTICE '% passed, % failed', passed, failed;
  IF failed > 0 THEN
    RAISE EXCEPTION 'constraint verification failed';
  END IF;
END $$;

ROLLBACK;
