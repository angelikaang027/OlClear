-- Staff registration resolves the requested office before an Auth session
-- exists. Expose only the non-sensitive office catalog fields to anon users.
REVOKE SELECT ON public.offices FROM PUBLIC, anon;
GRANT SELECT (id, code, name) ON public.offices TO anon;

DROP POLICY IF EXISTS offices_public_signup_catalog_read ON public.offices;
CREATE POLICY offices_public_signup_catalog_read
  ON public.offices
  FOR SELECT TO anon
  USING (TRUE);

NOTIFY pgrst, 'reload schema';
