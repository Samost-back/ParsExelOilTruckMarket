-- Шляхи до завантажених xlsx і папки з фото для кожної компанії.
-- Зберігаємо щоб у UI було видно "який прайс/фото було завантажено востаннє".

ALTER TABLE public.company_olivs
  ADD COLUMN IF NOT EXISTS xlsx_path   text,
  ADD COLUMN IF NOT EXISTS xlsx_at     timestamp without time zone,
  ADD COLUMN IF NOT EXISTS photos_dir  text,
  ADD COLUMN IF NOT EXISTS photos_at   timestamp without time zone;
