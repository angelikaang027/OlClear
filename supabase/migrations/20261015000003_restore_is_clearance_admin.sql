-- Idempotent repair for databases where an earlier migration or manual SQL
-- run created a policy/trigger without leaving the helper function present.
CREATE OR REPLACE FUNCTION public.is_clearance_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = auth.uid()
      AND UPPER(role::text) = 'ADMIN'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.is_clearance_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_clearance_admin() TO authenticated;

NOTIFY pgrst, 'reload schema';
