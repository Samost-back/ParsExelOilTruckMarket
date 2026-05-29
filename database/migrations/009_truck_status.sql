-- Статус публікації оливо на TruckMarket.
-- NULL / 'pending'  — не пробували
-- 'in_progress'     — зараз публікується
-- 'done'            — успіх (truck_listing_id заповнений)
-- 'failed'          — помилка (текст у truck_error)
ALTER TABLE public.olivs
  ADD COLUMN IF NOT EXISTS truck_status text,
  ADD COLUMN IF NOT EXISTS truck_error  text,
  ADD COLUMN IF NOT EXISTS truck_at     timestamp without time zone;

CREATE INDEX IF NOT EXISTS olivs_truck_status_idx ON public.olivs(truck_status);

-- Backfill: для рядків з listing_id ставимо 'done'.
UPDATE public.olivs SET truck_status = 'done'
  WHERE truck_listing_id IS NOT NULL AND truck_status IS NULL;
