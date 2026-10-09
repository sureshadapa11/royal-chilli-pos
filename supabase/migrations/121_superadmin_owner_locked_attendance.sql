-- Allow the group-owner super admin (staff.is_owner) to delete locked
-- attendance across businesses. Super admins have business_id = NULL.
-- Direct deletes remain blocked unless this verified RPC sets the context.

BEGIN;

CREATE OR REPLACE FUNCTION attendance_times_locked() RETURNS trigger AS $$
DECLARE
  delete_admin_id INT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.times_changed_at IS NOT NULL AND pg_trigger_depth() = 1 THEN
      delete_admin_id := NULLIF(current_setting('app.attendance_delete_admin_id', true), '')::INT;
      IF delete_admin_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.staff s
        WHERE s.id = delete_admin_id
          AND s.role = 'admin'
          AND s.active = 1
          AND (s.business_id = OLD.business_id OR s.is_owner IS TRUE)
      ) THEN
        RAISE EXCEPTION 'Attendance % is locked: its times were already changed once', OLD.id;
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.times_changed_at IS NOT NULL AND (
       NEW.times_changed_at IS DISTINCT FROM OLD.times_changed_at
    OR (OLD.clock_in  IS NOT NULL AND NEW.clock_in  IS DISTINCT FROM OLD.clock_in)
    OR (OLD.clock_out IS NOT NULL AND NEW.clock_out IS DISTINCT FROM OLD.clock_out)
    OR NEW.break_override_minutes IS DISTINCT FROM OLD.break_override_minutes
    OR NEW.adjustment_seconds     IS DISTINCT FROM OLD.adjustment_seconds
  ) THEN
    IF NEW.times_changed_at IS DISTINCT FROM OLD.times_changed_at
       AND NEW.times_changed_by IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM public.staff s
         WHERE s.id = NEW.times_changed_by
           AND s.role = 'admin'
           AND s.active = 1
           AND (s.business_id = OLD.business_id OR s.is_owner IS TRUE)
       ) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Attendance % is locked: its times were already changed once', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION delete_locked_attendance_as_admin(
  p_attendance_id INT,
  p_business_id INT,
  p_admin_id INT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  was_deleted BOOLEAN;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.staff s
    WHERE s.id = p_admin_id
      AND s.role = 'admin'
      AND s.active = 1
      AND (s.business_id = p_business_id OR s.is_owner IS TRUE)
  ) THEN
    RAISE EXCEPTION 'Active super admin required' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('app.attendance_delete_admin_id', p_admin_id::TEXT, true);

  DELETE FROM public.attendance
  WHERE id = p_attendance_id AND business_id = p_business_id;
  was_deleted := FOUND;
  RETURN was_deleted;
END;
$$;

REVOKE ALL ON FUNCTION delete_locked_attendance_as_admin(INT, INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION delete_locked_attendance_as_admin(INT, INT, INT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION delete_locked_attendance_as_admin(INT, INT, INT) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
