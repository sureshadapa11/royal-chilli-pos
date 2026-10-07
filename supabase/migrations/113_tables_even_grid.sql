-- 113: Tables floor plan — one even grid (agreed 2026-10-07). Columns are
-- whole slots again (no half steps), so every table and gap is the same.
-- Saved spots are tidied once: each row keeps its tables in the same left-to-
-- right order, packed into columns 0, 1, 2… (slot = 8 cells, top-left at
-- 1 + 8·col, 1 + 8·row — lib/floor-plan.ts). Rows don't change. Skipped for a
-- business with joined tables (a joined group must stay in a straight line).
-- Safe to re-run.
BEGIN;

WITH placed AS (
  SELECT id, business_id,
         round((pos_y - 1) / 8.0)::int AS r,
         row_number() OVER (PARTITION BY business_id, round((pos_y - 1) / 8.0) ORDER BY pos_x, id) - 1 AS c
    FROM restaurant_tables
   WHERE pos_x IS NOT NULL AND pos_y IS NOT NULL
     AND business_id NOT IN (SELECT business_id FROM restaurant_tables WHERE joined_to IS NOT NULL)
)
UPDATE restaurant_tables t
   SET pos_x = 1 + 8 * p.c, pos_y = 1 + 8 * p.r
  FROM placed p
 WHERE t.id = p.id;

COMMIT;

SELECT table_number, pos_x, pos_y FROM restaurant_tables WHERE business_id = 1 ORDER BY pos_y, pos_x;
