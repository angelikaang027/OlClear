-- Run once in the Supabase SQL Editor after applying the OLClear migrations.
-- Replace the email below with the exact, already-verified account that will
-- administer this project. The script refuses to promote an unverified Auth
-- user, an account without its profile row, or a project that already has an
-- active administrator.
DO $$
DECLARE
  administrator_email TEXT := lower(trim('REPLACE_WITH_VERIFIED_ADMIN_EMAIL'));
  administrator_id UUID;
  updated_user_id UUID;
BEGIN
  IF administrator_email = 'replace_with_verified_admin_email'
    OR administrator_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Set administrator_email to the intended verified account email before running this script.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.users
    WHERE upper(role::TEXT) = 'ADMIN'
      AND upper(COALESCE(status::TEXT, 'ACTIVE')) = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'An active administrator already exists; use User Management to create additional administrators.';
  END IF;

  SELECT id INTO administrator_id
  FROM auth.users
  WHERE lower(email) = administrator_email
    AND email_confirmed_at IS NOT NULL;

  IF administrator_id IS NULL THEN
    RAISE EXCEPTION 'No email-verified Auth user matches the supplied address. Register and verify the account first.';
  END IF;

  -- This owner-run SQL Editor action must pass the same profile trigger guard
  -- as other trusted provisioning. Keep the service-role claim transaction local.
  PERFORM set_config('request.jwt.claim.role', 'service_role', TRUE);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);

  UPDATE public.users
  SET role = 'ADMIN', status = 'ACTIVE'
  WHERE id = administrator_id
  RETURNING id INTO updated_user_id;

  IF updated_user_id IS NULL THEN
    RAISE EXCEPTION 'The verified Auth account has no OLClear profile. Check that the Auth profile trigger migration is installed.';
  END IF;
END;
$$;
