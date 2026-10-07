-- 111: Floor plan — every table the same size, back in the till's old layout
-- (agreed 2026-10-07). The hand-dragged spots and mixed sizes made the plan
-- look zigzag. Clearing the saved spots makes the app lay the tables out as
-- before: T1–T9 as a 3×3 block read column by column (T3 T6 T9 / T2 T5 T8 /
-- T1 T4 T7), T10–T13 in a row of 4 underneath (lib/floor-plan.ts). Staff Hub
-- → Tables saves those spots the next time it's opened. Turns are cleared;
-- shape is kept but not drawn for now.
-- Safe to run before or after merging. Re-running resets any moves since.
BEGIN;

UPDATE restaurant_tables SET pos_x = NULL, pos_y = NULL, rotation = 0;

COMMIT;
