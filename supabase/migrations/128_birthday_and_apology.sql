-- 128: Automatic birthday treat and the apology offer (agreed 2026-10-11).
-- • Birthday: a free dessert, created 7 days before the birthday and valid
--   14 days, for every member with a birthday (day + month) on their account.
-- • Apology: a free dessert staff send in one click from Customers → Feedback
--   to an unhappy guest who is a Rewards Club member.
-- Both are gifts: never claimable with points or issued by hand.
-- Safe to run before or after the code; safe to re-run.
BEGIN;

ALTER TABLE loyalty_rewards ADD COLUMN IF NOT EXISTS is_apology_reward BOOLEAN NOT NULL DEFAULT FALSE;

INSERT INTO loyalty_rewards (business_id, name, description, points_cost, active, discount_amount, order_types, valid_days, is_birthday_reward)
SELECT b.id, 'Birthday: free dessert', 'Happy birthday! A dessert on us', 0, 1, 5.95, ARRAY['dine_in'], 14, TRUE
FROM businesses b
WHERE NOT EXISTS (SELECT 1 FROM loyalty_rewards x WHERE x.business_id = b.id AND x.is_birthday_reward);

INSERT INTO loyalty_rewards (business_id, name, description, points_cost, active, discount_amount, order_types, valid_days, is_apology_reward)
SELECT b.id, 'Apology: free dessert', 'Sorry we let you down. A dessert on us next time', 0, 1, 5.95, ARRAY['dine_in'], 30, TRUE
FROM businesses b
WHERE NOT EXISTS (SELECT 1 FROM loyalty_rewards x WHERE x.business_id = b.id AND x.is_apology_reward);

-- Which apology offer went to which unhappy guest (one per feedback).
ALTER TABLE guest_feedback ADD COLUMN IF NOT EXISTS apology_redemption_id INT REFERENCES loyalty_redemptions(id) ON DELETE SET NULL;

COMMIT;
