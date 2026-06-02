-- Базові інтеграції — джерела, з яких потрапляють оливи в БД.
-- Ідемпотентно (ON CONFLICT DO NOTHING) — можна запускати багато разів.
-- Запуск: make seed-integrations  (або npm run seed:integrations)
--
-- EUROLUB — бренд фіксований 'EUROLUB' (з парсера), місто з вебу.
-- Manager — бренд із колонки файлу (parser, без фіксованого), місто = Луцьк.

INSERT INTO public.integrations (code, name, brand_source, city_source, default_brand, default_city)
VALUES
  ('EUROLUB',            'EUROLUB', 'parser', 'web',    'EUROLUB', NULL),
  ('ManagerIntegration', 'Manager', 'parser', 'parser', NULL,      'Луцьк')
ON CONFLICT (code) DO NOTHING;
