ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS requested_office_id UUID
    REFERENCES public.offices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS requested_department_id UUID
    REFERENCES public.academic_departments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS users_requested_office_id_idx
  ON public.users(requested_office_id)
  WHERE requested_office_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
