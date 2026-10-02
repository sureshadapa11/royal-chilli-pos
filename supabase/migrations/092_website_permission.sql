-- New Staff Hub tab: Operations → Website (/staff/website). Same default
-- access as Menu / Inventory: managers + admins (admin is implicit-allow in
-- code). Without this row managers would lose the tab once role_permissions
-- is loaded, because a key with no granted rows means "nobody but admin".

BEGIN;

INSERT INTO role_permissions (role, permission, granted)
VALUES ('manager', 'website', true)
ON CONFLICT (role, permission) DO NOTHING;

COMMIT;
