-- PID дочірнього процесу job-а (для cancel після рестарту контейнера).
ALTER TABLE public.web_jobs
  ADD COLUMN IF NOT EXISTS pid integer;
