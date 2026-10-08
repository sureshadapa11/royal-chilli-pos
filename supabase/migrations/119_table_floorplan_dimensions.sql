-- Add editable floor-plan footprints. Existing tables keep the current size.
BEGIN;

ALTER TABLE restaurant_tables ADD COLUMN IF NOT EXISTS width numeric(5,2) NOT NULL DEFAULT 7;
ALTER TABLE restaurant_tables ADD COLUMN IF NOT EXISTS depth numeric(5,2) NOT NULL DEFAULT 7;
ALTER TABLE restaurant_tables DROP CONSTRAINT IF EXISTS restaurant_tables_floorplan_dimensions_check;
ALTER TABLE restaurant_tables ADD CONSTRAINT restaurant_tables_floorplan_dimensions_check
  CHECK (width >= 4 AND width <= 12 AND depth >= 4 AND depth <= 12);

COMMIT;
