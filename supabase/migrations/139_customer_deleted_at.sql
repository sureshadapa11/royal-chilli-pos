-- 139: "Delete my account" (My Account → Profile). The customer row is kept so
-- past orders still add up in the sales figures, but its personal details are
-- wiped (lib/customer-delete.ts) and deleted_at is set. A session cookie still
-- open on another device stops working once this is set (lib/customer-auth.ts).
-- Safe to re-run.
alter table customers add column if not exists deleted_at timestamptz;
