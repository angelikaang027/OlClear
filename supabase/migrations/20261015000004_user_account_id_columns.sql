-- Profile identifiers edited from the Admin user-management screen.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS employee_id_number TEXT,
  ADD COLUMN IF NOT EXISTS student_id_number TEXT;

-- Permit profile fallback updates only for callers recognized as admins.
-- The admin-manage-user Edge Function remains required for Auth email/password edits.
DROP POLICY IF EXISTS users_admin_update ON public.users;
CREATE POLICY users_admin_update ON public.users
  FOR UPDATE TO authenticated
  USING (public.is_clearance_admin())
  WITH CHECK (public.is_clearance_admin());

GRANT UPDATE (full_name, role, employee_id_number, student_id_number)
  ON public.users TO authenticated;

NOTIFY pgrst, 'reload schema';
