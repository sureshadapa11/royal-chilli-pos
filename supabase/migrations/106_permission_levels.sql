-- 106: Roles & Permissions — Off / View / Full per area (agreed 2026-10-03).
--   level: off  = hidden; view = can look, can't change; full = see and change.
--   `granted` stays in step (granted = level <> 'off') for the code before this.
-- Managers (every business, their own business only):
--   full — Menu, Tables, Inventory, Approve stock takes, Drivers, Delivery
--          platforms, Daily accounts, Website, Till, Attendance & Rota, Settings
--   view — Customers & Loyalty, Analytics, Reports, Finance
--   off  — HR & Payroll, Audit log
-- HR: full on Attendance & Rota, HR & Payroll, Reports; off elsewhere.
-- Super admin always has everything, Front House only the till, Kitchen
-- nothing — not stored. Safe to re-run (resets Manager and HR to the above).
BEGIN;

ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS level TEXT;
ALTER TABLE role_permissions DROP CONSTRAINT IF EXISTS role_permissions_level_check;
ALTER TABLE role_permissions ADD CONSTRAINT role_permissions_level_check CHECK (level IN ('off', 'view', 'full'));

DELETE FROM role_permissions WHERE role IN ('manager', 'hr');

INSERT INTO role_permissions (role, permission, level, granted)
SELECT r.role, p.permission, lvl, lvl <> 'off'
  FROM (VALUES ('manager'), ('hr')) AS r(role)
 CROSS JOIN (VALUES ('menu'), ('tables'), ('inventory'), ('approve_stock_takes'), ('drivers'),
                    ('delivery_platforms'), ('daily_accounts'), ('website'), ('till'), ('attendance'),
                    ('hr'), ('customers'), ('analytics'), ('reports'), ('finance'), ('audit'),
                    ('settings')) AS p(permission)
 CROSS JOIN LATERAL (SELECT CASE
     WHEN r.role = 'manager' AND p.permission IN ('customers', 'analytics', 'reports', 'finance') THEN 'view'
     WHEN r.role = 'manager' AND p.permission IN ('hr', 'audit') THEN 'off'
     WHEN r.role = 'manager' THEN 'full'
     WHEN r.role = 'hr' AND p.permission IN ('attendance', 'hr', 'reports') THEN 'full'
     ELSE 'off' END AS lvl) AS l;

UPDATE role_permissions SET level = CASE WHEN granted THEN 'full' ELSE 'off' END WHERE level IS NULL;

COMMIT;

SELECT role, level, string_agg(permission, ', ' ORDER BY permission) AS areas
  FROM role_permissions GROUP BY role, level ORDER BY role, level;
