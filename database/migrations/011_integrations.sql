-- Інтеграції = реєстр джерел, з яких потрапляють оливи в БД.
-- БД — єдине джерело правди: для кожної інтеграції описано, ЗВІДКИ беруться
-- бренд і місто (з парсера фіксовано / з вебу per-product). Парсер читає цей
-- рядок і застосовує правила під час вставки.
--
-- Поки що є тільки EUROLUB: бренд = "EUROLUB" (з парсера, фіксований),
-- місто = з вебу (per-product, зберігається в olivs.city для кожної олії).
-- У майбутньому стандартів буде багато — десь бренд із вебу, десь із парсера.

CREATE TABLE IF NOT EXISTS public.integrations (
    id bigint GENERATED ALWAYS AS IDENTITY,
    code text NOT NULL,                       -- стабільний ключ для парсера, напр. 'EUROLUB'
    name text NOT NULL,                       -- людська назва для UI
    brand_source text NOT NULL DEFAULT 'parser',  -- 'parser' | 'web'
    city_source  text NOT NULL DEFAULT 'web',      -- 'parser' | 'web'
    default_brand text,                       -- фіксований бренд, коли brand_source='parser'
    default_city  text,                       -- фіксоване місто, коли city_source='parser' і місто одне на всю інтеграцію
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (id),
    UNIQUE (code),
    CONSTRAINT integrations_brand_source_chk CHECK (brand_source IN ('parser', 'web')),
    CONSTRAINT integrations_city_source_chk  CHECK (city_source  IN ('parser', 'web'))
);

-- Зерно: EUROLUB. Бренд фіксований з парсера, місто — з вебу (per-product).
INSERT INTO public.integrations (code, name, brand_source, city_source, default_brand)
VALUES ('EUROLUB', 'EUROLUB', 'parser', 'web', 'EUROLUB')
ON CONFLICT (code) DO NOTHING;

-- Прив'язка олії до інтеграції + поля, що тепер живуть на рівні рядка олії.
-- city — per-product (одна інтеграція може мати кілька міст), brand — теж per-row,
-- бо джерело бренду залежить від інтеграції.
ALTER TABLE public.olivs
  ADD COLUMN IF NOT EXISTS integration_id bigint REFERENCES public.integrations(id),
  ADD COLUMN IF NOT EXISTS brand text,
  ADD COLUMN IF NOT EXISTS city  text;

CREATE INDEX IF NOT EXISTS olivs_integration_id_idx ON public.olivs(integration_id);

-- Backfill існуючих рядків: усе, що вже є — з EUROLUB.
UPDATE public.olivs o
   SET integration_id = i.id,
       brand = COALESCE(o.brand, i.default_brand)
  FROM public.integrations i
 WHERE i.code = 'EUROLUB'
   AND o.integration_id IS NULL;
