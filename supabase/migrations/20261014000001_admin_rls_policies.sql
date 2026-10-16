CREATE OR REPLACE FUNCTION public.is_clearance_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = auth.uid()
      AND upper(role::text) = 'ADMIN'
  );
$$;

REVOKE ALL ON FUNCTION public.is_clearance_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_clearance_admin() TO authenticated;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clearance_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clearance_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clearance_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_office_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_admin_read ON public.users;
CREATE POLICY users_admin_read ON public.users
  FOR SELECT TO authenticated
  USING (public.is_clearance_admin());

DROP POLICY IF EXISTS clearance_periods_admin_read ON public.clearance_periods;
CREATE POLICY clearance_periods_admin_read ON public.clearance_periods
  FOR SELECT TO authenticated USING (public.is_clearance_admin());
DROP POLICY IF EXISTS clearance_periods_admin_insert ON public.clearance_periods;
CREATE POLICY clearance_periods_admin_insert ON public.clearance_periods
  FOR INSERT TO authenticated WITH CHECK (public.is_clearance_admin());
DROP POLICY IF EXISTS clearance_periods_admin_update ON public.clearance_periods;
CREATE POLICY clearance_periods_admin_update ON public.clearance_periods
  FOR UPDATE TO authenticated USING (public.is_clearance_admin()) WITH CHECK (public.is_clearance_admin());

DROP POLICY IF EXISTS clearance_requests_admin_read ON public.clearance_requests;
CREATE POLICY clearance_requests_admin_read ON public.clearance_requests
  FOR SELECT TO authenticated USING (public.is_clearance_admin());
DROP POLICY IF EXISTS clearance_requests_admin_insert ON public.clearance_requests;
CREATE POLICY clearance_requests_admin_insert ON public.clearance_requests
  FOR INSERT TO authenticated WITH CHECK (public.is_clearance_admin());
DROP POLICY IF EXISTS clearance_requests_admin_delete ON public.clearance_requests;
CREATE POLICY clearance_requests_admin_delete ON public.clearance_requests
  FOR DELETE TO authenticated USING (public.is_clearance_admin());

DROP POLICY IF EXISTS clearance_items_admin_read ON public.clearance_items;
CREATE POLICY clearance_items_admin_read ON public.clearance_items
  FOR SELECT TO authenticated USING (public.is_clearance_admin());
DROP POLICY IF EXISTS clearance_items_admin_update ON public.clearance_items;
CREATE POLICY clearance_items_admin_update ON public.clearance_items
  FOR UPDATE TO authenticated USING (public.is_clearance_admin()) WITH CHECK (public.is_clearance_admin());

DROP POLICY IF EXISTS academic_departments_admin_read ON public.academic_departments;
CREATE POLICY academic_departments_admin_read ON public.academic_departments
  FOR SELECT TO authenticated USING (public.is_clearance_admin());
DROP POLICY IF EXISTS academic_departments_admin_insert ON public.academic_departments;
CREATE POLICY academic_departments_admin_insert ON public.academic_departments
  FOR INSERT TO authenticated WITH CHECK (public.is_clearance_admin());
DROP POLICY IF EXISTS academic_departments_admin_update ON public.academic_departments;
CREATE POLICY academic_departments_admin_update ON public.academic_departments
  FOR UPDATE TO authenticated USING (public.is_clearance_admin()) WITH CHECK (public.is_clearance_admin());
DROP POLICY IF EXISTS academic_departments_admin_delete ON public.academic_departments;
CREATE POLICY academic_departments_admin_delete ON public.academic_departments
  FOR DELETE TO authenticated USING (public.is_clearance_admin());

DROP POLICY IF EXISTS programs_admin_read ON public.programs;
CREATE POLICY programs_admin_read ON public.programs
  FOR SELECT TO authenticated USING (public.is_clearance_admin());
DROP POLICY IF EXISTS programs_admin_insert ON public.programs;
CREATE POLICY programs_admin_insert ON public.programs
  FOR INSERT TO authenticated WITH CHECK (public.is_clearance_admin());
DROP POLICY IF EXISTS programs_admin_update ON public.programs;
CREATE POLICY programs_admin_update ON public.programs
  FOR UPDATE TO authenticated USING (public.is_clearance_admin()) WITH CHECK (public.is_clearance_admin());
DROP POLICY IF EXISTS programs_admin_delete ON public.programs;
CREATE POLICY programs_admin_delete ON public.programs
  FOR DELETE TO authenticated USING (public.is_clearance_admin());

DROP POLICY IF EXISTS offices_admin_read ON public.offices;
CREATE POLICY offices_admin_read ON public.offices
  FOR SELECT TO authenticated USING (public.is_clearance_admin());

DROP POLICY IF EXISTS staff_office_assignments_admin_read ON public.staff_office_assignments;
CREATE POLICY staff_office_assignments_admin_read ON public.staff_office_assignments
  FOR SELECT TO authenticated USING (public.is_clearance_admin());
DROP POLICY IF EXISTS staff_office_assignments_admin_insert ON public.staff_office_assignments;
CREATE POLICY staff_office_assignments_admin_insert ON public.staff_office_assignments
  FOR INSERT TO authenticated WITH CHECK (public.is_clearance_admin());
DROP POLICY IF EXISTS staff_office_assignments_admin_delete ON public.staff_office_assignments;
CREATE POLICY staff_office_assignments_admin_delete ON public.staff_office_assignments
  FOR DELETE TO authenticated USING (public.is_clearance_admin());
