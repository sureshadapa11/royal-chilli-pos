-- 108: Table floor plan (Staff Hub → Tables, agreed 2026-10-03). Each table
-- gets a spot on the one-floor grid (pos_x, pos_y = top-left cell, see
-- lib/floor-plan.ts) and a shape. The Royal Chilli's 13 tables are placed
-- where the till showed them before: T1–T9 as a 3×3 block read column by
-- column (T3 T6 T9 / T2 T5 T8 / T1 T4 T7), T10–T13 in a row underneath.
-- Tables without a position are laid out the same way by the app.
-- Run BEFORE merging (the app reads these columns). Safe to re-run.
BEGIN;

ALTER TABLE restaurant_tables ADD COLUMN IF NOT EXISTS pos_x int;
ALTER TABLE restaurant_tables ADD COLUMN IF NOT EXISTS pos_y int;
ALTER TABLE restaurant_tables ADD COLUMN IF NOT EXISTS shape text NOT NULL DEFAULT 'square';
ALTER TABLE restaurant_tables DROP CONSTRAINT IF EXISTS restaurant_tables_shape_check;
ALTER TABLE restaurant_tables ADD CONSTRAINT restaurant_tables_shape_check CHECK (shape IN ('square', 'round', 'rect'));

UPDATE restaurant_tables t SET pos_x = p.x, pos_y = p.y
  FROM (VALUES
    ('T3', 1, 1),  ('T6', 9, 1),  ('T9', 17, 1),
    ('T2', 1, 9),  ('T5', 9, 9),  ('T8', 17, 9),
    ('T1', 1, 17), ('T4', 9, 17), ('T7', 17, 17),
    ('T10', 1, 25), ('T11', 9, 25), ('T12', 17, 25), ('T13', 25, 25)
  ) AS p(num, x, y)
 WHERE t.business_id = 1 AND t.table_number = p.num AND t.pos_x IS NULL;

COMMIT;

SELECT table_number, capacity, shape, pos_x, pos_y FROM restaurant_tables WHERE business_id = 1 ORDER BY pos_y, pos_x;
