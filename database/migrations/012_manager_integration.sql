-- Друга інтеграція: ManagerIntegration — прайс «Мастила» (аркуш Daf).
-- Формат принципово інший за EUROLUB: колонкові заголовки, бренд в окремій
-- колонці (DAF/Mobil/...), секції типів олив, кілька варіантів об'єму на товар.
--
-- Правила джерела:
--   brand_source = 'parser' — бренд із колонки «Бренд» кожного товару
--     (default_brand тут НЕ застосовується як фіксований — парсер бере значення
--      з файлу; default_brand лишаємо порожнім).
--   city_source  = 'web'    — міста у файлі поки немає, зʼявиться згодом;
--     парсер лишає city = NULL.

INSERT INTO public.integrations (code, name, brand_source, city_source, default_brand)
VALUES ('ManagerIntegration', 'Manager', 'parser', 'web', NULL)
ON CONFLICT (code) DO NOTHING;
