-- Staff links (Day End + Cash In/Out forms opened from a saved link or QR,
-- no Staff Hub login, staff PIN only) — lib/staff-links.ts.
--
-- cash_movements: money put in or taken out of the cash drawer, with the
-- reason staff typed and who entered it. Money out needs a receipt photo
-- (receipt_photos, entity 'cash_movement'); the Day End's optional Z report
-- photo is entity 'daily_account'.
--
-- Run BEFORE merging (the links write these). Safe to re-run.
BEGIN;

CREATE TABLE IF NOT EXISTS cash_movements (
  id             SERIAL PRIMARY KEY,
  business_id    INT NOT NULL REFERENCES businesses(id),
  movement_date  DATE NOT NULL,
  direction      TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  amount         NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  reason         TEXT NOT NULL,
  paid_to        TEXT,
  staff_id       INT REFERENCES staff(id) ON DELETE SET NULL,
  source         TEXT NOT NULL DEFAULT 'link',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cash_movements_day ON cash_movements (business_id, movement_date);
ALTER TABLE cash_movements ENABLE ROW LEVEL SECURITY;

ALTER TABLE receipt_photos DROP CONSTRAINT IF EXISTS receipt_photos_entity_type_check;
ALTER TABLE receipt_photos ADD CONSTRAINT receipt_photos_entity_type_check
  CHECK (entity_type IN ('expense', 'supplier_payment', 'purchase_order', 'cash_movement', 'daily_account'));

ALTER TABLE daily_accounts ADD COLUMN IF NOT EXISTS submitted_via TEXT;

COMMIT;
