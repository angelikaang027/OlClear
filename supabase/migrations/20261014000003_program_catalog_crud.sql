-- Ensure the academic program catalog has the fields used by the admin form.
CREATE OR REPLACE FUNCTION public.is_clearance_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND upper(role::text) = 'ADMIN'
  );
$$;
REVOKE ALL ON FUNCTION public.is_clearance_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_clearance_admin() TO authenticated;

CREATE TABLE IF NOT EXISTS public.programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(30) NOT NULL,
  name varchar(200) NOT NULL,
  academic_level varchar(30) NOT NULL DEFAULT 'UNDERGRADUATE',
  department_id uuid NOT NULL REFERENCES public.academic_departments(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.programs
  ADD COLUMN IF NOT EXISTS code varchar(30),
  ADD COLUMN IF NOT EXISTS name varchar(200),
  ADD COLUMN IF NOT EXISTS academic_level varchar(30) DEFAULT 'UNDERGRADUATE',
  ADD COLUMN IF NOT EXISTS department_id uuid,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'programs_department_id_fkey'
      AND conrelid = 'public.programs'::regclass
  ) THEN
    ALTER TABLE public.programs
      ADD CONSTRAINT programs_department_id_fkey
      FOREIGN KEY (department_id)
      REFERENCES public.academic_departments(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

ALTER TABLE public.programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_departments ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.programs TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.programs TO authenticated;
GRANT SELECT ON public.academic_departments TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.academic_departments TO authenticated;

-- The academic catalog is public reference data; only admins may mutate it.
DROP POLICY IF EXISTS academic_departments_catalog_read ON public.academic_departments;
CREATE POLICY academic_departments_catalog_read ON public.academic_departments
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS academic_departments_admin_insert ON public.academic_departments;
CREATE POLICY academic_departments_admin_insert ON public.academic_departments
  FOR INSERT TO authenticated WITH CHECK (public.is_clearance_admin());
DROP POLICY IF EXISTS academic_departments_admin_update ON public.academic_departments;
CREATE POLICY academic_departments_admin_update ON public.academic_departments
  FOR UPDATE TO authenticated USING (public.is_clearance_admin()) WITH CHECK (public.is_clearance_admin());
DROP POLICY IF EXISTS academic_departments_admin_delete ON public.academic_departments;
CREATE POLICY academic_departments_admin_delete ON public.academic_departments
  FOR DELETE TO authenticated USING (public.is_clearance_admin());

DROP POLICY IF EXISTS programs_catalog_read ON public.programs;
CREATE POLICY programs_catalog_read ON public.programs
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS programs_admin_insert ON public.programs;
CREATE POLICY programs_admin_insert ON public.programs
  FOR INSERT TO authenticated WITH CHECK (public.is_clearance_admin());
DROP POLICY IF EXISTS programs_admin_update ON public.programs;
CREATE POLICY programs_admin_update ON public.programs
  FOR UPDATE TO authenticated USING (public.is_clearance_admin()) WITH CHECK (public.is_clearance_admin());
DROP POLICY IF EXISTS programs_admin_delete ON public.programs;
CREATE POLICY programs_admin_delete ON public.programs
  FOR DELETE TO authenticated USING (public.is_clearance_admin());

CREATE INDEX IF NOT EXISTS programs_department_id_idx ON public.programs(department_id);
NOTIFY pgrst, 'reload schema';
