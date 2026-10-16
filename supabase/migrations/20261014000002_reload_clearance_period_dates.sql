ALTER TABLE public.clearance_periods
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS end_date date;

NOTIFY pgrst, 'reload schema';
