-- Очищення робочих даних, БЕЗ налаштувань.
-- Стирає: оливи, фото, історію цін, компанії, фонові задачі.
-- ЗАЛИШАЄ: web_users (вхід), integrations (EUROLUB/Manager), ai_prompts (промпти).
--
-- Порядок важливий через FK:
--   oils_price → olivs (NO ACTION) — видаляємо першими
--   oils_images → olivs (CASCADE)  — підуть самі, але видаляємо явно
--   olivs → company_olivs / integrations
-- Усе в одній транзакції: або все, або нічого.
--
-- Запуск: node database/run-sql.js database/seeds/wipe_data.sql
--   або:  make wipe-data

BEGIN;

DELETE FROM public.oils_price;
DELETE FROM public.oils_images;
DELETE FROM public.olivs;
DELETE FROM public.company_olivs;
DELETE FROM public.web_jobs;

COMMIT;
