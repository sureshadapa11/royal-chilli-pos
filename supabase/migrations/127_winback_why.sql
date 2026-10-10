-- 127: "Why did you stop coming?" (agreed 2026-10-10). After 21 days without
-- a visit, opted-in customers get one email (at most every 90 days) asking
-- why, with one-tap reasons. Each reason gives its own come-back reward code,
-- used on the till like any Rewards Club code. Amounts can be changed in
-- Customers → Rewards Catalog.
-- Safe to run before or after the code; safe to re-run.
BEGIN;

-- A come-back reward answers one reason; only ever given by the win-back
-- email, never claimable with points or issued by hand.
ALTER TABLE loyalty_rewards ADD COLUMN IF NOT EXISTS winback_reason TEXT
  CHECK (winback_reason IN ('food', 'service', 'price', 'distance', 'waiting', 'busy'));
CREATE UNIQUE INDEX IF NOT EXISTS uq_loyalty_rewards_winback ON loyalty_rewards (business_id, winback_reason) WHERE winback_reason IS NOT NULL;

INSERT INTO loyalty_rewards (business_id, name, description, points_cost, active, discount_amount, discount_pct, max_discount, order_types, valid_days, per_customer_limit, winback_reason)
SELECT b.id, r.name, r.description, 0, 1, r.amount, r.pct, r.max, r.types, 30, 1, r.reason
FROM businesses b
CROSS JOIN (VALUES
  ('food',     'Come-back: free starter',              'Any starter on us on your next visit',                          8.95, NULL::numeric, NULL::numeric, NULL::text[]),
  ('service',  'Come-back: free dessert',              'A dessert on us, and a personal welcome from the manager',     5.95, NULL, NULL, ARRAY['dine_in']),
  ('price',    'Come-back: 10% off',                   '10% off your next bill',                                       NULL, 10, 20, NULL),
  ('distance', 'Come-back: free delivery',             'Free delivery on your next order',                              3.50, NULL, NULL, ARRAY['delivery']),
  ('waiting',  'Come-back: priority seating',          'Show this code and we will seat you first, with no wait',      0,    NULL, NULL, ARRAY['dine_in']),
  ('busy',     'Come-back: free drink',                'A soft drink on us on your next visit',                         3.00, NULL, NULL, NULL)
) AS r(reason, name, description, amount, pct, max, types)
WHERE NOT EXISTS (SELECT 1 FROM loyalty_rewards x WHERE x.business_id = b.id AND x.winback_reason = r.reason);

ALTER TABLE customers ADD COLUMN IF NOT EXISTS winback_asked_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS winback_requests (
  id             SERIAL PRIMARY KEY,
  business_id    INT NOT NULL REFERENCES businesses(id),
  customer_id    INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  token          TEXT NOT NULL UNIQUE,
  last_visit     DATE,
  sent_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason         TEXT CHECK (reason IN ('food', 'service', 'price', 'distance', 'waiting', 'busy')),
  comment        TEXT,
  answered_at    TIMESTAMPTZ,
  redemption_id  INT REFERENCES loyalty_redemptions(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_winback_requests_business ON winback_requests (business_id, sent_at DESC);
ALTER TABLE winback_requests ENABLE ROW LEVEL SECURITY;

COMMIT;
