-- 104: Website → traffic, dish photos and gallery (agreed 2026-10-03).
--   page_views: our own cookieless visit counting for each business's public
--     website. `visitor` is a one-way hash of (secret, day, IP, browser), so it
--     changes every day and can't identify anyone — no cookies, no consent
--     banner needed. Kept 13 months.
--   menu_items.image_url: a dish's photo, shown on the online order menu.
--   website_gallery: photos for the website's Gallery page.
-- Safe to re-run.
BEGIN;

CREATE TABLE IF NOT EXISTS page_views (
  id           BIGSERIAL PRIMARY KEY,
  business_id  INT NOT NULL REFERENCES businesses(id),
  day          DATE NOT NULL,
  visitor      TEXT NOT NULL,
  path         TEXT NOT NULL,
  referrer     TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_page_views_day ON page_views (business_id, day);
ALTER TABLE page_views ENABLE ROW LEVEL SECURITY;

ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS image_url TEXT;

CREATE TABLE IF NOT EXISTS website_gallery (
  id           SERIAL PRIMARY KEY,
  business_id  INT NOT NULL REFERENCES businesses(id),
  image_url    TEXT NOT NULL,
  caption      TEXT,
  position     INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_website_gallery ON website_gallery (business_id, position);
ALTER TABLE website_gallery ENABLE ROW LEVEL SECURITY;

COMMIT;
