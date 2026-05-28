-- Час успішного завантаження фото на TruckMarket для конкретного listing.
-- listing_id зберігається в olivs.truck_listing_id; колонка тут нам потрібна
-- лише як прапор "це фото вже залите для поточного truck_listing_id".
-- Якщо truck_listing_id скидається (re-upload) — uploaded_at теж скидаємо.

ALTER TABLE public.oils_images
  ADD COLUMN IF NOT EXISTS uploaded_at      timestamp without time zone,
  ADD COLUMN IF NOT EXISTS upload_error     text;
