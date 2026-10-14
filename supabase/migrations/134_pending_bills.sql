-- Pending bills (agreed 2026-10-14): a bill left unpaid is entered once
-- (customer, amount, date) and payments — part payments too — are recorded
-- against it, so what's owed is worked out, never retyped each day.
-- TRACKING ONLY: the sale was rung on the till (in that day's Z report) and the
-- payment is taken at the till too, so neither changes sales or the cash check.
-- Old typed "Pending" Day End figures stay as they are.
-- Run BEFORE merging. Safe to re-run.
BEGIN;

CREATE TABLE IF NOT EXISTS pending_bills (
  id          SERIAL PRIMARY KEY,
  business_id INT NOT NULL REFERENCES businesses(id),
  customer    TEXT NOT NULL,
  phone       TEXT,
  bill_date   DATE NOT NULL,
  amount      NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  notes       TEXT,
  cancelled   BOOLEAN NOT NULL DEFAULT FALSE,
  created_by  INT REFERENCES staff(id) ON DELETE SET NULL,
  source      TEXT NOT NULL DEFAULT 'staff_hub',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pending_bills_business_date ON pending_bills (business_id, bill_date);
ALTER TABLE pending_bills ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS pending_bill_payments (
  id          SERIAL PRIMARY KEY,
  business_id INT NOT NULL REFERENCES businesses(id),
  bill_id     INT NOT NULL REFERENCES pending_bills(id) ON DELETE CASCADE,
  paid_date   DATE NOT NULL,
  amount      NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  method      TEXT NOT NULL DEFAULT 'cash' CHECK (method IN ('cash', 'card', 'bank')),
  staff_id    INT REFERENCES staff(id) ON DELETE SET NULL,
  source      TEXT NOT NULL DEFAULT 'staff_hub',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pending_bill_payments_bill ON pending_bill_payments (bill_id);
ALTER TABLE pending_bill_payments ENABLE ROW LEVEL SECURITY;

COMMIT;
