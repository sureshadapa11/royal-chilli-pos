-- 098: daily accounts — the manager's day-end sheet (replaces the paper
-- "Daily Accounts Report"), one row per business per trading day. Till
-- figures are pre-filled (Z report, pay-later bills, takeaway, delivery
-- platforms) and stay editable; bank in, catering and notes are typed in.
-- Submitted rows are locked to admins/the owner (Staff Hub → Daily accounts).
-- Safe to re-run.
BEGIN;

CREATE TABLE IF NOT EXISTS daily_accounts (
  id               SERIAL PRIMARY KEY,
  business_id      INT NOT NULL REFERENCES businesses(id),
  trading_date     DATE NOT NULL,
  z_report         NUMERIC(10,2),
  card             NUMERIC(10,2),
  cash             NUMERIC(10,2),
  bank_in          NUMERIC(10,2),
  commission       NUMERIC(10,2),
  pending          NUMERIC(10,2),
  takeaway         NUMERIC(10,2),
  just_eat         NUMERIC(10,2),
  deliveroo        NUMERIC(10,2),
  uber_eats        NUMERIC(10,2),
  hiest            NUMERIC(10,2),
  catering_paid    NUMERIC(10,2),
  catering_pending NUMERIC(10,2),
  opening_balance  NUMERIC(10,2),
  closing_balance  NUMERIC(10,2),
  notes            TEXT,
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
  submitted_by     INT REFERENCES staff(id),
  submitted_at     TIMESTAMPTZ,
  updated_by       INT REFERENCES staff(id),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, trading_date)
);
CREATE INDEX IF NOT EXISTS idx_daily_accounts_date ON daily_accounts (business_id, trading_date);
ALTER TABLE daily_accounts ENABLE ROW LEVEL SECURITY;

COMMIT;
