-- Card fee rate per business (Settings → Business setup → Tax & VAT), used for
-- the card charge in "money out" (Daily accounts month sheet and the owner's
-- All businesses table). SumUp is 1.69%. Safe to run before or after the code.
BEGIN;

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS card_fee_rate NUMERIC(6,4) NOT NULL DEFAULT 0.0169;

COMMIT;
