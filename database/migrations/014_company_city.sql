-- Місто компанії — джерело локації оголошення на TruckMarket.
-- Локація завжди береться з компанії (одна компанія = одне місто).
-- Текст; при публікації резолвиться у TM geo_city id через geo/regions/list.

ALTER TABLE public.company_olivs
  ADD COLUMN IF NOT EXISTS city text;
