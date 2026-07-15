-- Розділяємо ІДЕНТИЧНІСТЬ фото і його МІСЦЕ в сховищі.
--
-- Було: дедуп по UNIQUE(oils_id, file_path). Але file_path — це storage-ключ
-- (шлях у сховищі). Через це дедуп був зав'язаний на структуру сховища: та сама
-- фотка з іншої/переназваної папки давала інший file_path → дедуп не спрацьовував
-- → дублі. І будь-яка майбутня міграція структури сховища ламала б дедуп.
--
-- Стало: дедуп по source_name — стабільній ІДЕНТИЧНОСТІ (ім'я файлу = артикул).
-- file_path лишається суто АДРЕСОЮ (де лежить), без унікальності — тож структуру
-- сховища можна вільно міняти, не чіпаючи дедуп. Одне фото може належати кільком
-- оливам (мульти-матч) → file_path законно повторюється по різних oils_id.
--
-- Ідемпотентна: кожен крок безпечно виконати повторно (make migrate ганяє все).

-- 1. Нова колонка ідентичності.
ALTER TABLE public.oils_images ADD COLUMN IF NOT EXISTS source_name text;

-- 2. Заповнити для наявних рядків: ім'я файлу = все після останнього '/'.
UPDATE public.oils_images
   SET source_name = regexp_replace(file_path, '^.*/', '')
 WHERE source_name IS NULL;

-- 3. Прибрати можливі наявні дублі (лишити найстаріший рядок на кожну пару),
--    інакше новий UNIQUE не додасться. На порожній базі — no-op.
DELETE FROM public.oils_images a
 USING public.oils_images b
 WHERE a.oils_id = b.oils_id
   AND a.source_name = b.source_name
   AND a.id > b.id;

-- 4. source_name обов'язковий (UNIQUE не розрізняє NULL-и).
ALTER TABLE public.oils_images ALTER COLUMN source_name SET NOT NULL;

-- 5. Перенести унікальність зі ШЛЯХУ на ІДЕНТИЧНІСТЬ.
ALTER TABLE public.oils_images DROP CONSTRAINT IF EXISTS oils_images_oils_id_file_path_key;
ALTER TABLE public.oils_images DROP CONSTRAINT IF EXISTS oils_images_oils_id_source_name_key;
ALTER TABLE public.oils_images ADD CONSTRAINT oils_images_oils_id_source_name_key UNIQUE (oils_id, source_name);
