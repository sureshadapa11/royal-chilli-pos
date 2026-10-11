-- Cash In / Out categories (staff links): every entry has a category, and
-- each category has ONE home, so nothing is entered or counted twice
-- (lib/cash-categories.ts).
--   • expense categories create the expense itself (counted in Expenses)
--   • supplier payment creates the supplier payment (not counted: stock is
--     counted when the delivery is received)
--   • staff wages paid in cash → taken off that person's payslip
--   • staff advance / advance repaid → staff_advances (a loan, not a cost)
--   • owner, catering, other income → the cash book only
-- Run BEFORE merging. Safe to re-run. cash_movements was empty when written.
BEGIN;

ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_category_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_category_check CHECK (category IN (
  'rent', 'utilities', 'marketing', 'equipment', 'professional_fees', 'other',
  'food_stock', 'cleaning', 'repairs', 'customer_refund'));

ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS category TEXT;
UPDATE cash_movements SET category = CASE WHEN direction = 'out' THEN 'other' ELSE 'other_in' END WHERE category IS NULL;
ALTER TABLE cash_movements ALTER COLUMN category SET NOT NULL;
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS staff_member_id INT REFERENCES staff(id) ON DELETE SET NULL;  -- wages / advance: whose
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS supplier_id INT REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS expense_id INT REFERENCES expenses(id) ON DELETE SET NULL;
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS supplier_payment_id INT REFERENCES supplier_payments(id) ON DELETE SET NULL;

-- Staff advances: given (cash out), repaid (cash in), or taken off a payslip.
CREATE TABLE IF NOT EXISTS staff_advances (
  id               SERIAL PRIMARY KEY,
  business_id      INT NOT NULL REFERENCES businesses(id),
  staff_id         INT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL CHECK (kind IN ('advance', 'repaid', 'deducted')),
  amount           NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  advance_date     DATE NOT NULL,
  cash_movement_id INT REFERENCES cash_movements(id) ON DELETE CASCADE,
  payslip_id       INT REFERENCES employee_payslips(id) ON DELETE CASCADE,
  note             TEXT,
  created_by       INT REFERENCES staff(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_staff_advances_staff ON staff_advances (business_id, staff_id);
ALTER TABLE staff_advances ENABLE ROW LEVEL SECURITY;

-- A payslip remembers what was already paid in cash and what advance came off it.
ALTER TABLE employee_payslips ADD COLUMN IF NOT EXISTS cash_paid NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE employee_payslips ADD COLUMN IF NOT EXISTS advance_deducted NUMERIC(10,2) NOT NULL DEFAULT 0;

COMMIT;
