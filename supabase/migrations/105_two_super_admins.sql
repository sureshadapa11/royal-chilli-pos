-- 105: Two Super admins, no Supervisor role (agreed 2026-10-03).
--   Suresh (staff 25, was Supervisor) becomes a Super admin exactly like the
--   first one: role admin, group owner (is_owner), no business of his own —
--   he works in every business and is no longer on The Royal Chilli's staff
--   list (HR, payroll, attendance, locations). Username, password and till
--   PIN are unchanged.
--   The Supervisor role is removed (its permission rows and the allowed role).
--   Super admins are fixed accounts — the app can't give the role.
-- Run BEFORE merging the code that drops Supervisor. Stops without changing
-- anything unless Suresh is the only Supervisor.

BEGIN;

DO $$
BEGIN
  IF (SELECT count(*) FROM staff WHERE role = 'supervisor') <> 1
     OR NOT EXISTS (SELECT 1 FROM staff WHERE id = 25 AND name = 'Suresh' AND role = 'supervisor') THEN
    RAISE EXCEPTION 'Expected Suresh (staff 25) to be the only Supervisor — nothing changed';
  END IF;
END $$;

UPDATE staff SET role = 'admin', is_owner = true, business_id = NULL WHERE id = 25 AND name = 'Suresh';
DELETE FROM staff_locations WHERE staff_id = 25;

DELETE FROM role_permissions WHERE role = 'supervisor';
ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_role_check;
ALTER TABLE staff ADD CONSTRAINT staff_role_check
  CHECK (role IN ('employee', 'kitchen', 'manager', 'hr', 'admin', 'driver'));

INSERT INTO audit_logs (business_id, staff_id, action, entity_type, entity_id, changes)
VALUES (1, 26, 'staff_role_changed', 'staff', 25,
  '{"role": {"from": "supervisor", "to": "admin"}, "group_owner": true, "note": "Second Super admin; Supervisor role removed"}'::jsonb);

COMMIT;

SELECT id, name, username, role, is_owner, business_id FROM staff WHERE role = 'admin' ORDER BY id;
