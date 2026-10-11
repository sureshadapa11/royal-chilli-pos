-- Two more roles (agreed 2026-10-11):
--   supervisor — above Manager, not on the rota: Manager's access + HR &
--                Payroll to view + Analytics / Reports / Finance in full, and
--                can correct submitted Daily accounts. Given by Super admin / HR.
--   bar        — the till only (PIN on a paired till), like Front House; on
--                the rota. Given by Super admin / HR / Manager / Supervisor.
-- Supervisor starts from Manager's CURRENT ticks (Settings → Roles &
-- permissions), so any change made to Manager carries over.
-- Run BEFORE merging (both apps). Safe to re-run.
BEGIN;

ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_role_check;
ALTER TABLE staff ADD CONSTRAINT staff_role_check
  CHECK (role IN ('employee', 'kitchen', 'bar', 'manager', 'supervisor', 'hr', 'admin', 'driver'));

INSERT INTO role_permissions (role, permission, level, granted)
SELECT 'supervisor', permission,
       CASE WHEN permission = 'hr' THEN 'view'
            WHEN permission IN ('analytics', 'reports', 'finance') THEN 'full'
            ELSE level END,
       CASE WHEN permission IN ('hr', 'analytics', 'reports', 'finance') THEN true ELSE level <> 'off' END
  FROM role_permissions WHERE role = 'manager'
ON CONFLICT (role, permission) DO NOTHING;

COMMIT;

SELECT role, level, string_agg(permission, ', ' ORDER BY permission) AS areas
  FROM role_permissions WHERE role IN ('manager', 'supervisor') GROUP BY role, level ORDER BY role, level;
