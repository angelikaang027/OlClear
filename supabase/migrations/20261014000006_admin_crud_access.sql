-- Admin-only CRUD policies for the tables used by the Admin Portal.
-- Authenticated users are NOT granted blanket access to public tables.

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

-- Remove the insecure blanket policy if it was previously created by hand.
-- Other student/staff policies remain intact.
DO $$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname = 'Allow Admin Full Access'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
      policy_row.policyname, policy_row.schemaname, policy_row.tablename);
  END LOOP;
END
$$;

-- These data tables use the same verified-admin predicate. Auth user records
-- are created, edited, suspended, and deleted only through the protected
-- admin-manage-user Edge Function, which uses the service role on the server.
DO $$
DECLARE
  table_name text;
  admin_tables text[] := ARRAY[
    'clearance_periods',
    'clearance_requests',
    'clearance_items',
    'academic_departments',
    'programs',
    'offices',
    'staff_office_assignments'
  ];
BEGIN
  FOREACH table_name IN ARRAY admin_tables LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
      EXECUTE format('DROP POLICY IF EXISTS admin_manage_all ON public.%I', table_name);
      EXECUTE format(
        'CREATE POLICY admin_manage_all ON public.%I FOR ALL TO authenticated USING (public.is_clearance_admin()) WITH CHECK (public.is_clearance_admin())',
        table_name
      );
    END IF;
  END LOOP;
END
$$;

-- Admin account listing uses the Edge Function; direct profile writes are
-- intentionally not granted so Auth and public.users cannot drift apart.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_admin_read ON public.users;
CREATE POLICY users_admin_read ON public.users
  FOR SELECT TO authenticated USING (public.is_clearance_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.clearance_periods,
  public.clearance_requests,
  public.clearance_items,
  public.academic_departments,
  public.programs,
  public.offices,
  public.staff_office_assignments
TO authenticated;
GRANT SELECT ON TABLE public.users TO authenticated;

-- Open a period and initialize all student requests atomically. The portal
-- calls this RPC so a partial failure cannot leave an active period with no
-- student request rows.
CREATE OR REPLACE FUNCTION public.admin_open_clearance_period(
  p_title text,
  p_academic_year text,
  p_semester text,
  p_start_date date,
  p_end_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  new_period public.clearance_periods%ROWTYPE;
  created_requests integer := 0;
BEGIN
  IF NOT public.is_clearance_admin() THEN
    RAISE EXCEPTION 'Administrator access is required.' USING ERRCODE = '42501';
  END IF;
  IF nullif(trim(p_title), '') IS NULL OR nullif(trim(p_academic_year), '') IS NULL THEN
    RAISE EXCEPTION 'Period title and academic year are required.' USING ERRCODE = '22023';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
    RAISE EXCEPTION 'Enter a valid start date and an end date on or after it.' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(742031);
  UPDATE public.clearance_periods SET is_active = false WHERE is_active = true;
  INSERT INTO public.clearance_periods (title, academic_year, semester, is_active, start_date, end_date)
  VALUES (trim(p_title), trim(p_academic_year), p_semester, true, p_start_date, p_end_date)
  RETURNING * INTO new_period;

  INSERT INTO public.clearance_requests (student_id, clearance_period_id)
  SELECT id, new_period.id FROM public.users WHERE upper(role::text) = 'STUDENT';
  GET DIAGNOSTICS created_requests = ROW_COUNT;

  RETURN jsonb_build_object(
    'period', to_jsonb(new_period),
    'request_count', created_requests
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_clearance_period_state(
  p_period_id uuid,
  p_action text
)
RETURNS public.clearance_periods
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  changed_period public.clearance_periods%ROWTYPE;
BEGIN
  IF NOT public.is_clearance_admin() THEN
    RAISE EXCEPTION 'Administrator access is required.' USING ERRCODE = '42501';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('close', 'reopen', 'archive') THEN
    RAISE EXCEPTION 'Unsupported clearance period action.' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(742031);
  IF p_action = 'reopen' THEN
    UPDATE public.clearance_periods SET is_active = false WHERE is_active = true;
    UPDATE public.clearance_periods
      SET is_active = true, archived_at = NULL
      WHERE id = p_period_id
      RETURNING * INTO changed_period;
  ELSIF p_action = 'archive' THEN
    UPDATE public.clearance_periods
      SET is_active = false, archived_at = now()
      WHERE id = p_period_id
      RETURNING * INTO changed_period;
  ELSE
    UPDATE public.clearance_periods
      SET is_active = false
      WHERE id = p_period_id
      RETURNING * INTO changed_period;
  END IF;

  IF changed_period.id IS NULL THEN
    RAISE EXCEPTION 'Clearance period was not found.' USING ERRCODE = 'P0002';
  END IF;
  RETURN changed_period;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_open_clearance_period(text, text, text, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_clearance_period_state(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_open_clearance_period(text, text, text, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_clearance_period_state(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
