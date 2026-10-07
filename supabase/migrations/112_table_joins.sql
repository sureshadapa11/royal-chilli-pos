-- 112: Joined tables (Staff Hub → Tables, agreed 2026-10-07). Two or more
-- tables pushed together for a big party are joined in Settings and act as
-- one table until unjoined: one order, one bill, one QR bill.
--   joined_to  — on each extra table: the group's lead table. The lead (the
--                table orders are put on) has NULL here.
--   group_name — on the lead, optional ("🎂 Birthday party").
--   join_label — on the lead, kept up to date by the app: "T1 + T2", plus
--                " · <group name>" when there is one. Shown on the till, the
--                kitchen ticket and the receipt instead of the table number.
-- Run BEFORE merging (the app reads these columns). Safe to re-run.
BEGIN;

ALTER TABLE restaurant_tables ADD COLUMN IF NOT EXISTS joined_to int REFERENCES restaurant_tables(id) ON DELETE SET NULL;
ALTER TABLE restaurant_tables ADD COLUMN IF NOT EXISTS group_name text;
ALTER TABLE restaurant_tables ADD COLUMN IF NOT EXISTS join_label text;
ALTER TABLE restaurant_tables DROP CONSTRAINT IF EXISTS restaurant_tables_not_joined_to_self;
ALTER TABLE restaurant_tables ADD CONSTRAINT restaurant_tables_not_joined_to_self CHECK (joined_to IS NULL OR joined_to <> id);

COMMIT;
