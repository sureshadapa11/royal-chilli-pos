-- Six roles (agreed 2026-10-03). Internal keys stay; the names people see are
-- in lib/roles.ts: admin = Super admin (only one — the group owner),
-- supervisor (new), manager, hr, employee = Front House, kitchen (new).
-- "driver" stays allowed for old accounts but can't be given any more.
-- Safe to run before the code ships: nothing uses the new roles yet.

ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_role_check;
ALTER TABLE staff ADD CONSTRAINT staff_role_check
  CHECK (role IN ('employee', 'kitchen', 'manager', 'supervisor', 'hr', 'admin', 'driver'));

-- Supervisor starts with exactly the Manager's Staff Hub tabs; Super admin
-- adds more in Settings → Roles & permissions.
INSERT INTO role_permissions (role, permission, granted)
SELECT 'supervisor', permission, granted FROM role_permissions WHERE role = 'manager'
ON CONFLICT (role, permission) DO NOTHING;
