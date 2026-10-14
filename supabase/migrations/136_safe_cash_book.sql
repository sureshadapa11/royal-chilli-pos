-- Two cash books (agreed 2026-10-14): 🧾 Till (the drawer) and 🔒 Safe
-- (cash that doesn't go through the till). Each cash Money In / Out entry
-- says which; the Day End's "Bank in" is now "Cash taken to Safe" (after the
-- till is counted); the Safe can be counted (blind, by managers). Sales are
-- unchanged. Run BEFORE merging. Safe to re-run.
BEGIN;

ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS place TEXT NOT NULL DEFAULT 'safe';
ALTER TABLE cash_movements ALTER COLUMN place SET DEFAULT 'safe';
ALTER TABLE cash_movements DROP CONSTRAINT IF EXISTS cash_movements_place_check;
ALTER TABLE cash_movements ADD CONSTRAINT cash_movements_place_check CHECK (place IN ('till', 'safe'));

CREATE TABLE IF NOT EXISTS safe_counts (
  id          SERIAL PRIMARY KEY,
  business_id INT NOT NULL REFERENCES businesses(id),
  count_date  DATE NOT NULL,
  amount      NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  note        TEXT,
  counted_by  INT REFERENCES staff(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_safe_counts_business_date ON safe_counts (business_id, count_date);
ALTER TABLE safe_counts ENABLE ROW LEVEL SECURITY;

-- ── The Royal Chilli's October entries (agreed with the owner 2026-10-14) ──
-- Owner cash (Raj), cash wages, advances and the gas repair went through the Safe.
UPDATE cash_movements SET place = 'safe' WHERE business_id = 1 AND id IN (3, 4, 7, 8, 9, 10, 11, 12, 13);

-- The £1,810 "Other income" was the birthday party catering, fully paid in
-- cash on 7 Oct into the Safe: a catering job and its payment.
WITH job AS (
  INSERT INTO catering_jobs (business_id, kind, customer, job_date, total, notes)
  SELECT 1, 'catering', 'Birthday party', DATE '2026-10-07', 1810, 'Recorded from Money In 2026-10-14'
  WHERE EXISTS (SELECT 1 FROM cash_movements WHERE id = 6 AND business_id = 1 AND category = 'other_in')
  RETURNING id
)
UPDATE cash_movements SET category = 'job_payment', job_id = (SELECT id FROM job), movement_date = DATE '2026-10-07',
  place = 'safe', reason = 'Catering: Birthday party'
WHERE id = 6 AND business_id = 1 AND EXISTS (SELECT 1 FROM job);

-- Each night from 1 Oct everything above the next day's opening went to the Safe.
UPDATE daily_accounts d SET bank_in = v.amt
FROM (VALUES ('2026-10-01', 53.74), ('2026-10-02', 102.96), ('2026-10-03', 44.90), ('2026-10-04', 80.94),
             ('2026-10-06', 57.65), ('2026-10-07', 113.99), ('2026-10-09', 14.90), ('2026-10-10', 66.78),
             ('2026-10-11', 304.82), ('2026-10-12', 351.25)) AS v(day, amt)
WHERE d.business_id = 1 AND d.trading_date = v.day::date AND COALESCE(d.bank_in, 0) = 0;

-- All cash Money In / Out goes through the Safe — the till only holds the
-- float and cash sales (owner, 2026-10-14). #13 (£250 gas repair, 11 Oct)
-- duplicated #15 (£289 gas repair + hose): its photo moves to #15's expense.
UPDATE receipt_photos SET entity_id = 3 WHERE id = 11 AND entity_type = 'expense' AND entity_id = 1;
DELETE FROM cash_movements WHERE id = 13 AND business_id = 1 AND expense_id = 1;
DELETE FROM expenses WHERE id = 1 AND business_id = 1;
UPDATE cash_movements SET place = 'safe' WHERE method = 'cash';

COMMIT;
