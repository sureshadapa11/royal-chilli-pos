-- 109: Floor plan — free placement and rotation (agreed 2026-10-03).
--   pos_x / pos_y can be anywhere (fractions of a grid cell), not just whole
--   cells; existing spots are kept exactly.
--   rotation: degrees, in 45° steps (0, 45 … 315), turned about the table's
--   centre. Round tables ignore it.
-- Run BEFORE merging (the app writes these). Safe to re-run.
BEGIN;

ALTER TABLE restaurant_tables ALTER COLUMN pos_x TYPE numeric(6,2) USING pos_x::numeric;
ALTER TABLE restaurant_tables ALTER COLUMN pos_y TYPE numeric(6,2) USING pos_y::numeric;
ALTER TABLE restaurant_tables ADD COLUMN IF NOT EXISTS rotation int NOT NULL DEFAULT 0;
ALTER TABLE restaurant_tables DROP CONSTRAINT IF EXISTS restaurant_tables_rotation_check;
ALTER TABLE restaurant_tables ADD CONSTRAINT restaurant_tables_rotation_check
  CHECK (rotation >= 0 AND rotation < 360 AND rotation % 45 = 0);

COMMIT;
