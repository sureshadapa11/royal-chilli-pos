-- Let a super admin make a further attendance-time correction while keeping
-- the one-change lock for managers and other roles. The application stamps
-- times_changed_at/by for every correction; the trigger only accepts a repeat
-- correction when that stamp belongs to an active admin in the same business.

CREATE OR REPLACE FUNCTION attendance_times_locked() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- A staff member's rows still go when the staff row is deleted (cascade).
    IF OLD.times_changed_at IS NOT NULL AND pg_trigger_depth() = 1 THEN
      RAISE EXCEPTION 'Attendance % is locked: its times were already changed once', OLD.id;
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
         SELECT 1 FROM staff s
         WHERE s.id = NEW.times_changed_by
           AND s.business_id = OLD.business_id
           AND s.role = 'admin'
           AND s.active = 1
       ) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Attendance % is locked: its times were already changed once', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
