-- Таблиці для веб-частини: користувачі та фонові задачі.

CREATE TABLE IF NOT EXISTS public.web_users (
    id bigint GENERATED ALWAYS AS IDENTITY,
    username text NOT NULL,
    password_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (id),
    UNIQUE (username)
);

-- web_jobs: будь-яка фонова робота (parse, photos-import, photos-process,
-- integrations-run). log — конкатенація рядків з \n.
CREATE TABLE IF NOT EXISTS public.web_jobs (
    id bigint GENERATED ALWAYS AS IDENTITY,
    kind text NOT NULL,                  -- parse | photos-import | photos-process | integrations-run
    status text NOT NULL DEFAULT 'pending', -- pending | running | done | failed
    params jsonb NOT NULL DEFAULT '{}'::jsonb,
    log text NOT NULL DEFAULT '',
    error text,
    started_at timestamp without time zone,
    finished_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by bigint,
    PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS web_jobs_status_idx ON public.web_jobs(status);
CREATE INDEX IF NOT EXISTS web_jobs_created_at_idx ON public.web_jobs(created_at DESC);
