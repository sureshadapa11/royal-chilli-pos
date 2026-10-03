-- "Can deliver" replaces the Driver role (agreed 2026-10-03): a tick on any
-- staff member in HR. Ticked staff can be given delivery orders and sign in on
-- their phone to see My deliveries (only that). Old driver accounts keep
-- working and are ticked here.

ALTER TABLE staff ADD COLUMN IF NOT EXISTS can_deliver boolean NOT NULL DEFAULT false;
UPDATE staff SET can_deliver = true WHERE role = 'driver';
