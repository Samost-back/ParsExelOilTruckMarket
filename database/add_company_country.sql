-- Країна компанії — використовується PhotoTruckMarket-обробкою фото
-- (текст накладається на шаблон бочки). NULL = використати дефолт ("Німеччина").

ALTER TABLE public.company_olivs
  ADD COLUMN IF NOT EXISTS country text;
