-- 097: Hiest — a fourth delivery platform alongside Just Eat, Uber Eats and
-- Deliveroo (daily totals typed in on Staff Hub → Delivery platforms).
-- Safe to re-run.
BEGIN;

ALTER TABLE platform_sales DROP CONSTRAINT IF EXISTS platform_sales_platform_check;
ALTER TABLE platform_sales ADD CONSTRAINT platform_sales_platform_check
  CHECK (platform IN ('just_eat', 'uber_eats', 'deliveroo', 'hiest'));

COMMIT;
