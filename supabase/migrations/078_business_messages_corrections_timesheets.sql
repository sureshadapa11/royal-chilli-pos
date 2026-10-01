-- 078 — Multi-business: staff messages, time corrections, timesheets.
--
-- • staff_messages: a message to "all staff" goes to the sending business's
--   staff, so each message records its business.
-- • attendance_corrections: a correction belongs to its attendance row's
--   business (or, for a missed day with no row yet, the business the person
--   was working for when they asked).
-- • timesheets: unique per business (someone at two businesses will have a
--   timesheet at each for the same pay period).
-- • loyalty_transactions: points earned or spent on an order record that
--   order's business (customers and the rewards scheme are shared; this is
--   what a later "points earned here, spent there" report between the
--   companies reads).
-- Existing rows are all The Royal Chilli (business 1). Safe to re-run.

BEGIN;

ALTER TABLE staff_messages         ADD COLUMN IF NOT EXISTS business_id INT NOT NULL DEFAULT 1 REFERENCES businesses(id);
ALTER TABLE attendance_corrections ADD COLUMN IF NOT EXISTS business_id INT NOT NULL DEFAULT 1 REFERENCES businesses(id);
CREATE INDEX IF NOT EXISTS idx_staff_messages_business ON staff_messages (business_id);
CREATE INDEX IF NOT EXISTS idx_attendance_corrections_business ON attendance_corrections (business_id);

-- A correction takes its attendance row's business (076's inherit function).
DROP TRIGGER IF EXISTS trg_inherit_business ON attendance_corrections;
CREATE TRIGGER trg_inherit_business BEFORE INSERT OR UPDATE ON attendance_corrections
  FOR EACH ROW EXECUTE FUNCTION inherit_business_id('attendance', 'attendance_id');

-- Rows never change business (077's rule).
DROP TRIGGER IF EXISTS trg_keep_business ON staff_messages;
CREATE TRIGGER trg_keep_business BEFORE UPDATE ON staff_messages FOR EACH ROW EXECUTE FUNCTION keep_business_id();
DROP TRIGGER IF EXISTS trg_keep_business ON attendance_corrections;
CREATE TRIGGER trg_keep_business BEFORE UPDATE ON attendance_corrections FOR EACH ROW EXECUTE FUNCTION keep_business_id();

-- Timesheets: one per person per pay period *per business*. The new rule
-- is added now; the old one-per-person rule is left in place so the attendance
-- app keeps working whichever version is live while this runs. It's dropped
-- later, when staff start working at a second business (Phase 5).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'timesheets_business_unique') THEN
    ALTER TABLE timesheets ADD CONSTRAINT timesheets_business_unique UNIQUE (business_id, staff_id, period_start, period_end);
  END IF;
END $$;

-- Points entries tied to an order take the order's business.
CREATE OR REPLACE FUNCTION loyalty_business_from_order() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE bid int;
BEGIN
  IF NEW.reference_type IN ('order', 'cash_credit', 'visit_bonus') AND NEW.reference_id IS NOT NULL THEN
    SELECT business_id INTO bid FROM orders WHERE id = NEW.reference_id;
    IF bid IS NOT NULL THEN NEW.business_id := bid; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_inherit_business ON loyalty_transactions;
CREATE TRIGGER trg_inherit_business BEFORE INSERT OR UPDATE ON loyalty_transactions
  FOR EACH ROW EXECUTE FUNCTION loyalty_business_from_order();

COMMIT;
