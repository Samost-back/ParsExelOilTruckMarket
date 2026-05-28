-- Окрема таблиця для фото оливо. Файли зберігаються на диску,
-- у БД лише шлях. Кілька фото на один olivs — впорядковані через sort_order
-- (0 = головне). UNIQUE(oils_id, file_path) запобігає дублям.

CREATE TABLE IF NOT EXISTS public.oils_images (
    id bigint GENERATED ALWAYS AS IDENTITY,
    oils_id bigint NOT NULL,
    file_path text NOT NULL,
    sort_order integer NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE (oils_id, file_path),
    CONSTRAINT oils_images_oils_id_fkey
        FOREIGN KEY (oils_id)
        REFERENCES public.olivs(id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS oils_images_oils_id_idx ON public.oils_images(oils_id);
