-- Колонки для статусу обробки фото через PhotoTruckMarket-логіку.
-- processed_path     — абсолютний шлях до результуючого JPG (NULL поки не оброблено)
-- processed_status   — pending (NULL також = pending) | done | failed | skipped
-- processed_error    — текст помилки, якщо failed/skipped
-- processed_at       — час останньої спроби

ALTER TABLE public.oils_images
  ADD COLUMN IF NOT EXISTS processed_path   text,
  ADD COLUMN IF NOT EXISTS processed_status text,
  ADD COLUMN IF NOT EXISTS processed_error  text,
  ADD COLUMN IF NOT EXISTS processed_at     timestamp without time zone;

CREATE INDEX IF NOT EXISTS oils_images_processed_status_idx
  ON public.oils_images(processed_status);
