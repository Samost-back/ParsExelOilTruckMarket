-- Згенерований OpenAI SEO-опис для оголошення TruckMarket.
-- Зберігаємо в БД, щоб не платити за генерацію кожного запуску.
-- Статуси:
--   NULL / 'pending' — ще не пробували генерувати
--   'done'           — успіх, текст у ai_description
--   'failed'         — спроба була, OpenAI повернув помилку (див. ai_description_error)
-- Оголошення створюється на TM незалежно від статусу опису (опис опціональний).
ALTER TABLE public.olivs
  ADD COLUMN IF NOT EXISTS ai_description text,
  ADD COLUMN IF NOT EXISTS ai_description_at timestamp without time zone,
  ADD COLUMN IF NOT EXISTS ai_description_status text,
  ADD COLUMN IF NOT EXISTS ai_description_error text;

CREATE INDEX IF NOT EXISTS olivs_ai_description_status_idx
  ON public.olivs(ai_description_status);
