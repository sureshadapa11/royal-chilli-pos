-- Daily Accounts is the source of truth for delivery-platform sales and
-- commission. Preserve historical platform_sales amounts by copying them into
-- days that have not already got those figures. Existing values always win.
BEGIN;

WITH old_totals AS (
  SELECT
    business_id,
    sales_date AS trading_date,
    SUM(sales) FILTER (WHERE platform = 'just_eat') AS just_eat,
    SUM(sales) FILTER (WHERE platform = 'deliveroo') AS deliveroo,
    SUM(sales) FILTER (WHERE platform = 'uber_eats') AS uber_eats,
    SUM(sales) FILTER (WHERE platform = 'hiest') AS hiest,
    SUM(commission) AS commission
  FROM platform_sales
  GROUP BY business_id, sales_date
)
INSERT INTO daily_accounts (business_id, trading_date, just_eat, deliveroo, uber_eats, hiest, commission, status)
SELECT business_id, trading_date, just_eat, deliveroo, uber_eats, hiest, commission, 'draft'
FROM old_totals
ON CONFLICT (business_id, trading_date) DO UPDATE SET
  just_eat = COALESCE(daily_accounts.just_eat, EXCLUDED.just_eat),
  deliveroo = COALESCE(daily_accounts.deliveroo, EXCLUDED.deliveroo),
  uber_eats = COALESCE(daily_accounts.uber_eats, EXCLUDED.uber_eats),
  hiest = COALESCE(daily_accounts.hiest, EXCLUDED.hiest),
  commission = COALESCE(daily_accounts.commission, EXCLUDED.commission);

-- Remove the retired area from Settings → Roles & Permissions. The historical
-- table remains available for audit/backfill and dashboard order counts.
DELETE FROM role_permissions WHERE permission = 'delivery_platforms';

COMMIT;
