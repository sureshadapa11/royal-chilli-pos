-- Catering & events jobs (agreed 2026-10-13): each catering or event job is
-- entered once with its total; payments (part payments too) are Money In
-- entries (cash_movements, category 'job_payment') linked to the job, so the
-- amount still owed is worked out, never retyped. Cash and bank transfer
-- payments count as sales on the day they're received; card payments on our
-- card machine are already in the Z report, so they only count toward what the
-- customer has paid. Old Day End catering figures stay as they are.
-- Run BEFORE merging. Safe to re-run.
BEGIN;

CREATE TABLE IF NOT EXISTS catering_jobs (
  id          SERIAL PRIMARY KEY,
  business_id INT NOT NULL REFERENCES businesses(id),
  kind        TEXT NOT NULL CHECK (kind IN ('catering', 'event')),
  customer    TEXT NOT NULL,
  phone       TEXT,
  job_date    DATE NOT NULL,
  total       NUMERIC(10,2) NOT NULL CHECK (total >= 0),
  notes       TEXT,
  cancelled   BOOLEAN NOT NULL DEFAULT FALSE,
  created_by  INT REFERENCES staff(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_catering_jobs_business_date ON catering_jobs (business_id, job_date);
ALTER TABLE catering_jobs ENABLE ROW LEVEL SECURITY;

-- A payment is a Money In entry pointing at its job. A job with payments
-- can't be deleted (cancel it instead), so payments never lose their job.
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS job_id INT REFERENCES catering_jobs(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_cash_movements_job ON cash_movements (job_id) WHERE job_id IS NOT NULL;

-- Money OUT "Event costs" (stall fee, hire, extra staff) creates an expense.
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_category_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_category_check CHECK (category IN (
  'rent', 'utilities', 'marketing', 'equipment', 'professional_fees', 'other',
  'food_stock', 'cleaning', 'repairs', 'customer_refund', 'event_costs'));

COMMIT;
