-- Manager: місто фіксоване = Луцьк.
-- Переводимо інтеграцію на city_source='parser' з default_city='Луцьк',
-- щоб усі майбутні Manager-оливи отримували Луцьк, і backfill наявних.

UPDATE public.integrations
   SET default_city = 'Луцьк',
       city_source  = 'parser'
 WHERE code = 'ManagerIntegration';

-- Backfill наявних олив цієї інтеграції.
UPDATE public.olivs o
   SET city = 'Луцьк'
  FROM public.integrations i
 WHERE i.code = 'ManagerIntegration'
   AND o.integration_id = i.id
   AND (o.city IS NULL OR o.city = '');
