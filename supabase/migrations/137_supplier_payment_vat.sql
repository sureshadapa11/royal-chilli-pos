-- Supplier payments count as stock costs (agreed 2026-10-15): purchase orders
-- aren't used, so a payment NOT linked to a purchase order is the stock cost on
-- the day it's paid (a payment for a received purchase order isn't counted
-- again). Like every expense, whether there's a VAT receipt is always asked:
-- 1 = VAT receipt (VAT claimed back), 0 = no VAT. NULL = older payments, no VAT.
-- Run BEFORE merging. Safe to re-run.
ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS vat_applicable SMALLINT CHECK (vat_applicable IN (0, 1));
