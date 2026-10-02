-- Staff Hub → Operations → Website: each business's editable website content
-- (homepage + SEO + social links), one JSONB document per business:
--   { homepage_hours, special_promo, about, gallery_enabled, ordering_coming_soon,
--     seo_title, seo_description, og_image_url,
--     social_links: { instagram, facebook, whatsapp } }
-- Read and written only through /api/website/config, which scopes every
-- request to the signed-in business. Shape and limits: lib/website-config.ts.

BEGIN;

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS website_config JSONB NOT NULL DEFAULT '{}'::jsonb;

-- The Royal Chilli starts from what lib/site-content.ts hardcodes today, so
-- the editor opens with the copy customers already see.
UPDATE businesses
SET website_config = jsonb_build_object(
  'homepage_hours', 'Every day, 9:00 AM – 1:00 AM',
  'gallery_enabled', true,
  'social_links', jsonb_build_object(
    'instagram', 'https://www.instagram.com/the_royal_chilli?igsh=MW12MTVzY2p0ZmUycw==',
    'whatsapp', 'https://wa.me/447766177108'
  )
)
WHERE id = 1 AND website_config = '{}'::jsonb;

COMMIT;
