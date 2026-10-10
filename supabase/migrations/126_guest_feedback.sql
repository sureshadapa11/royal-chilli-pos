-- 126: Guest feedback (agreed 2026-10-10). "How was your meal?" from the table
-- QR, the receipt or the website: stars, what was great, what could be
-- better (tapped, so no AI is needed to sort it), an optional comment and
-- optional contact details. 1–3 stars shows up in the Staff Hub to call back.
-- Every guest is offered the Google review link, whatever their rating.
-- Safe to run before or after the code; safe to re-run.
BEGIN;

CREATE TABLE IF NOT EXISTS guest_feedback (
  id            SERIAL PRIMARY KEY,
  business_id   INT NOT NULL REFERENCES businesses(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rating        SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  liked         TEXT[] NOT NULL DEFAULT '{}',
  improve       TEXT[] NOT NULL DEFAULT '{}',
  comment       TEXT,
  name          TEXT,
  phone         TEXT,
  email         TEXT,
  contact_ok    BOOLEAN NOT NULL DEFAULT FALSE,   -- "you can contact me about this"
  customer_id   INT REFERENCES customers(id) ON DELETE SET NULL,
  source        TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('table', 'receipt', 'email', 'web')),
  table_label   TEXT,
  handled_at    TIMESTAMPTZ,
  handled_by    INT REFERENCES staff(id) ON DELETE SET NULL,
  handled_note  TEXT
);
CREATE INDEX IF NOT EXISTS idx_guest_feedback_business_created ON guest_feedback (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_guest_feedback_open ON guest_feedback (business_id) WHERE rating <= 3 AND handled_at IS NULL;
ALTER TABLE guest_feedback ENABLE ROW LEVEL SECURITY;

COMMIT;
