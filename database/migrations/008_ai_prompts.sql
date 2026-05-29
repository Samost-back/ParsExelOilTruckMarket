-- AI-промпти для генерації SEO-описів. Один з них помічений is_default=true
-- і використовується при публікації. Решта — заготовки/чернетки.
CREATE TABLE IF NOT EXISTS public.ai_prompts (
    id bigint GENERATED ALWAYS AS IDENTITY,
    name text NOT NULL,
    body text NOT NULL,
    is_default boolean NOT NULL DEFAULT false,
    created_at timestamp without time zone NOT NULL DEFAULT NOW(),
    updated_at timestamp without time zone NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id),
    UNIQUE (name)
);

-- Лише один промпт може бути дефолтним.
CREATE UNIQUE INDEX IF NOT EXISTS ai_prompts_one_default
  ON public.ai_prompts ((true)) WHERE is_default;
