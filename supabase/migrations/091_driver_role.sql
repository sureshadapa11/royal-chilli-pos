-- Drivers get their own staff role again (032 folded them into 'employee').
-- A driver signs in to the Staff Hub but only sees /staff/drivers: their own
-- assigned deliveries and their availability (app/api/drivers/*). They have
-- no Staff Hub tabs and no role_permissions rows.

BEGIN;

ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_role_check;
ALTER TABLE staff ADD CONSTRAINT staff_role_check
  CHECK (role IN ('employee', 'manager', 'hr', 'admin', 'driver'));

COMMIT;
