-- 110: Photo proof for money going out + attendance times change once (agreed 2026-10-05).
--
-- 1. receipt_photos — every supplier delivery (purchase order received),
--    supplier payment and expense needs at least one photo of its invoice /
--    receipt. A photo is uploaded first (checked on the phone for blur,
--    darkness and size), then attached to the entry when it's saved. Old
--    entries without photos are left as they are.
--    Files live in the private "receipts" bucket under <business_id>/…, only
--    ever served out by short-lived signed URLs.
--
-- 2. attendance.times_changed_at — a shift's times (clock in / out, break,
--    adjustment) can be changed ONCE, by an approved correction or a manager
--    edit. After that they're locked for everyone. Kiosk punches still fill
--    in a missing clock-out; the trigger below only stops times that are
--    already set from being changed again. Existing rows start unlocked.
--
-- Run BEFORE merging (both apps write these). Safe to re-run.
BEGIN;

CREATE TABLE IF NOT EXISTS receipt_photos (
  id             SERIAL PRIMARY KEY,
  business_id    INT NOT NULL REFERENCES businesses(id),
  -- null until the entry it proves is saved
  entity_type    TEXT CHECK (entity_type IN ('expense', 'supplier_payment', 'purchase_order')),
  entity_id      INT,
  file_path      TEXT NOT NULL,
  sharpness      NUMERIC(10,2),                 -- phone's blur score (higher = sharper)
  uploaded_by    INT REFERENCES staff(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attached_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_receipt_photos_entity ON receipt_photos (business_id, entity_type, entity_id);
ALTER TABLE receipt_photos ENABLE ROW LEVEL SECURITY;

INSERT INTO storage.buckets (id, name, public)
VALUES ('receipts', 'receipts', false)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE attendance ADD COLUMN IF NOT EXISTS times_changed_at TIMESTAMPTZ;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS times_changed_by INT REFERENCES staff(id) ON DELETE SET NULL;

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
    RAISE EXCEPTION 'Attendance % is locked: its times were already changed once', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_attendance_times_locked ON attendance;
CREATE TRIGGER trg_attendance_times_locked BEFORE UPDATE OR DELETE ON attendance
  FOR EACH ROW EXECUTE FUNCTION attendance_times_locked();

COMMIT;
