-- Money In / Out (staff link): how each entry was paid (agreed 2026-10-12).
-- Only cash moves the cash drawer, so only cash counts in the drawer check;
-- card and bank transfer are still recorded. Existing entries were all cash.
-- Run BEFORE merging. Safe to re-run.
BEGIN;

ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS method TEXT NOT NULL DEFAULT 'cash';
ALTER TABLE cash_movements DROP CONSTRAINT IF EXISTS cash_movements_method_check;
ALTER TABLE cash_movements ADD CONSTRAINT cash_movements_method_check CHECK (method IN ('cash', 'card', 'bank'));

COMMIT;
