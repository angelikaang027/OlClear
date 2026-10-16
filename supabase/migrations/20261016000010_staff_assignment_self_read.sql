-- Auth bootstrap needs each active staff member's own assignment to route to
-- the correct office queue. Keep assignment changes administrator-only.
DROP POLICY IF EXISTS staff_office_assignments_self_read ON public.staff_office_assignments;
CREATE POLICY staff_office_assignments_self_read ON public.staff_office_assignments
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    AND public.is_active_staff_for_office(office_id)
  );

GRANT SELECT ON public.staff_office_assignments TO authenticated;
NOTIFY pgrst, 'reload schema';
