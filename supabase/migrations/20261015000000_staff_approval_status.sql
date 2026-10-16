-- The staff approval trigger below depends on this helper. Define it here as
-- well as in the admin-policy migrations so this migration can run by itself.
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

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ACTIVE';

UPDATE public.users
SET status = 'ACTIVE'
WHERE status IS NULL;

ALTER TABLE public.users
ALTER COLUMN status SET DEFAULT 'ACTIVE',
ALTER COLUMN status SET NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_staff_approval_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF UPPER(COALESCE(NEW.role::text, '')) = 'STAFF'
      AND COALESCE(auth.role(), '') <> 'service_role'
      AND NOT public.is_clearance_admin()
    THEN
      NEW.status := 'PENDING_APPROVAL';
    END IF;
  ELSIF (NEW.status IS DISTINCT FROM OLD.status OR NEW.role IS DISTINCT FROM OLD.role)
    AND COALESCE(auth.role(), '') <> 'service_role'
    AND NOT public.is_clearance_admin()
  THEN
    RAISE EXCEPTION 'Only an administrator can change account role or status.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_staff_approval_status ON public.users;
CREATE TRIGGER enforce_staff_approval_status
BEFORE INSERT OR UPDATE OF status, role ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.enforce_staff_approval_status();
REVOKE ALL ON FUNCTION public.enforce_staff_approval_status() FROM PUBLIC;

NOTIFY pgrst, 'reload schema';
