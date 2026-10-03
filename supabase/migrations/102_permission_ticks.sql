-- Settings → Roles & Permissions: one tick per Staff Hub area (agreed
-- 2026-10-03). New areas: drivers, delivery_platforms, daily_accounts, till,
-- customers (before, these were fixed in code or followed Finance).
-- Supervisor, Manager and HR are reset to the agreed starting point:
--   Manager / Supervisor: Menu, Tables, Inventory (+ approve stock takes),
--     Drivers, Delivery platforms, Daily accounts, Website, Till,
--     Attendance & Rota, Customers & Loyalty, Settings.
--     No HR & Payroll, no Analytics / Reports / Finance / Audit log.
--   HR: Attendance & Rota, HR & Payroll, Reports.
-- Super admin always has everything; Front House only the till; Kitchen
-- nothing — those three aren't stored. Super admin can change the rest.

BEGIN;

DELETE FROM role_permissions WHERE role IN ('supervisor', 'manager', 'hr', 'admin', 'employee', 'kitchen');

INSERT INTO role_permissions (role, permission, granted)
SELECT r.role, p.permission,
       CASE
         WHEN r.role IN ('supervisor', 'manager') THEN p.permission IN
           ('menu', 'tables', 'inventory', 'approve_stock_takes', 'drivers', 'delivery_platforms',
            'daily_accounts', 'website', 'till', 'attendance', 'customers', 'settings')
         WHEN r.role = 'hr' THEN p.permission IN ('attendance', 'hr', 'reports')
       END
  FROM (VALUES ('supervisor'), ('manager'), ('hr')) AS r(role)
 CROSS JOIN (VALUES ('menu'), ('tables'), ('inventory'), ('approve_stock_takes'), ('drivers'),
                    ('delivery_platforms'), ('daily_accounts'), ('website'), ('till'), ('attendance'),
                    ('hr'), ('customers'), ('analytics'), ('reports'), ('finance'), ('audit'),
                    ('settings')) AS p(permission);

COMMIT;

SELECT role, string_agg(permission, ', ' ORDER BY permission) FILTER (WHERE granted) AS ticked
  FROM role_permissions GROUP BY role ORDER BY role;
