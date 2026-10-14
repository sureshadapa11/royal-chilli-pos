-- Customer allergies (agreed 2026-10-14): before ordering or booking, the
-- customer answers "Any food allergies?"; on Yes they tick the allergens (the
-- 14) and describe it. Saved on the order / booking so the kitchen ticket,
-- Kitchen Display, staff screens and emails show a clear ALLERGY banner.
-- NULL = not asked (older orders, platforms); an empty array with no notes = "No".
-- Run BEFORE merging. Safe to re-run.
BEGIN;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS allergy_allergens TEXT[];
ALTER TABLE orders ADD COLUMN IF NOT EXISTS allergy_notes TEXT;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS allergy_allergens TEXT[];
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS allergy_notes TEXT;

-- A QR table order with an allergy calls a member of staff to the table.
ALTER TABLE table_requests DROP CONSTRAINT IF EXISTS table_requests_type_check;
ALTER TABLE table_requests ADD CONSTRAINT table_requests_type_check CHECK (type IN ('waiter', 'bill', 'allergy'));

COMMIT;
