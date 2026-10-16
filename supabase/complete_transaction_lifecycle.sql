ALTER TABLE public.clearance_periods
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS end_date date,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;


-- ===== Next ordered lifecycle migration =====

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


-- ===== Next ordered lifecycle migration =====

ALTER TABLE public.clearance_periods
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS end_date date;

NOTIFY pgrst, 'reload schema';

-- Keep the standalone schema setup aligned with the latest migrations.
-- Public Auth metadata cannot provision administrator accounts.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  metadata_role TEXT := COALESCE(UPPER(NULLIF(BTRIM(NEW.raw_user_meta_data ->> 'role'), '')), 'STUDENT');
  metadata_academic_level TEXT;
  profile_role public.user_role_enum;
  profile_academic_level public.users.academic_level%TYPE;
BEGIN
  IF metadata_role NOT IN ('STUDENT', 'STAFF') THEN
    metadata_role := 'STUDENT';
  END IF;
  profile_role := metadata_role::public.user_role_enum;
  metadata_academic_level := UPPER(NULLIF(BTRIM(NEW.raw_user_meta_data ->> 'academic_level'), ''));
  IF metadata_academic_level IS NULL
    OR metadata_academic_level NOT IN ('HIGH_SCHOOL', 'UNDERGRADUATE', 'POSTGRADUATE') THEN
    metadata_academic_level := 'UNDERGRADUATE';
  END IF;
  profile_academic_level := metadata_academic_level;

  INSERT INTO public.users (
    id, email, full_name, role, student_id_number, employee_id_number,
    department_id, program_id, academic_level, year_level, is_graduating,
    status, requested_office_id, requested_department_id
  ) VALUES (
    NEW.id,
    LOWER(NEW.email),
    COALESCE(NULLIF(BTRIM(NEW.raw_user_meta_data ->> 'full_name'), ''), ''),
    profile_role,
    NULLIF(BTRIM(NEW.raw_user_meta_data ->> 'student_id_number'), ''),
    NULLIF(BTRIM(NEW.raw_user_meta_data ->> 'employee_id_number'), ''),
    NULLIF(NEW.raw_user_meta_data ->> 'department_id', '')::UUID,
    NULLIF(NEW.raw_user_meta_data ->> 'program_id', '')::UUID,
    profile_academic_level,
    NULLIF(BTRIM(NEW.raw_user_meta_data ->> 'year_level'), ''),
    COALESCE((NEW.raw_user_meta_data ->> 'is_graduating')::BOOLEAN, FALSE),
    CASE WHEN profile_role::TEXT = 'STAFF' THEN 'PENDING_APPROVAL' ELSE 'ACTIVE' END,
    NULLIF(NEW.raw_user_meta_data ->> 'requested_office_id', '')::UUID,
    NULLIF(NEW.raw_user_meta_data ->> 'requested_department_id', '')::UUID
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_new_auth_user_profile() FROM PUBLIC;
DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_profile
  AFTER INSERT ON auth.users FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_auth_user_profile();

CREATE OR REPLACE FUNCTION public.is_clearance_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
      AND UPPER(u.role::text) = 'ADMIN'
      AND UPPER(COALESCE(u.status::text, 'ACTIVE')) = 'ACTIVE'
      AND NOT EXISTS (
        SELECT 1 FROM auth.users au
        WHERE au.id = auth.uid() AND au.banned_until > NOW()
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_staff_for_office(p_office_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.staff_office_assignments a ON a.user_id = u.id
    WHERE u.id = auth.uid()
      AND UPPER(u.role::text) = 'STAFF'
      AND UPPER(COALESCE(u.status::text, '')) = 'ACTIVE'
      AND a.office_id = p_office_id
      AND NOT EXISTS (
        SELECT 1 FROM auth.users au
        WHERE au.id = auth.uid() AND au.banned_until > NOW()
      )
  );
$$;
REVOKE ALL ON FUNCTION public.is_clearance_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_active_staff_for_office(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_clearance_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_staff_for_office(UUID) TO authenticated;

UPDATE storage.buckets
SET public = FALSE,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[]
WHERE id = 'clearance_proofs';

NOTIFY pgrst, 'reload schema';




-- ===== Next ordered lifecycle migration =====

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


-- ===== Next ordered lifecycle migration =====

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'clearance_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.clearance_items;
  END IF;
END $$;


-- ===== Next ordered lifecycle migration =====

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'clearance_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.clearance_requests;
  END IF;
END $$;


-- ===== Next ordered lifecycle migration =====

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


-- ===== Next ordered lifecycle migration =====

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


-- ===== Next ordered lifecycle migration =====

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS requested_office_id UUID
    REFERENCES public.offices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS requested_department_id UUID
    REFERENCES public.academic_departments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS users_requested_office_id_idx
  ON public.users(requested_office_id)
  WHERE requested_office_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';


-- ===== Next ordered lifecycle migration =====

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


-- ===== Next ordered lifecycle migration =====

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


-- ===== Next ordered lifecycle migration =====

-- Accounting staff may review and process only their assigned office queue.
-- Accounting remains the gateway: other offices can be processed only after
-- the Accounting item for the same clearance request is approved.

ALTER TABLE public.clearance_items
  ADD COLUMN IF NOT EXISTS clearance_request_id UUID;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'clearance_items' AND column_name = 'request_id'
  ) THEN
    EXECUTE 'UPDATE public.clearance_items SET clearance_request_id = request_id WHERE clearance_request_id IS NULL';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.clearance_proofs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clearance_item_id UUID REFERENCES public.clearance_items(id) ON DELETE CASCADE,
  student_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  storage_path TEXT,
  file_url TEXT,
  file_name TEXT,
  mime_type TEXT,
  file_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.clearance_proofs
  ADD COLUMN IF NOT EXISTS clearance_item_id UUID,
  ADD COLUMN IF NOT EXISTS student_id UUID REFERENCES public.users(id) ON DELETE CASCADE;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'clearance_proofs' AND column_name = 'item_id'
  ) THEN
    EXECUTE 'UPDATE public.clearance_proofs SET clearance_item_id = item_id WHERE clearance_item_id IS NULL';
  END IF;
END;
$$;

ALTER TABLE public.clearance_items
  ADD COLUMN IF NOT EXISTS balance_amount NUMERIC(10,2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS official_receipt_number TEXT,
  ADD COLUMN IF NOT EXISTS processed_by UUID REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_office_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clearance_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clearance_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clearance_items ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_active_staff_for_office(p_office_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.staff_office_assignments a ON a.user_id = u.id
    WHERE u.id = auth.uid()
      AND UPPER(COALESCE(u.role::text, '')) = 'STAFF'
      AND UPPER(COALESCE(u.status::text, '')) = 'ACTIVE'
      AND a.office_id = p_office_id
  );
$$;

CREATE OR REPLACE FUNCTION public.staff_can_access_clearance_item(p_item_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.clearance_items ci
    WHERE ci.id = p_item_id
      AND public.is_active_staff_for_office(ci.office_id)
      AND (
        EXISTS (
          SELECT 1 FROM public.offices o
          WHERE o.id = ci.office_id AND UPPER(o.code::text) = 'ACCOUNTING'
        )
        OR EXISTS (
          SELECT 1
          FROM public.clearance_items accounting_item
          JOIN public.offices accounting_office ON accounting_office.id = accounting_item.office_id
          WHERE accounting_item.clearance_request_id = ci.clearance_request_id
            AND UPPER(accounting_office.code::text) = 'ACCOUNTING'
            AND UPPER(COALESCE(accounting_item.status::text, '')) = 'APPROVED'
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.staff_can_read_accounting_student(p_student_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.clearance_requests cr
    JOIN public.clearance_items ci ON ci.clearance_request_id = cr.id
    JOIN public.offices o ON o.id = ci.office_id
    WHERE cr.student_id = p_student_id
      AND UPPER(o.code::text) = 'ACCOUNTING'
      AND public.is_active_staff_for_office(ci.office_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.accounting_staff_can_read_proof_path(p_object_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN split_part(p_object_name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN EXISTS (
      SELECT 1 FROM public.clearance_items ci
      WHERE ci.id = split_part(p_object_name, '/', 2)::UUID
        AND public.staff_can_access_clearance_item(ci.id)
    )
    ELSE FALSE
  END;
$$;

REVOKE ALL ON FUNCTION public.is_active_staff_for_office(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.staff_can_access_clearance_item(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.staff_can_read_accounting_student(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accounting_staff_can_read_proof_path(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_staff_for_office(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_can_access_clearance_item(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_can_read_accounting_student(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accounting_staff_can_read_proof_path(TEXT) TO authenticated;

-- Staff can read their own account and office assignment for login checks.
DROP POLICY IF EXISTS users_self_read ON public.users;
CREATE POLICY users_self_read ON public.users
  FOR SELECT TO authenticated USING (id = auth.uid());

DROP POLICY IF EXISTS staff_office_assignments_self_read ON public.staff_office_assignments;
CREATE POLICY staff_office_assignments_self_read ON public.staff_office_assignments
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS offices_assigned_staff_read ON public.offices;
CREATE POLICY offices_assigned_staff_read ON public.offices
  FOR SELECT TO authenticated USING (public.is_active_staff_for_office(id));

-- Staff only see their own assigned queue, its student profile, and its proofs.
DROP POLICY IF EXISTS clearance_items_assigned_staff_read ON public.clearance_items;
CREATE POLICY clearance_items_assigned_staff_read ON public.clearance_items
  FOR SELECT TO authenticated USING (public.is_active_staff_for_office(office_id));

DROP POLICY IF EXISTS clearance_items_assigned_staff_update ON public.clearance_items;
CREATE POLICY clearance_items_assigned_staff_update ON public.clearance_items
  FOR UPDATE TO authenticated
  USING (public.staff_can_access_clearance_item(id))
  WITH CHECK (public.staff_can_access_clearance_item(id));

DROP POLICY IF EXISTS clearance_requests_assigned_staff_read ON public.clearance_requests;
CREATE POLICY clearance_requests_assigned_staff_read ON public.clearance_requests
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.clearance_items ci
      WHERE ci.clearance_request_id = id
        AND public.is_active_staff_for_office(ci.office_id)
    )
  );

DROP POLICY IF EXISTS users_accounting_queue_read ON public.users;
CREATE POLICY users_accounting_queue_read ON public.users
  FOR SELECT TO authenticated USING (public.staff_can_read_accounting_student(id));

ALTER TABLE public.clearance_proofs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS clearance_proofs_assigned_staff_read ON public.clearance_proofs;
CREATE POLICY clearance_proofs_assigned_staff_read ON public.clearance_proofs
  FOR SELECT TO authenticated USING (public.staff_can_access_clearance_item(clearance_item_id));
GRANT SELECT ON public.clearance_proofs TO authenticated;
GRANT SELECT, UPDATE ON public.clearance_items TO authenticated;
GRANT SELECT ON public.clearance_requests, public.offices, public.staff_office_assignments TO authenticated;

-- The queue can show active periods to signed-in staff; period management
-- remains governed by the admin-only policies.
DROP POLICY IF EXISTS clearance_periods_authenticated_active_read ON public.clearance_periods;
CREATE POLICY clearance_periods_authenticated_active_read ON public.clearance_periods
  FOR SELECT TO authenticated USING (is_active = TRUE);

-- Student ledgers are optional in installations without the accounting ledger.
DO $$
BEGIN
  IF to_regclass('public.student_ledgers') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.student_ledgers ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.student_ledgers ADD COLUMN IF NOT EXISTS official_receipt_number TEXT';
    EXECUTE 'DROP POLICY IF EXISTS student_ledgers_accounting_staff_read ON public.student_ledgers';
    EXECUTE 'CREATE POLICY student_ledgers_accounting_staff_read ON public.student_ledgers FOR SELECT TO authenticated USING (public.staff_can_read_accounting_student(student_id))';
    EXECUTE 'DROP POLICY IF EXISTS student_ledgers_accounting_staff_update ON public.student_ledgers';
    EXECUTE 'CREATE POLICY student_ledgers_accounting_staff_update ON public.student_ledgers FOR UPDATE TO authenticated USING (public.staff_can_read_accounting_student(student_id)) WITH CHECK (public.staff_can_read_accounting_student(student_id))';
    EXECUTE 'GRANT SELECT, UPDATE ON public.student_ledgers TO authenticated';
  END IF;
END
$$;

-- Private proof files can be opened by staff only when the object path maps
-- to a clearance item they are allowed to review.
DROP POLICY IF EXISTS accounting_staff_read_clearance_proofs ON storage.objects;
CREATE POLICY accounting_staff_read_clearance_proofs ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'clearance_proofs'
    AND public.accounting_staff_can_read_proof_path(name)
  );

NOTIFY pgrst, 'reload schema';


-- ===== Next ordered lifecycle migration =====

-- Storage-backed student receipt schema. storage_path is the canonical private
-- object reference; file_url remains nullable for legacy/public URL records.
ALTER TABLE public.clearance_items
  ADD COLUMN IF NOT EXISTS clearance_request_id UUID;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'clearance_items' AND column_name = 'request_id'
  ) THEN
    EXECUTE 'UPDATE public.clearance_items SET clearance_request_id = request_id WHERE clearance_request_id IS NULL';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.clearance_proofs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clearance_item_id UUID NOT NULL REFERENCES public.clearance_items(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  storage_path TEXT,
  file_url TEXT,
  file_name TEXT,
  mime_type TEXT,
  file_type TEXT,
  amount_paid NUMERIC(10,2),
  reference_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.clearance_proofs
  ADD COLUMN IF NOT EXISTS clearance_item_id UUID,
  ADD COLUMN IF NOT EXISTS student_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS storage_path TEXT,
  ADD COLUMN IF NOT EXISTS file_url TEXT,
  ADD COLUMN IF NOT EXISTS file_name TEXT,
  ADD COLUMN IF NOT EXISTS mime_type TEXT,
  ADD COLUMN IF NOT EXISTS file_type TEXT,
  ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS reference_number TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.clearance_proofs ALTER COLUMN file_url DROP NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'clearance_proofs' AND column_name = 'item_id'
  ) THEN
    EXECUTE 'UPDATE public.clearance_proofs SET clearance_item_id = item_id WHERE clearance_item_id IS NULL';
  END IF;
END;
$$;

-- Private, storage-backed upload destinations and optional ledger tables.
INSERT INTO storage.buckets (id, name, public)
VALUES ('clearance_proofs', 'clearance_proofs', FALSE)
ON CONFLICT (id) DO UPDATE SET public = FALSE;

CREATE TABLE IF NOT EXISTS public.student_ledgers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  tuition_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  lab_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  misc_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  outstanding_balance NUMERIC(10,2) NOT NULL DEFAULT 0,
  required_action TEXT NOT NULL DEFAULT 'SETTLE PAYMENT',
  official_receipt_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.student_ledgers
  ADD COLUMN IF NOT EXISTS tuition_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lab_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS misc_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS outstanding_balance NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS required_action TEXT NOT NULL DEFAULT 'SETTLE PAYMENT',
  ADD COLUMN IF NOT EXISTS official_receipt_number TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS public.student_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PAID',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.student_can_submit_clearance_item(p_item_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.clearance_items ci
    JOIN public.clearance_requests cr ON cr.id = ci.clearance_request_id
    JOIN public.offices o ON o.id = ci.office_id
    WHERE ci.id = p_item_id
      AND cr.student_id = auth.uid()
      AND UPPER(COALESCE(ci.status::text, '')) <> 'APPROVED'
      AND (
        UPPER(o.code::text) = 'ACCOUNTING'
        OR EXISTS (
          SELECT 1
          FROM public.clearance_items accounting_item
          JOIN public.offices accounting_office ON accounting_office.id = accounting_item.office_id
          WHERE accounting_item.clearance_request_id = ci.clearance_request_id
            AND UPPER(accounting_office.code::text) = 'ACCOUNTING'
            AND UPPER(COALESCE(accounting_item.status::text, '')) = 'APPROVED'
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.student_can_upload_clearance_path(p_object_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NOT NULL
      AND split_part(p_object_name, '/', 1) = auth.uid()::TEXT
      AND split_part(p_object_name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN public.student_can_submit_clearance_item(split_part(p_object_name, '/', 2)::UUID)
    ELSE FALSE
  END;
$$;

CREATE OR REPLACE FUNCTION public.guard_student_clearance_item_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL
    OR COALESCE(auth.role(), '') = 'service_role'
    OR public.is_clearance_admin()
    OR NOT EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND UPPER(COALESCE(u.role::text, '')) = 'STUDENT'
    )
  THEN
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - 'status' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'updated_at')
    OR UPPER(COALESCE(NEW.status::text, '')) <> 'SUBMITTED'
    OR NOT public.student_can_submit_clearance_item(OLD.id)
  THEN
    RAISE EXCEPTION 'Students may only submit proof for their own unlocked clearance item.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.student_can_submit_clearance_item(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.student_can_upload_clearance_path(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_student_clearance_item_update() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.student_can_submit_clearance_item(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.student_can_upload_clearance_path(TEXT) TO authenticated;

ALTER TABLE public.clearance_proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_ledgers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_payments ENABLE ROW LEVEL SECURITY;

-- Remove broad policies from older setup snippets so they cannot bypass the
-- owner checks and Accounting gateway below (PostgreSQL policies are ORed).
DROP POLICY IF EXISTS "Allow Student Insert Proofs" ON public.clearance_proofs;
DROP POLICY IF EXISTS "Allow Staff Read Proofs" ON public.clearance_proofs;
DROP POLICY IF EXISTS "Allow Staff Clearance Updates" ON public.clearance_items;

DROP POLICY IF EXISTS users_self_read ON public.users;
CREATE POLICY users_self_read ON public.users
  FOR SELECT TO authenticated USING (id = auth.uid());

DROP POLICY IF EXISTS clearance_requests_student_read_self ON public.clearance_requests;
CREATE POLICY clearance_requests_student_read_self ON public.clearance_requests
  FOR SELECT TO authenticated USING (student_id = auth.uid());

DROP POLICY IF EXISTS clearance_items_student_read_self ON public.clearance_items;
CREATE POLICY clearance_items_student_read_self ON public.clearance_items
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.clearance_requests cr
      WHERE cr.id = clearance_request_id AND cr.student_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS clearance_items_student_submit_unlocked ON public.clearance_items;
CREATE POLICY clearance_items_student_submit_unlocked ON public.clearance_items
  FOR UPDATE TO authenticated
  USING (public.student_can_submit_clearance_item(id))
  WITH CHECK (public.student_can_submit_clearance_item(id));

DROP TRIGGER IF EXISTS guard_student_clearance_item_update ON public.clearance_items;
CREATE TRIGGER guard_student_clearance_item_update
  BEFORE UPDATE ON public.clearance_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_student_clearance_item_update();

DROP POLICY IF EXISTS clearance_proofs_student_read_own ON public.clearance_proofs;
CREATE POLICY clearance_proofs_student_read_own ON public.clearance_proofs
  FOR SELECT TO authenticated USING (student_id = auth.uid());

DROP POLICY IF EXISTS clearance_proofs_student_insert_own_unlocked ON public.clearance_proofs;
CREATE POLICY clearance_proofs_student_insert_own_unlocked ON public.clearance_proofs
  FOR INSERT TO authenticated WITH CHECK (
    student_id = auth.uid()
    AND public.student_can_submit_clearance_item(clearance_item_id)
    AND storage_path LIKE (auth.uid()::TEXT || '/' || clearance_item_id::TEXT || '/%')
  );

DROP POLICY IF EXISTS student_ledgers_student_read_own ON public.student_ledgers;
CREATE POLICY student_ledgers_student_read_own ON public.student_ledgers
  FOR SELECT TO authenticated USING (student_id = auth.uid());

DROP POLICY IF EXISTS student_ledgers_accounting_staff_read ON public.student_ledgers;
CREATE POLICY student_ledgers_accounting_staff_read ON public.student_ledgers
  FOR SELECT TO authenticated USING (public.staff_can_read_accounting_student(student_id));

DROP POLICY IF EXISTS student_ledgers_accounting_staff_update ON public.student_ledgers;
CREATE POLICY student_ledgers_accounting_staff_update ON public.student_ledgers
  FOR UPDATE TO authenticated
  USING (public.staff_can_read_accounting_student(student_id))
  WITH CHECK (public.staff_can_read_accounting_student(student_id));

DROP POLICY IF EXISTS student_payments_student_read_own ON public.student_payments;
CREATE POLICY student_payments_student_read_own ON public.student_payments
  FOR SELECT TO authenticated USING (student_id = auth.uid());

GRANT SELECT ON public.clearance_proofs, public.student_ledgers, public.student_payments TO authenticated;
GRANT UPDATE ON public.student_ledgers TO authenticated;
GRANT INSERT ON public.clearance_proofs TO authenticated;
GRANT UPDATE ON public.clearance_items TO authenticated;

DROP POLICY IF EXISTS student_upload_own_unlocked_clearance_proofs ON storage.objects;
CREATE POLICY student_upload_own_unlocked_clearance_proofs ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'clearance_proofs'
    AND public.student_can_upload_clearance_path(name)
  );

DROP POLICY IF EXISTS student_delete_own_failed_clearance_upload ON storage.objects;
CREATE POLICY student_delete_own_failed_clearance_upload ON storage.objects
  FOR DELETE TO authenticated USING (
    bucket_id = 'clearance_proofs'
    AND public.student_can_upload_clearance_path(name)
  );

DROP POLICY IF EXISTS student_read_own_accounting_clearance_proofs ON storage.objects;
CREATE POLICY student_read_own_accounting_clearance_proofs ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id = 'clearance_proofs'
    AND split_part(name, '/', 1) = auth.uid()::TEXT
  );

NOTIFY pgrst, 'reload schema';


-- ===== Next ordered lifecycle migration =====

-- Student self-healing initialization, clearance completion state, and audited
-- administrator overrides. All role comparisons explicitly cast enum values.

ALTER TABLE public.clearance_periods
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'CLOSED';

UPDATE public.clearance_periods
SET status = CASE WHEN is_active THEN 'ACTIVE' ELSE 'CLOSED' END;

ALTER TABLE public.clearance_requests
  ADD COLUMN IF NOT EXISTS overall_status TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS qr_code_token TEXT,
  ADD COLUMN IF NOT EXISTS completion_date TIMESTAMPTZ;

-- Remove legacy blanket policies requested in early setup snippets. Those
-- policies grant every authenticated account access because policies combine
-- with OR; the scoped policies below replace them with role-aware checks.
DO $$
DECLARE
  table_row RECORD;
BEGIN
  FOR table_row IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Allow Admin Full Access', table_row.tablename);
  END LOOP;
END;
$$;
DROP POLICY IF EXISTS "Allow Admin Update Staff Assignments" ON public.users;
DROP POLICY IF EXISTS "Allow Admin Edit Users" ON public.users;
DROP POLICY IF EXISTS "Allow Admin Update All Users" ON public.users;
DROP POLICY IF EXISTS "Allow Staff Clearance Updates" ON public.clearance_items;
DROP POLICY IF EXISTS "Allow Student Insert Proofs" ON public.clearance_proofs;
DROP POLICY IF EXISTS "Allow Staff Read Proofs" ON public.clearance_proofs;

CREATE OR REPLACE FUNCTION public.is_clearance_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND UPPER(u.role::text) = 'ADMIN'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_staff_for_office(p_office_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.staff_office_assignments a ON a.user_id = u.id
    WHERE u.id = auth.uid()
      AND UPPER(u.role::text) = 'STAFF'
      AND UPPER(COALESCE(u.status::text, '')) = 'ACTIVE'
      AND a.office_id = p_office_id
  );
$$;

CREATE OR REPLACE FUNCTION public.staff_can_access_clearance_item(p_item_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.clearance_items ci
    JOIN public.offices o ON o.id = ci.office_id
    JOIN public.clearance_requests cr ON cr.id = ci.clearance_request_id
    JOIN public.users student ON student.id = cr.student_id
    JOIN public.staff_office_assignments assignment
      ON assignment.user_id = auth.uid() AND assignment.office_id = ci.office_id
    JOIN public.users staff ON staff.id = assignment.user_id
    WHERE ci.id = p_item_id
      AND UPPER(staff.role::text) = 'STAFF'
      AND UPPER(COALESCE(staff.status::text, '')) = 'ACTIVE'
      AND (
        o.code::text NOT IN ('DEAN', 'ADVISER')
        OR assignment.department_id = student.department_id
      )
      AND (
        o.code::text = 'ACCOUNTING'
        OR EXISTS (
          SELECT 1
          FROM public.clearance_items accounting_item
          JOIN public.offices accounting_office ON accounting_office.id = accounting_item.office_id
          WHERE accounting_item.clearance_request_id = ci.clearance_request_id
            AND accounting_office.code::text = 'ACCOUNTING'
            AND UPPER(accounting_item.status::text) = 'APPROVED'
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.student_can_submit_clearance_item(p_item_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.clearance_items ci
    JOIN public.clearance_requests cr ON cr.id = ci.clearance_request_id
    JOIN public.offices o ON o.id = ci.office_id
    WHERE ci.id = p_item_id
      AND cr.student_id = auth.uid()
      AND UPPER(COALESCE(ci.status::text, '')) <> 'APPROVED'
      AND (
        o.code::text = 'ACCOUNTING'
        OR EXISTS (
          SELECT 1
          FROM public.clearance_items accounting_item
          JOIN public.offices accounting_office ON accounting_office.id = accounting_item.office_id
          WHERE accounting_item.clearance_request_id = ci.clearance_request_id
            AND accounting_office.code::text = 'ACCOUNTING'
            AND UPPER(COALESCE(accounting_item.status::text, '')) = 'APPROVED'
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.student_can_upload_clearance_path(p_object_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NOT NULL
      AND split_part(p_object_name, '/', 1) = auth.uid()::text
      AND split_part(p_object_name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN public.student_can_submit_clearance_item(split_part(p_object_name, '/', 2)::UUID)
    ELSE FALSE
  END;
$$;

CREATE OR REPLACE FUNCTION public.guard_student_clearance_item_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL
    OR COALESCE(auth.role(), '') = 'service_role'
    OR public.is_clearance_admin()
    OR NOT EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND UPPER(COALESCE(u.role::text, '')) = 'STUDENT'
    )
  THEN
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - 'status' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'updated_at')
    OR UPPER(COALESCE(NEW.status::text, '')) <> 'SUBMITTED'
    OR NOT public.student_can_submit_clearance_item(OLD.id)
    OR NOT EXISTS (
      SELECT 1 FROM public.clearance_proofs proof
      WHERE proof.clearance_item_id = OLD.id AND proof.student_id = auth.uid()
    )
  THEN
    RAISE EXCEPTION 'Students may only submit proof for their own unlocked clearance item.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES public.users(id),
  student_id UUID NOT NULL REFERENCES public.users(id),
  office_id UUID NOT NULL REFERENCES public.offices(id),
  clearance_item_id UUID REFERENCES public.clearance_items(id) ON DELETE SET NULL,
  previous_status TEXT,
  new_status TEXT NOT NULL,
  override_reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_logs_admin_read ON public.audit_logs;
CREATE POLICY audit_logs_admin_read ON public.audit_logs
  FOR SELECT TO authenticated USING (public.is_clearance_admin());
DROP POLICY IF EXISTS audit_logs_admin_insert ON public.audit_logs;
CREATE POLICY audit_logs_admin_insert ON public.audit_logs
  FOR INSERT TO authenticated WITH CHECK (public.is_clearance_admin() AND admin_id = auth.uid());
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;

DROP POLICY IF EXISTS offices_authenticated_catalog_read ON public.offices;
CREATE POLICY offices_authenticated_catalog_read ON public.offices
  FOR SELECT TO authenticated USING (
    public.is_clearance_admin()
    OR EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND UPPER(u.role::text) = 'STUDENT'
        AND UPPER(COALESCE(u.status::text, 'ACTIVE')) = 'ACTIVE'
    )
    OR public.is_active_staff_for_office(id)
  );
GRANT SELECT ON public.offices TO authenticated;

CREATE OR REPLACE FUNCTION public.ensure_student_clearance()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id UUID := auth.uid();
  active_period_id UUID;
  request_row_id UUID;
  user_role TEXT;
  user_status TEXT;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Sign in to initialize your clearance.' USING ERRCODE = '42501';
  END IF;

  SELECT UPPER(u.role::text), UPPER(COALESCE(u.status::text, 'ACTIVE'))
  INTO user_role, user_status
  FROM public.users u WHERE u.id = current_user_id;
  IF user_role IS DISTINCT FROM 'STUDENT' OR user_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Only active student accounts can initialize student clearance.' USING ERRCODE = '42501';
  END IF;

  SELECT cp.id INTO active_period_id
  FROM public.clearance_periods cp
  WHERE cp.is_active = TRUE
  ORDER BY cp.created_at DESC NULLS LAST
  LIMIT 1;
  IF active_period_id IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(current_user_id::text || ':' || active_period_id::text, 0));

  SELECT cr.id INTO request_row_id
  FROM public.clearance_requests cr
  WHERE cr.student_id = current_user_id AND cr.clearance_period_id = active_period_id
  LIMIT 1;

  IF request_row_id IS NULL THEN
    INSERT INTO public.clearance_requests (student_id, clearance_period_id, overall_status)
    VALUES (current_user_id, active_period_id, 'PENDING')
    RETURNING id INTO request_row_id;
  END IF;

  INSERT INTO public.clearance_items (clearance_request_id, office_id)
  SELECT request_row_id, o.id
  FROM public.offices o
  WHERE o.code::text = ANY (ARRAY[
    'ACCOUNTING', 'REGISTRAR', 'DEAN', 'DIRECTOR_SAS', 'GUIDANCE',
    'ADVISER', 'PROPERTY', 'LIBRARIAN', 'COUNCIL', 'CLINIC'
  ])
    AND NOT EXISTS (
      SELECT 1 FROM public.clearance_items ci
      WHERE ci.clearance_request_id = request_row_id AND ci.office_id = o.id
    );

  RETURN request_row_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_student_clearance() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_student_clearance() TO authenticated;
REVOKE ALL ON FUNCTION public.staff_can_access_clearance_item(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_can_access_clearance_item(UUID) TO authenticated;

-- Opening a period also provisions all ten office items for active students.
CREATE OR REPLACE FUNCTION public.admin_open_clearance_period(
  p_title TEXT,
  p_academic_year TEXT,
  p_semester TEXT,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  new_period public.clearance_periods%ROWTYPE;
  created_requests INTEGER := 0;
BEGIN
  IF NOT public.is_clearance_admin() THEN
    RAISE EXCEPTION 'Administrator access is required.' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(TRIM(p_title), '') IS NULL OR NULLIF(TRIM(p_academic_year), '') IS NULL THEN
    RAISE EXCEPTION 'Period title and academic year are required.' USING ERRCODE = '22023';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
    RAISE EXCEPTION 'Enter a valid start date and an end date on or after it.' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(742031);
  UPDATE public.clearance_periods SET is_active = FALSE, status = 'CLOSED' WHERE is_active = TRUE;
  INSERT INTO public.clearance_periods (title, academic_year, semester, is_active, status, start_date, end_date)
  VALUES (TRIM(p_title), TRIM(p_academic_year), p_semester, TRUE, 'ACTIVE', p_start_date, p_end_date)
  RETURNING * INTO new_period;

  INSERT INTO public.clearance_requests (student_id, clearance_period_id, overall_status)
  SELECT u.id, new_period.id, 'PENDING'
  FROM public.users u
  WHERE UPPER(u.role::text) = 'STUDENT'
    AND UPPER(COALESCE(u.status::text, 'ACTIVE')) = 'ACTIVE';
  GET DIAGNOSTICS created_requests = ROW_COUNT;

  INSERT INTO public.clearance_items (clearance_request_id, office_id)
  SELECT cr.id, o.id
  FROM public.clearance_requests cr
  JOIN public.users u ON u.id = cr.student_id
  CROSS JOIN public.offices o
  WHERE cr.clearance_period_id = new_period.id
    AND UPPER(u.role::text) = 'STUDENT'
    AND o.code::text = ANY (ARRAY[
      'ACCOUNTING', 'REGISTRAR', 'DEAN', 'DIRECTOR_SAS', 'GUIDANCE',
      'ADVISER', 'PROPERTY', 'LIBRARIAN', 'COUNCIL', 'CLINIC'
    ])
    AND NOT EXISTS (
      SELECT 1 FROM public.clearance_items ci
      WHERE ci.clearance_request_id = cr.id AND ci.office_id = o.id
    );

  RETURN jsonb_build_object('period', to_jsonb(new_period), 'request_count', created_requests);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_clearance_period_state(
  p_period_id UUID,
  p_action TEXT
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
    UPDATE public.clearance_periods SET is_active = FALSE, status = 'CLOSED' WHERE is_active = TRUE;
    UPDATE public.clearance_periods SET is_active = TRUE, status = 'ACTIVE', archived_at = NULL
    WHERE id = p_period_id RETURNING * INTO changed_period;
  ELSIF p_action = 'archive' THEN
    UPDATE public.clearance_periods SET is_active = FALSE, status = 'ARCHIVED', archived_at = NOW()
    WHERE id = p_period_id RETURNING * INTO changed_period;
  ELSE
    UPDATE public.clearance_periods SET is_active = FALSE, status = 'CLOSED'
    WHERE id = p_period_id RETURNING * INTO changed_period;
  END IF;

  IF changed_period.id IS NULL THEN
    RAISE EXCEPTION 'Clearance period was not found.' USING ERRCODE = 'P0002';
  END IF;
  RETURN changed_period;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_clearance_request_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_request_id UUID := COALESCE(NEW.clearance_request_id, OLD.clearance_request_id);
  office_count INTEGER;
  approved_count INTEGER;
  all_approved BOOLEAN;
BEGIN
  SELECT COUNT(*), COUNT(*) FILTER (WHERE UPPER(ci.status::text) = 'APPROVED')
  INTO office_count, approved_count
  FROM public.clearance_items ci
  JOIN public.offices o ON o.id = ci.office_id
  WHERE ci.clearance_request_id = target_request_id
    AND o.code::text = ANY (ARRAY[
      'ACCOUNTING', 'REGISTRAR', 'DEAN', 'DIRECTOR_SAS', 'GUIDANCE',
      'ADVISER', 'PROPERTY', 'LIBRARIAN', 'COUNCIL', 'CLINIC'
    ]);

  all_approved := office_count = 10 AND approved_count = 10;
  UPDATE public.clearance_requests
  SET overall_status = CASE WHEN all_approved THEN 'APPROVED' ELSE 'IN_PROGRESS' END,
      completion_date = CASE WHEN all_approved THEN COALESCE(completion_date, NOW()) ELSE NULL END,
      qr_code_token = CASE WHEN all_approved THEN COALESCE(qr_code_token, gen_random_uuid()::text) ELSE NULL END
  WHERE id = target_request_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_clearance_request_completion ON public.clearance_items;
CREATE TRIGGER sync_clearance_request_completion
AFTER INSERT OR UPDATE OR DELETE ON public.clearance_items
FOR EACH ROW EXECUTE FUNCTION public.sync_clearance_request_completion();

CREATE OR REPLACE FUNCTION public.admin_override_clearance_item(
  p_item_id UUID,
  p_status TEXT,
  p_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  item_row public.clearance_items%ROWTYPE;
  status_type TEXT;
BEGIN
  IF NOT public.is_clearance_admin() THEN
    RAISE EXCEPTION 'Administrator access is required.' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(TRIM(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'An override reason is required.' USING ERRCODE = '22023';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('PENDING', 'SUBMITTED', 'IN_PROGRESS', 'APPROVED', 'HOLD', 'REJECTED', 'REQUIREMENT_NEEDED') THEN
    RAISE EXCEPTION 'Unsupported clearance status.' USING ERRCODE = '22023';
  END IF;

  SELECT ci.* INTO item_row FROM public.clearance_items ci WHERE ci.id = p_item_id FOR UPDATE;
  IF item_row.id IS NULL THEN RAISE EXCEPTION 'Clearance item not found.' USING ERRCODE = 'P0002'; END IF;

  SELECT format_type(a.atttypid, a.atttypmod) INTO status_type
  FROM pg_attribute a
  WHERE a.attrelid = 'public.clearance_items'::regclass AND a.attname = 'status' AND NOT a.attisdropped;

  EXECUTE format('UPDATE public.clearance_items SET status = $1::%s, remarks = $2 WHERE id = $3', status_type)
    USING p_status, '[ADMIN OVERRIDE] ' || TRIM(p_reason), p_item_id;

  INSERT INTO public.audit_logs (admin_id, student_id, office_id, clearance_item_id, previous_status, new_status, override_reason)
  SELECT auth.uid(), cr.student_id, item_row.office_id, item_row.id, item_row.status::text, p_status, TRIM(p_reason)
  FROM public.clearance_requests cr WHERE cr.id = item_row.clearance_request_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.accounting_decide_clearance_item(
  p_item_id UUID,
  p_status TEXT,
  p_remarks TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  item_row public.clearance_items%ROWTYPE;
  status_type TEXT;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('APPROVED', 'REJECTED', 'REQUIREMENT_NEEDED') THEN
    RAISE EXCEPTION 'Unsupported Accounting decision.' USING ERRCODE = '22023';
  END IF;
  IF p_status <> 'APPROVED' AND NULLIF(TRIM(p_remarks), '') IS NULL THEN
    RAISE EXCEPTION 'A remark is required when placing a proof on hold or rejecting it.' USING ERRCODE = '22023';
  END IF;
  SELECT ci.* INTO item_row FROM public.clearance_items ci WHERE ci.id = p_item_id FOR UPDATE;
  IF item_row.id IS NULL OR NOT public.is_active_staff_for_office(item_row.office_id) THEN
    RAISE EXCEPTION 'This Accounting item is not assigned to your staff account.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.offices o WHERE o.id = item_row.office_id AND o.code::text = 'ACCOUNTING') THEN
    RAISE EXCEPTION 'This item does not belong to Accounting.' USING ERRCODE = '42501';
  END IF;
  IF p_status = 'APPROVED' AND NOT EXISTS (
    SELECT 1 FROM public.clearance_proofs proof
    WHERE proof.clearance_item_id = p_item_id
  ) THEN
    RAISE EXCEPTION 'A submitted payment proof is required before Accounting can approve this clearance.' USING ERRCODE = '22023';
  END IF;

  SELECT format_type(a.atttypid, a.atttypmod) INTO status_type
  FROM pg_attribute a
  WHERE a.attrelid = 'public.clearance_items'::regclass AND a.attname = 'status' AND NOT a.attisdropped;
  EXECUTE format(
    'UPDATE public.clearance_items SET status = $1::%s, remarks = $2, balance_amount = CASE WHEN $1 = ''APPROVED'' THEN 0 ELSE balance_amount END, processed_by = auth.uid(), processed_at = NOW() WHERE id = $3',
    status_type
  ) USING p_status, NULLIF(TRIM(p_remarks), ''), p_item_id;

  IF p_status = 'APPROVED' AND to_regclass('public.student_ledgers') IS NOT NULL THEN
    EXECUTE 'UPDATE public.student_ledgers SET outstanding_balance = 0, required_action = ''NO ACTION REQUIRED'' WHERE student_id = (SELECT cr.student_id FROM public.clearance_requests cr WHERE cr.id = $1)'
      USING item_row.clearance_request_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_override_clearance_item(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_override_clearance_item(UUID, TEXT, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.accounting_decide_clearance_item(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accounting_decide_clearance_item(UUID, TEXT, TEXT) TO authenticated;

-- Scope non-Accounting staff to their assigned department for DEAN/ADVISER,
-- and keep queue reads aligned with the same approval gateway as writes.
DROP POLICY IF EXISTS clearance_items_assigned_staff_read ON public.clearance_items;
CREATE POLICY clearance_items_assigned_staff_read ON public.clearance_items
  FOR SELECT TO authenticated USING (public.staff_can_access_clearance_item(id));
DROP POLICY IF EXISTS clearance_requests_assigned_staff_read ON public.clearance_requests;
CREATE POLICY clearance_requests_assigned_staff_read ON public.clearance_requests
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.clearance_items ci
      WHERE ci.clearance_request_id = clearance_requests.id
        AND public.staff_can_access_clearance_item(ci.id)
    )
  );
DROP POLICY IF EXISTS users_assigned_staff_queue_read ON public.users;
CREATE POLICY users_assigned_staff_queue_read ON public.users
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1
      FROM public.clearance_requests cr
      JOIN public.clearance_items ci ON ci.clearance_request_id = cr.id
      WHERE cr.student_id = users.id
        AND public.staff_can_access_clearance_item(ci.id)
    )
  );

-- Backfill completion state and issue a pass for requests already fully clear.
WITH counts AS (
  SELECT cr.id AS request_id, COUNT(*) AS office_count,
    COUNT(*) FILTER (WHERE UPPER(ci.status::text) = 'APPROVED') AS approved_count
  FROM public.clearance_requests cr
  JOIN public.clearance_items ci ON ci.clearance_request_id = cr.id
  JOIN public.offices o ON o.id = ci.office_id
  WHERE o.code::text = ANY (ARRAY[
    'ACCOUNTING', 'REGISTRAR', 'DEAN', 'DIRECTOR_SAS', 'GUIDANCE',
    'ADVISER', 'PROPERTY', 'LIBRARIAN', 'COUNCIL', 'CLINIC'
  ])
  GROUP BY cr.id
)
UPDATE public.clearance_requests cr
SET overall_status = CASE WHEN counts.office_count = 10 AND counts.approved_count = 10 THEN 'APPROVED' ELSE 'IN_PROGRESS' END,
    completion_date = CASE WHEN counts.office_count = 10 AND counts.approved_count = 10 THEN NOW() ELSE NULL END,
    qr_code_token = CASE WHEN counts.office_count = 10 AND counts.approved_count = 10 THEN COALESCE(cr.qr_code_token, gen_random_uuid()::text) ELSE NULL END
FROM counts WHERE cr.id = counts.request_id;

NOTIFY pgrst, 'reload schema';


-- ===== Next ordered lifecycle migration =====

-- Default Accounting ledgers, accounting office editor RPC, and student ledger realtime.

ALTER TABLE public.student_ledgers
  ADD COLUMN IF NOT EXISTS total_balance NUMERIC(10,2) NOT NULL DEFAULT 0.00;

-- Serialize creation by student so signup and clearance initialization can race safely.
CREATE OR REPLACE FUNCTION public.ensure_default_student_ledger(p_student_id UUID)
RETURNS public.student_ledgers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ledger_row public.student_ledgers%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_student_id::text || ':ledger', 0));
  SELECT * INTO ledger_row FROM public.student_ledgers
  WHERE student_id = p_student_id ORDER BY created_at DESC NULLS LAST LIMIT 1 FOR UPDATE;

  IF ledger_row.id IS NULL THEN
    INSERT INTO public.student_ledgers (
      student_id, tuition_fee, lab_fee, misc_fee, outstanding_balance,
      total_balance, required_action
    ) VALUES (p_student_id, 0, 0, 0, 0, 0, 'LEDGER SETUP REQUIRED')
    RETURNING * INTO ledger_row;
  ELSE
    UPDATE public.student_ledgers
    SET total_balance = COALESCE(tuition_fee, 0) + COALESCE(lab_fee, 0) + COALESCE(misc_fee, 0)
    WHERE id = ledger_row.id
    RETURNING * INTO ledger_row;
  END IF;
  RETURN ledger_row;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_default_student_ledger(UUID) FROM PUBLIC;

-- Signup path: the profile upsert inserts into public.users after Auth signup.
CREATE OR REPLACE FUNCTION public.create_student_ledger_after_profile_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF UPPER(NEW.role::text) = 'STUDENT' THEN
    PERFORM public.ensure_default_student_ledger(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS create_student_ledger_after_profile_insert ON public.users;
CREATE TRIGGER create_student_ledger_after_profile_insert
AFTER INSERT ON public.users
FOR EACH ROW EXECUTE FUNCTION public.create_student_ledger_after_profile_insert();

-- Clearance item creation path: make sure a ledger exists and copy its balance
-- into the student's Accounting item, including when a new term is initialized.
CREATE OR REPLACE FUNCTION public.initialize_accounting_item_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  student_user_id UUID;
  ledger_row public.student_ledgers%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.offices o WHERE o.id = NEW.office_id AND o.code::text = 'ACCOUNTING') THEN
    RETURN NEW;
  END IF;

  SELECT cr.student_id INTO student_user_id
  FROM public.clearance_requests cr WHERE cr.id = NEW.clearance_request_id;
  IF student_user_id IS NULL THEN RETURN NEW; END IF;

  PERFORM public.ensure_default_student_ledger(student_user_id);
  SELECT * INTO ledger_row FROM public.student_ledgers
  WHERE student_id = student_user_id ORDER BY created_at DESC NULLS LAST LIMIT 1;

  NEW.balance_amount := CASE WHEN UPPER(NEW.status::text) = 'APPROVED' THEN 0 ELSE ledger_row.outstanding_balance END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS initialize_accounting_item_balance ON public.clearance_items;
CREATE TRIGGER initialize_accounting_item_balance
BEFORE INSERT ON public.clearance_items
FOR EACH ROW EXECUTE FUNCTION public.initialize_accounting_item_balance();

-- Backfill students already registered before these triggers were installed.
DO $$
DECLARE student_row RECORD;
BEGIN
  FOR student_row IN
    SELECT u.id FROM public.users u WHERE UPPER(u.role::text) = 'STUDENT'
  LOOP
    PERFORM public.ensure_default_student_ledger(student_row.id);
  END LOOP;
END;
$$;

UPDATE public.clearance_items ci
SET balance_amount = CASE WHEN UPPER(ci.status::text) = 'APPROVED' THEN 0 ELSE sl.outstanding_balance END
FROM public.clearance_requests cr
JOIN public.student_ledgers sl ON sl.student_id = cr.student_id
JOIN public.offices o ON o.code::text = 'ACCOUNTING'
WHERE ci.clearance_request_id = cr.id
  AND ci.office_id = o.id;

-- Admin-only editor endpoint. It verifies the caller's active Accounting
-- assignment, updates the ledger and current active-period Accounting item in
-- one transaction, and can mark a verified zero-balance student approved.
CREATE OR REPLACE FUNCTION public.accounting_save_student_ledger(
  p_student_id UUID,
  p_tuition_fee NUMERIC,
  p_lab_fee NUMERIC,
  p_misc_fee NUMERIC,
  p_mark_paid BOOLEAN DEFAULT FALSE
)
RETURNS public.student_ledgers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  accounting_office_id UUID;
  active_period_id UUID;
  active_request_id UUID;
  accounting_item_id UUID;
  next_total NUMERIC(10,2);
  ledger_row public.student_ledgers%ROWTYPE;
  status_type TEXT;
BEGIN
  SELECT o.id INTO accounting_office_id FROM public.offices o WHERE o.code::text = 'ACCOUNTING';
  IF accounting_office_id IS NULL OR NOT public.is_active_staff_for_office(accounting_office_id) THEN
    RAISE EXCEPTION 'An active Accounting staff assignment is required.' USING ERRCODE = '42501';
  END IF;
  IF p_tuition_fee IS NULL OR p_lab_fee IS NULL OR p_misc_fee IS NULL
    OR p_tuition_fee < 0 OR p_lab_fee < 0 OR p_misc_fee < 0 THEN
    RAISE EXCEPTION 'Enter valid fee amounts of zero or more.' USING ERRCODE = '22023';
  END IF;

  SELECT cp.id INTO active_period_id FROM public.clearance_periods cp
  WHERE cp.is_active = TRUE ORDER BY cp.created_at DESC NULLS LAST LIMIT 1;
  IF active_period_id IS NULL THEN RAISE EXCEPTION 'There is no active clearance period.' USING ERRCODE = 'P0002'; END IF;

  SELECT cr.id INTO active_request_id FROM public.clearance_requests cr
  WHERE cr.student_id = p_student_id AND cr.clearance_period_id = active_period_id;
  IF active_request_id IS NULL THEN RAISE EXCEPTION 'This student has no clearance request in the active period.' USING ERRCODE = 'P0002'; END IF;
  SELECT ci.id INTO accounting_item_id FROM public.clearance_items ci
  WHERE ci.clearance_request_id = active_request_id AND ci.office_id = accounting_office_id FOR UPDATE;
  IF accounting_item_id IS NULL THEN RAISE EXCEPTION 'The Accounting clearance item has not been initialized.' USING ERRCODE = 'P0002'; END IF;

  next_total := p_tuition_fee + p_lab_fee + p_misc_fee;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_student_id::text || ':ledger', 0));
  SELECT * INTO ledger_row FROM public.student_ledgers
  WHERE student_id = p_student_id ORDER BY created_at DESC NULLS LAST LIMIT 1 FOR UPDATE;

  IF ledger_row.id IS NULL THEN
    INSERT INTO public.student_ledgers (
      student_id, tuition_fee, lab_fee, misc_fee, total_balance,
      outstanding_balance, required_action
    ) VALUES (
      p_student_id, p_tuition_fee, p_lab_fee, p_misc_fee, next_total,
      next_total, CASE WHEN next_total = 0 THEN 'NO ACTION REQUIRED' ELSE 'SETTLE PAYMENT' END
    ) RETURNING * INTO ledger_row;
  ELSE
    UPDATE public.student_ledgers
    SET tuition_fee = p_tuition_fee, lab_fee = p_lab_fee, misc_fee = p_misc_fee,
        total_balance = next_total, outstanding_balance = next_total,
        required_action = CASE WHEN next_total = 0 THEN 'NO ACTION REQUIRED' ELSE 'SETTLE PAYMENT' END
    WHERE id = ledger_row.id RETURNING * INTO ledger_row;
  END IF;

  SELECT format_type(a.atttypid, a.atttypmod) INTO status_type
  FROM pg_attribute a
  WHERE a.attrelid = 'public.clearance_items'::regclass AND a.attname = 'status' AND NOT a.attisdropped;

  IF p_mark_paid THEN
    IF next_total <> 0 THEN RAISE EXCEPTION 'Set all fees to zero before marking the ledger fully paid.' USING ERRCODE = '22023'; END IF;
    EXECUTE format(
      'UPDATE public.clearance_items SET balance_amount = 0, status = $1::%s, remarks = $2, processed_by = auth.uid(), processed_at = NOW() WHERE id = $3',
      status_type
    ) USING 'APPROVED', 'Marked fully paid by Accounting ledger editor', accounting_item_id;
  ELSE
    EXECUTE format(
      'UPDATE public.clearance_items SET balance_amount = $1, status = CASE WHEN UPPER(status::text) = ''APPROVED'' AND $1 > 0 THEN $2::%s ELSE status END, remarks = CASE WHEN UPPER(status::text) = ''APPROVED'' AND $1 > 0 THEN ''Balance updated by Accounting; re-approval required'' ELSE remarks END WHERE id = $3',
      status_type
    ) USING next_total, 'PENDING', accounting_item_id;
  END IF;
  RETURN ledger_row;
END;
$$;

REVOKE ALL ON FUNCTION public.accounting_save_student_ledger(UUID, NUMERIC, NUMERIC, NUMERIC, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accounting_save_student_ledger(UUID, NUMERIC, NUMERIC, NUMERIC, BOOLEAN) TO authenticated;

-- Keep total_balance/outstanding_balance in sync when a ledger is edited through
-- other trusted workflows, and refresh the current Accounting item amount.
CREATE OR REPLACE FUNCTION public.sync_student_ledger_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT'
    OR NEW.tuition_fee IS DISTINCT FROM OLD.tuition_fee
    OR NEW.lab_fee IS DISTINCT FROM OLD.lab_fee
    OR NEW.misc_fee IS DISTINCT FROM OLD.misc_fee THEN
    NEW.total_balance := COALESCE(NEW.tuition_fee, 0) + COALESCE(NEW.lab_fee, 0) + COALESCE(NEW.misc_fee, 0);
    NEW.outstanding_balance := NEW.total_balance;
    NEW.required_action := CASE WHEN NEW.total_balance = 0 THEN 'NO ACTION REQUIRED' ELSE 'SETTLE PAYMENT' END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_student_ledger_balance ON public.student_ledgers;
CREATE TRIGGER sync_student_ledger_balance
BEFORE INSERT OR UPDATE ON public.student_ledgers
FOR EACH ROW EXECUTE FUNCTION public.sync_student_ledger_balance();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
    AND NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'student_ledgers'
    ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.student_ledgers;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';


-- ===== Next ordered lifecycle migration =====

-- Transaction lifecycle hardening: normalize legacy references and keep
-- Accounting and assigned staff decisions atomic and server-authorized.

ALTER TABLE public.clearance_items
  ADD COLUMN IF NOT EXISTS clearance_request_id UUID,
  ADD COLUMN IF NOT EXISTS office_id UUID,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS remarks TEXT,
  ADD COLUMN IF NOT EXISTS balance_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS official_receipt_number TEXT,
  ADD COLUMN IF NOT EXISTS processed_by UUID REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'clearance_items' AND column_name = 'request_id'
  ) THEN
    EXECUTE 'UPDATE public.clearance_items SET clearance_request_id = request_id WHERE clearance_request_id IS NULL';
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clearance_items_clearance_request_id_lifecycle_fk') THEN
    ALTER TABLE public.clearance_items
      ADD CONSTRAINT clearance_items_clearance_request_id_lifecycle_fk
      FOREIGN KEY (clearance_request_id) REFERENCES public.clearance_requests(id) ON DELETE CASCADE NOT VALID;
  END IF;
END;
$$;

ALTER TABLE public.clearance_proofs
  ADD COLUMN IF NOT EXISTS clearance_item_id UUID,
  ADD COLUMN IF NOT EXISTS student_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS storage_path TEXT,
  ADD COLUMN IF NOT EXISTS file_url TEXT,
  ADD COLUMN IF NOT EXISTS file_name TEXT,
  ADD COLUMN IF NOT EXISTS mime_type TEXT,
  ADD COLUMN IF NOT EXISTS file_type TEXT,
  ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'clearance_proofs' AND column_name = 'item_id'
  ) THEN
    EXECUTE 'UPDATE public.clearance_proofs SET clearance_item_id = item_id WHERE clearance_item_id IS NULL';
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clearance_proofs_clearance_item_id_lifecycle_fk') THEN
    ALTER TABLE public.clearance_proofs
      ADD CONSTRAINT clearance_proofs_clearance_item_id_lifecycle_fk
      FOREIGN KEY (clearance_item_id) REFERENCES public.clearance_items(id) ON DELETE CASCADE NOT VALID;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS clearance_items_request_id_idx ON public.clearance_items(clearance_request_id);
CREATE INDEX IF NOT EXISTS clearance_proofs_item_id_idx ON public.clearance_proofs(clearance_item_id);
CREATE INDEX IF NOT EXISTS clearance_proofs_student_id_idx ON public.clearance_proofs(student_id);

-- Make sure the private bucket exists. Object paths are scoped to
-- {student UUID}/{clearance item UUID}/{filename} by the existing guard.
INSERT INTO storage.buckets (id, name, public)
VALUES ('clearance_proofs', 'clearance_proofs', FALSE)
ON CONFLICT (id) DO UPDATE SET public = FALSE;

CREATE OR REPLACE FUNCTION public.accounting_adjust_clearance_balance(
  p_item_id UUID,
  p_balance NUMERIC,
  p_receipt_number TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item_row public.clearance_items%ROWTYPE;
  student_user_id UUID;
  status_type TEXT;
BEGIN
  IF p_balance IS NULL OR p_balance < 0 THEN
    RAISE EXCEPTION 'Enter a valid balance of zero or more.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO item_row FROM public.clearance_items WHERE id = p_item_id FOR UPDATE;
  IF item_row.id IS NULL OR NOT public.staff_can_access_clearance_item(p_item_id) THEN
    RAISE EXCEPTION 'An active Accounting assignment is required to adjust this balance.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.offices o WHERE o.id = item_row.office_id AND o.code::text = 'ACCOUNTING') THEN
    RAISE EXCEPTION 'Only Accounting clearance balances can be adjusted here.' USING ERRCODE = '42501';
  END IF;

  SELECT cr.student_id INTO student_user_id
  FROM public.clearance_requests cr WHERE cr.id = item_row.clearance_request_id;

  SELECT format_type(a.atttypid, a.atttypmod) INTO status_type
  FROM pg_attribute a
  WHERE a.attrelid = 'public.clearance_items'::regclass AND a.attname = 'status' AND NOT a.attisdropped;
  EXECUTE format(
    'UPDATE public.clearance_items SET balance_amount = $1, official_receipt_number = $2, processed_by = auth.uid(), processed_at = NOW(), status = CASE WHEN UPPER(status::text) = ''APPROVED'' AND $1 > 0 THEN $3::%s ELSE status END WHERE id = $4',
    status_type
  ) USING p_balance, NULLIF(TRIM(p_receipt_number), ''), 'PENDING', p_item_id;

  UPDATE public.student_ledgers
  SET outstanding_balance = p_balance,
      total_balance = p_balance,
      required_action = CASE WHEN p_balance = 0 THEN 'NO ACTION REQUIRED' ELSE 'SETTLE PAYMENT' END,
      official_receipt_number = NULLIF(TRIM(p_receipt_number), '')
  WHERE student_id = student_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_decide_clearance_items(
  p_item_ids UUID[],
  p_status TEXT,
  p_remarks TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item_id UUID;
  item_row public.clearance_items%ROWTYPE;
  status_type TEXT;
  changed_count INTEGER := 0;
BEGIN
  IF COALESCE(array_length(p_item_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Select at least one clearance item.' USING ERRCODE = '22023';
  END IF;
  IF p_status NOT IN ('APPROVED', 'REQUIREMENT_NEEDED') THEN
    RAISE EXCEPTION 'Staff may approve an item or return it as requirement needed.' USING ERRCODE = '22023';
  END IF;
  IF p_status = 'REQUIREMENT_NEEDED' AND NULLIF(TRIM(p_remarks), '') IS NULL THEN
    RAISE EXCEPTION 'A deficiency remark is required.' USING ERRCODE = '22023';
  END IF;

  SELECT format_type(a.atttypid, a.atttypmod) INTO status_type
  FROM pg_attribute a
  WHERE a.attrelid = 'public.clearance_items'::regclass AND a.attname = 'status' AND NOT a.attisdropped;

  FOREACH item_id IN ARRAY p_item_ids LOOP
    SELECT * INTO item_row FROM public.clearance_items WHERE id = item_id FOR UPDATE;
    IF item_row.id IS NULL OR NOT public.staff_can_access_clearance_item(item_id) THEN
      RAISE EXCEPTION 'A selected item is outside your assigned office or Accounting has not approved it.' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM public.offices o WHERE o.id = item_row.office_id AND o.code::text = 'ACCOUNTING') THEN
      RAISE EXCEPTION 'Accounting decisions must use the Accounting verification workflow.' USING ERRCODE = '42501';
    END IF;
    IF p_status = 'APPROVED' AND NOT EXISTS (
      SELECT 1 FROM public.clearance_proofs proof WHERE proof.clearance_item_id = item_id
    ) THEN
      RAISE EXCEPTION 'A student proof document is required before approval.' USING ERRCODE = '22023';
    END IF;
    EXECUTE format(
      'UPDATE public.clearance_items SET status = $1::%s, remarks = $2, processed_by = auth.uid(), processed_at = NOW() WHERE id = $3',
      status_type
    ) USING p_status, NULLIF(TRIM(p_remarks), ''), item_id;
    changed_count := changed_count + 1;
  END LOOP;
  RETURN changed_count;
END;
$$;

-- Replace the Accounting decision RPC so clearing a verified balance updates
-- the ledger and clearance item in the same transaction.
CREATE OR REPLACE FUNCTION public.accounting_decide_clearance_item(
  p_item_id UUID,
  p_status TEXT,
  p_remarks TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item_row public.clearance_items%ROWTYPE;
  student_user_id UUID;
  status_type TEXT;
BEGIN
  IF p_status NOT IN ('APPROVED', 'REJECTED', 'REQUIREMENT_NEEDED') THEN
    RAISE EXCEPTION 'Unsupported Accounting decision.' USING ERRCODE = '22023';
  END IF;
  IF p_status <> 'APPROVED' AND NULLIF(TRIM(p_remarks), '') IS NULL THEN
    RAISE EXCEPTION 'A remark is required when returning or rejecting a payment proof.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO item_row FROM public.clearance_items WHERE id = p_item_id FOR UPDATE;
  IF item_row.id IS NULL OR NOT public.staff_can_access_clearance_item(p_item_id)
    OR NOT EXISTS (SELECT 1 FROM public.offices o WHERE o.id = item_row.office_id AND o.code::text = 'ACCOUNTING') THEN
    RAISE EXCEPTION 'This Accounting item is not assigned to your active staff account.' USING ERRCODE = '42501';
  END IF;
  IF p_status = 'APPROVED' AND NOT EXISTS (
    SELECT 1 FROM public.clearance_proofs proof WHERE proof.clearance_item_id = p_item_id
  ) THEN
    RAISE EXCEPTION 'A submitted payment proof is required before Accounting can approve this clearance.' USING ERRCODE = '22023';
  END IF;
  SELECT cr.student_id INTO student_user_id
  FROM public.clearance_requests cr WHERE cr.id = item_row.clearance_request_id;
  SELECT format_type(a.atttypid, a.atttypmod) INTO status_type
  FROM pg_attribute a
  WHERE a.attrelid = 'public.clearance_items'::regclass AND a.attname = 'status' AND NOT a.attisdropped;
  EXECUTE format(
    'UPDATE public.clearance_items SET status = $1::%s, remarks = $2, balance_amount = CASE WHEN $1 = ''APPROVED'' THEN 0 ELSE balance_amount END, processed_by = auth.uid(), processed_at = NOW() WHERE id = $3',
    status_type
  ) USING p_status, NULLIF(TRIM(p_remarks), ''), p_item_id;

  IF p_status = 'APPROVED' THEN
    UPDATE public.student_ledgers
    SET tuition_fee = 0, lab_fee = 0, misc_fee = 0,
        total_balance = 0, outstanding_balance = 0,
        required_action = 'NO ACTION REQUIRED'
    WHERE student_id = student_user_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.accounting_adjust_clearance_balance(UUID, NUMERIC, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.staff_decide_clearance_items(UUID[], TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accounting_adjust_clearance_balance(UUID, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_decide_clearance_items(UUID[], TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accounting_decide_clearance_item(UUID, TEXT, TEXT) TO authenticated;

-- The existing role-aware RLS policies from migrations 06/07 remain the
-- authority. Ensure legacy wide-open policies cannot bypass their safeguards.
DROP POLICY IF EXISTS "Allow Staff Clearance Updates" ON public.clearance_items;
DROP POLICY IF EXISTS "Allow Student Insert Proofs" ON public.clearance_proofs;
DROP POLICY IF EXISTS "Allow Staff Read Proofs" ON public.clearance_proofs;

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_logs_admin_read ON public.audit_logs;
CREATE POLICY audit_logs_admin_read ON public.audit_logs FOR SELECT TO authenticated
  USING (public.is_clearance_admin());
DROP POLICY IF EXISTS audit_logs_admin_insert ON public.audit_logs;
CREATE POLICY audit_logs_admin_insert ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (public.is_clearance_admin() AND admin_id = auth.uid());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'clearance_items') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.clearance_items;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'clearance_requests') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.clearance_requests;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'student_ledgers') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.student_ledgers;
    END IF;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';

-- Re-apply authorization after the ordered legacy definitions above so the
-- standalone setup ends with the same public-role and suspension safeguards
-- as the current migration set.
CREATE OR REPLACE FUNCTION public.is_clearance_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
      AND UPPER(u.role::text) = 'ADMIN'
      AND UPPER(COALESCE(u.status::text, 'ACTIVE')) = 'ACTIVE'
      AND NOT EXISTS (
        SELECT 1 FROM auth.users au
        WHERE au.id = auth.uid() AND au.banned_until > NOW()
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_staff_for_office(p_office_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    JOIN public.staff_office_assignments a ON a.user_id = u.id
    WHERE u.id = auth.uid()
      AND UPPER(u.role::text) = 'STAFF'
      AND UPPER(COALESCE(u.status::text, '')) = 'ACTIVE'
      AND a.office_id = p_office_id
      AND NOT EXISTS (
        SELECT 1 FROM auth.users au
        WHERE au.id = auth.uid() AND au.banned_until > NOW()
      )
  );
$$;

REVOKE ALL ON FUNCTION public.is_clearance_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_active_staff_for_office(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_clearance_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_staff_for_office(UUID) TO authenticated;

UPDATE storage.buckets
SET public = FALSE,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[]
WHERE id = 'clearance_proofs';

NOTIFY pgrst, 'reload schema';

CREATE TABLE IF NOT EXISTS public.guidance_exit_survey_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clearance_item_id UUID NOT NULL UNIQUE REFERENCES public.clearance_items(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  response TEXT NOT NULL CHECK (char_length(btrim(response)) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.guidance_exit_survey_responses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS guidance_exit_survey_response_read ON public.guidance_exit_survey_responses;
CREATE POLICY guidance_exit_survey_response_read
  ON public.guidance_exit_survey_responses
  FOR SELECT TO authenticated
  USING (
    student_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.clearance_items ci
      JOIN public.offices o ON o.id = ci.office_id
      WHERE ci.id = clearance_item_id
        AND UPPER(o.code::text) = 'GUIDANCE'
        AND public.is_active_staff_for_office(ci.office_id)
    )
  );

REVOKE ALL ON public.guidance_exit_survey_responses FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.guidance_exit_survey_responses TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_guidance_exit_survey(
  p_clearance_item_id UUID,
  p_response TEXT
)
RETURNS public.guidance_exit_survey_responses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_student_id UUID := auth.uid();
  saved_response public.guidance_exit_survey_responses;
BEGIN
  IF current_student_id IS NULL THEN
    RAISE EXCEPTION 'Sign in before submitting the survey.' USING ERRCODE = '42501';
  END IF;

  IF p_response IS NULL OR char_length(btrim(p_response)) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'Survey response must contain 1 to 2000 characters.' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = current_student_id
      AND UPPER(u.role::text) = 'STUDENT'
      AND UPPER(COALESCE(u.status::text, 'ACTIVE')) = 'ACTIVE'
  ) OR EXISTS (
    SELECT 1 FROM auth.users au
    WHERE au.id = current_student_id AND au.banned_until > NOW()
  ) THEN
    RAISE EXCEPTION 'An active student account is required.' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.clearance_items ci
    JOIN public.clearance_requests cr ON cr.id = ci.clearance_request_id
    JOIN public.clearance_periods cp ON cp.id = cr.clearance_period_id
    JOIN public.offices o ON o.id = ci.office_id
    WHERE ci.id = p_clearance_item_id
      AND UPPER(o.code::text) = 'GUIDANCE'
      AND cp.is_active = TRUE
      AND public.student_can_submit_clearance_item(ci.id)
  ) THEN
    RAISE EXCEPTION 'The Guidance survey is unavailable for this clearance item.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.guidance_exit_survey_responses (clearance_item_id, student_id, response)
  VALUES (p_clearance_item_id, current_student_id, btrim(p_response))
  ON CONFLICT (clearance_item_id) DO UPDATE
    SET response = EXCLUDED.response,
        updated_at = NOW()
    WHERE guidance_exit_survey_responses.student_id = current_student_id
  RETURNING * INTO saved_response;

  IF saved_response.id IS NULL THEN
    RAISE EXCEPTION 'The existing survey response does not belong to this account.' USING ERRCODE = '42501';
  END IF;

  RETURN saved_response;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_guidance_exit_survey(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_guidance_exit_survey(UUID, TEXT) TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
    AND NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'guidance_exit_survey_responses'
    ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.guidance_exit_survey_responses';
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';

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

-- A ban revokes the account in Auth, and the profile status closes the gap
-- for requests made with an access token that has not expired yet.
CREATE OR REPLACE FUNCTION public.student_can_submit_clearance_item(p_item_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.clearance_items ci
    JOIN public.clearance_requests cr ON cr.id = ci.clearance_request_id
    JOIN public.offices o ON o.id = ci.office_id
    JOIN public.users student ON student.id = auth.uid()
    WHERE ci.id = p_item_id
      AND cr.student_id = auth.uid()
      AND UPPER(student.role::text) = 'STUDENT'
      AND UPPER(COALESCE(student.status::text, 'ACTIVE')) = 'ACTIVE'
      AND NOT EXISTS (
        SELECT 1 FROM auth.users au
        WHERE au.id = auth.uid() AND au.banned_until > NOW()
      )
      AND UPPER(COALESCE(ci.status::text, '')) <> 'APPROVED'
      AND (
        o.code::text = 'ACCOUNTING'
        OR EXISTS (
          SELECT 1
          FROM public.clearance_items accounting_item
          JOIN public.offices accounting_office ON accounting_office.id = accounting_item.office_id
          WHERE accounting_item.clearance_request_id = ci.clearance_request_id
            AND accounting_office.code::text = 'ACCOUNTING'
            AND UPPER(COALESCE(accounting_item.status::text, '')) = 'APPROVED'
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.ensure_student_clearance()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id UUID := auth.uid();
  active_period_id UUID;
  request_row_id UUID;
  user_role TEXT;
  user_status TEXT;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Sign in to initialize your clearance.' USING ERRCODE = '42501';
  END IF;

  SELECT UPPER(u.role::text), UPPER(COALESCE(u.status::text, 'ACTIVE'))
  INTO user_role, user_status
  FROM public.users u WHERE u.id = current_user_id;
  IF user_role IS DISTINCT FROM 'STUDENT' OR user_status <> 'ACTIVE'
    OR EXISTS (
      SELECT 1 FROM auth.users au
      WHERE au.id = current_user_id AND au.banned_until > NOW()
    ) THEN
    RAISE EXCEPTION 'Only active student accounts can initialize student clearance.' USING ERRCODE = '42501';
  END IF;

  SELECT cp.id INTO active_period_id
  FROM public.clearance_periods cp
  WHERE cp.is_active = TRUE
  ORDER BY cp.created_at DESC NULLS LAST
  LIMIT 1;
  IF active_period_id IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(current_user_id::text || ':' || active_period_id::text, 0));

  SELECT cr.id INTO request_row_id
  FROM public.clearance_requests cr
  WHERE cr.student_id = current_user_id AND cr.clearance_period_id = active_period_id
  LIMIT 1;

  IF request_row_id IS NULL THEN
    INSERT INTO public.clearance_requests (student_id, clearance_period_id, overall_status)
    VALUES (current_user_id, active_period_id, 'PENDING')
    RETURNING id INTO request_row_id;
  END IF;

  INSERT INTO public.clearance_items (clearance_request_id, office_id)
  SELECT request_row_id, o.id
  FROM public.offices o
  WHERE o.code::text = ANY (ARRAY[
    'ACCOUNTING', 'REGISTRAR', 'DEAN', 'DIRECTOR_SAS', 'GUIDANCE',
    'ADVISER', 'PROPERTY', 'LIBRARIAN', 'COUNCIL', 'CLINIC'
  ])
    AND NOT EXISTS (
      SELECT 1 FROM public.clearance_items ci
      WHERE ci.clearance_request_id = request_row_id AND ci.office_id = o.id
    );

  RETURN request_row_id;
END;
$$;

REVOKE ALL ON FUNCTION public.student_can_submit_clearance_item(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.student_can_submit_clearance_item(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.ensure_student_clearance() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_student_clearance() TO authenticated;

NOTIFY pgrst, 'reload schema';


-- Generic proofs must not inherit the Accounting-only document type. Earlier
-- versions defaulted every proof row to CLEARANCE_PAPER, including unrelated
-- office documents and legacy records.
ALTER TABLE public.clearance_proofs
  ALTER COLUMN document_type DROP DEFAULT;

UPDATE public.clearance_proofs
SET document_type = 'GENERAL'
WHERE UPPER(COALESCE(document_type, '')) = 'CLEARANCE_PAPER'
  AND (file_name IS NULL OR file_name NOT ILIKE 'clearance-paper-%');

CREATE OR REPLACE FUNCTION public.accounting_has_clearance_paper(p_item_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.clearance_proofs proof
    JOIN public.clearance_items item ON item.id = proof.clearance_item_id
    JOIN public.clearance_requests request ON request.id = item.clearance_request_id
    WHERE item.id = p_item_id
      AND proof.student_id = request.student_id
      AND UPPER(COALESCE(proof.document_type, '')) = 'CLEARANCE_PAPER'
      AND lower(COALESCE(proof.file_name, '')) LIKE 'clearance-paper-%'
      AND split_part(COALESCE(proof.storage_path, ''), '/', 1) = proof.student_id::TEXT
      AND split_part(COALESCE(proof.storage_path, ''), '/', 2) = item.id::TEXT
      AND lower(split_part(COALESCE(proof.storage_path, ''), '/', 3)) LIKE '%clearance-paper-%'
  );
$$;

REVOKE ALL ON FUNCTION public.accounting_has_clearance_paper(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accounting_has_clearance_paper(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_accounting_clearance_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF UPPER(COALESCE(NEW.status::TEXT, '')) <> 'APPROVED'
    OR COALESCE(auth.role(), '') = 'service_role'
    OR public.is_clearance_admin() THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.offices office
    WHERE office.id = NEW.office_id AND UPPER(office.code::TEXT) = 'ACCOUNTING'
  ) AND NOT public.accounting_has_clearance_paper(NEW.id) THEN
    RAISE EXCEPTION 'A student-submitted Accounting Clearance Paper is required before approval.'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_accounting_clearance_approval() FROM PUBLIC;
DROP TRIGGER IF EXISTS guard_accounting_clearance_approval ON public.clearance_items;
CREATE TRIGGER guard_accounting_clearance_approval
  BEFORE UPDATE OF status ON public.clearance_items
  FOR EACH ROW
  WHEN (UPPER(COALESCE(NEW.status::TEXT, '')) = 'APPROVED')
  EXECUTE FUNCTION public.guard_accounting_clearance_approval();

CREATE OR REPLACE FUNCTION public.accounting_decide_clearance_item(
  p_item_id UUID,
  p_status TEXT,
  p_remarks TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item_row public.clearance_items%ROWTYPE;
  student_user_id UUID;
  item_status_type TEXT;
  proof_status_type TEXT;
  decision_at TIMESTAMPTZ := NOW();
BEGIN
  IF p_status NOT IN ('APPROVED', 'REJECTED', 'REQUIREMENT_NEEDED') THEN
    RAISE EXCEPTION 'Unsupported Accounting decision.' USING ERRCODE = '22023';
  END IF;
  IF p_status <> 'APPROVED' AND NULLIF(TRIM(p_remarks), '') IS NULL THEN
    RAISE EXCEPTION 'A remark is required when returning or rejecting a clearance paper.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO item_row
  FROM public.clearance_items
  WHERE id = p_item_id
  FOR UPDATE;

  IF item_row.id IS NULL
    OR NOT public.staff_can_access_clearance_item(p_item_id)
    OR NOT EXISTS (
      SELECT 1 FROM public.offices office
      WHERE office.id = item_row.office_id AND UPPER(office.code::TEXT) = 'ACCOUNTING'
    ) THEN
    RAISE EXCEPTION 'This Accounting item is not assigned to your active staff account.' USING ERRCODE = '42501';
  END IF;

  IF p_status = 'APPROVED' AND NOT public.accounting_has_clearance_paper(p_item_id) THEN
    RAISE EXCEPTION 'A student-submitted physical Accounting Clearance Paper is required before approval.' USING ERRCODE = '22023';
  END IF;

  SELECT request.student_id INTO student_user_id
  FROM public.clearance_requests request
  WHERE request.id = item_row.clearance_request_id;

  SELECT format_type(attribute.atttypid, attribute.atttypmod) INTO item_status_type
  FROM pg_attribute attribute
  WHERE attribute.attrelid = 'public.clearance_items'::regclass
    AND attribute.attname = 'status' AND NOT attribute.attisdropped;

  EXECUTE format(
    'UPDATE public.clearance_items
       SET status = $1::%s,
           remarks = COALESCE(
             NULLIF(TRIM($2), ''''),
             CASE WHEN $1 = ''APPROVED''
               THEN ''Physical Clearance Paper verified and approved by Accounting Staff.''
               ELSE NULL
             END
           ),
           balance_amount = CASE WHEN $1 = ''APPROVED'' THEN 0 ELSE balance_amount END,
           verified_by = auth.uid(),
           verified_at = $3,
           updated_at = $3
     WHERE id = $4',
    item_status_type
  ) USING p_status, NULLIF(TRIM(p_remarks), ''), decision_at, p_item_id;

  SELECT format_type(attribute.atttypid, attribute.atttypmod) INTO proof_status_type
  FROM pg_attribute attribute
  WHERE attribute.attrelid = 'public.clearance_proofs'::regclass
    AND attribute.attname = 'status' AND NOT attribute.attisdropped;

  EXECUTE format(
    'UPDATE public.clearance_proofs
       SET status = $1::%s,
           reviewed_by = auth.uid(),
           reviewed_at = $2,
           rejection_reason = CASE WHEN $1 = ''APPROVED'' THEN NULL ELSE $3 END
     WHERE clearance_item_id = $4',
    proof_status_type
  ) USING p_status, decision_at, NULLIF(TRIM(p_remarks), ''), p_item_id;

  IF p_status = 'APPROVED' THEN
    UPDATE public.student_ledgers
    SET tuition_fee = 0,
        lab_fee = 0,
        misc_fee = 0,
        total_balance = 0,
        outstanding_balance = 0,
        required_action = 'NO ACTION REQUIRED'
    WHERE student_id = student_user_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.accounting_decide_clearance_item(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accounting_decide_clearance_item(UUID, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Keep period state aligned with its local calendar window. The app calls the
-- activation function while loading student, staff, and admin period views.
WITH active_periods AS (
  SELECT id,
         ROW_NUMBER() OVER (ORDER BY created_at DESC NULLS LAST, id DESC) AS position
  FROM public.clearance_periods
  WHERE is_active = TRUE
)
UPDATE public.clearance_periods period
SET is_active = FALSE, status = 'CLOSED'
FROM active_periods
WHERE active_periods.id = period.id AND active_periods.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS clearance_periods_single_active_idx
  ON public.clearance_periods (is_active)
  WHERE is_active = TRUE;

CREATE OR REPLACE FUNCTION public.activate_due_clearance_period()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_role TEXT;
  current_user_status TEXT;
  local_today DATE := (NOW() AT TIME ZONE 'Asia/Manila')::DATE;
  active_period_id UUID;
  scheduled_period_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in before loading clearance periods.' USING ERRCODE = '42501';
  END IF;

  SELECT UPPER(user_row.role::TEXT), UPPER(COALESCE(user_row.status::TEXT, 'ACTIVE'))
  INTO current_user_role, current_user_status
  FROM public.users user_row
  WHERE user_row.id = auth.uid();
  IF current_user_role IS NULL
    OR current_user_role NOT IN ('STUDENT', 'STAFF', 'ADMIN')
    OR current_user_status IS DISTINCT FROM 'ACTIVE'
    OR EXISTS (
      SELECT 1 FROM auth.users auth_user
      WHERE auth_user.id = auth.uid() AND auth_user.banned_until > NOW()
    ) THEN
    RAISE EXCEPTION 'An active account is required to load clearance periods.' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(742031);

  UPDATE public.clearance_periods
  SET is_active = FALSE,
      status = CASE WHEN start_date > local_today AND end_date >= local_today THEN 'SCHEDULED' ELSE 'CLOSED' END
  WHERE is_active = TRUE
    AND ((start_date IS NOT NULL AND start_date > local_today)
      OR (end_date IS NOT NULL AND end_date < local_today));

  SELECT period.id INTO active_period_id
  FROM public.clearance_periods period
  WHERE period.is_active = TRUE
  ORDER BY period.created_at DESC NULLS LAST
  LIMIT 1;

  IF active_period_id IS NOT NULL THEN
    RETURN active_period_id;
  END IF;

  SELECT period.id INTO scheduled_period_id
  FROM public.clearance_periods period
  WHERE period.status = 'SCHEDULED'
    AND period.is_active = FALSE
    AND period.start_date <= local_today
    AND period.end_date >= local_today
    AND period.archived_at IS NULL
  ORDER BY period.start_date DESC, period.created_at DESC NULLS LAST
  LIMIT 1
  FOR UPDATE;

  IF scheduled_period_id IS NOT NULL THEN
    UPDATE public.clearance_periods
    SET is_active = TRUE, status = 'ACTIVE'
    WHERE id = scheduled_period_id;
    RETURN scheduled_period_id;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_due_clearance_period() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activate_due_clearance_period() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_open_clearance_period(
  p_title TEXT,
  p_academic_year TEXT,
  p_semester TEXT,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  new_period public.clearance_periods%ROWTYPE;
  created_requests INTEGER := 0;
  local_today DATE := (NOW() AT TIME ZONE 'Asia/Manila')::DATE;
BEGIN
  IF NOT public.is_clearance_admin() THEN
    RAISE EXCEPTION 'Administrator access is required.' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(TRIM(p_title), '') IS NULL OR NULLIF(TRIM(p_academic_year), '') IS NULL THEN
    RAISE EXCEPTION 'Period title and academic year are required.' USING ERRCODE = '22023';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
    RAISE EXCEPTION 'Enter a valid start date and an end date on or after it.' USING ERRCODE = '22023';
  END IF;
  IF p_end_date < local_today THEN
    RAISE EXCEPTION 'The clearance period cannot end before today.' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(742031);

  IF EXISTS (
    SELECT 1 FROM public.clearance_periods existing_period
    WHERE (
        existing_period.status = 'SCHEDULED'
        OR (p_start_date > local_today AND existing_period.is_active = TRUE)
      )
      AND existing_period.archived_at IS NULL
      AND (
        existing_period.start_date IS NULL
        OR existing_period.end_date IS NULL
        OR (existing_period.start_date <= p_end_date AND existing_period.end_date >= p_start_date)
      )
  ) THEN
    RAISE EXCEPTION 'This date range overlaps an active or scheduled clearance period.' USING ERRCODE = '23P01';
  END IF;

  IF p_start_date <= local_today THEN
    UPDATE public.clearance_periods
    SET is_active = FALSE, status = 'CLOSED'
    WHERE is_active = TRUE;
  END IF;

  INSERT INTO public.clearance_periods (title, academic_year, semester, is_active, status, start_date, end_date)
  VALUES (
    TRIM(p_title), TRIM(p_academic_year), p_semester,
    p_start_date <= local_today,
    CASE WHEN p_start_date <= local_today THEN 'ACTIVE' ELSE 'SCHEDULED' END,
    p_start_date, p_end_date
  )
  RETURNING * INTO new_period;

  INSERT INTO public.clearance_requests (student_id, clearance_period_id, overall_status)
  SELECT user_row.id, new_period.id, 'PENDING'
  FROM public.users user_row
  WHERE UPPER(user_row.role::TEXT) = 'STUDENT'
    AND UPPER(COALESCE(user_row.status::TEXT, 'ACTIVE')) = 'ACTIVE';
  GET DIAGNOSTICS created_requests = ROW_COUNT;

  INSERT INTO public.clearance_items (clearance_request_id, office_id)
  SELECT request.id, office.id
  FROM public.clearance_requests request
  JOIN public.users user_row ON user_row.id = request.student_id
  CROSS JOIN public.offices office
  WHERE request.clearance_period_id = new_period.id
    AND UPPER(user_row.role::TEXT) = 'STUDENT'
    AND office.code::TEXT = ANY (ARRAY[
      'ACCOUNTING', 'REGISTRAR', 'DEAN', 'DIRECTOR_SAS', 'GUIDANCE',
      'ADVISER', 'PROPERTY', 'LIBRARIAN', 'COUNCIL', 'CLINIC'
    ])
    AND NOT EXISTS (
      SELECT 1 FROM public.clearance_items item
      WHERE item.clearance_request_id = request.id AND item.office_id = office.id
    );

  RETURN jsonb_build_object('period', to_jsonb(new_period), 'request_count', created_requests);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_clearance_period_state(
  p_period_id UUID,
  p_action TEXT
)
RETURNS public.clearance_periods
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  changed_period public.clearance_periods%ROWTYPE;
  local_today DATE := (NOW() AT TIME ZONE 'Asia/Manila')::DATE;
BEGIN
  IF NOT public.is_clearance_admin() THEN
    RAISE EXCEPTION 'Administrator access is required.' USING ERRCODE = '42501';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('close', 'reopen', 'archive') THEN
    RAISE EXCEPTION 'Unsupported clearance period action.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(742031);

  IF p_action = 'reopen' THEN
    SELECT * INTO changed_period
    FROM public.clearance_periods
    WHERE id = p_period_id
    FOR UPDATE;
    IF changed_period.id IS NULL THEN
      RAISE EXCEPTION 'Clearance period was not found.' USING ERRCODE = 'P0002';
    END IF;
    IF changed_period.start_date IS NULL OR changed_period.end_date IS NULL THEN
      RAISE EXCEPTION 'Set valid start and end dates before reopening this period.' USING ERRCODE = '22023';
    END IF;
    IF changed_period.end_date < local_today THEN
      RAISE EXCEPTION 'The period has expired. Edit its dates before reopening it.' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.clearance_periods other_period
      WHERE other_period.id <> p_period_id
        AND other_period.status = 'SCHEDULED'
        AND other_period.archived_at IS NULL
        AND (
          other_period.start_date IS NULL
          OR other_period.end_date IS NULL
          OR (other_period.start_date <= changed_period.end_date AND other_period.end_date >= changed_period.start_date)
        )
    ) THEN
      RAISE EXCEPTION 'This period overlaps another scheduled period.' USING ERRCODE = '23P01';
    END IF;
    IF changed_period.start_date <= local_today THEN
      UPDATE public.clearance_periods
      SET is_active = FALSE, status = 'CLOSED'
      WHERE is_active = TRUE AND id <> p_period_id;
    END IF;
    UPDATE public.clearance_periods
    SET is_active = (changed_period.start_date <= local_today),
        status = CASE WHEN changed_period.start_date <= local_today THEN 'ACTIVE' ELSE 'SCHEDULED' END,
        archived_at = NULL
    WHERE id = p_period_id
    RETURNING * INTO changed_period;
  ELSIF p_action = 'archive' THEN
    UPDATE public.clearance_periods
    SET is_active = FALSE, status = 'ARCHIVED', archived_at = NOW()
    WHERE id = p_period_id
    RETURNING * INTO changed_period;
  ELSE
    UPDATE public.clearance_periods
    SET is_active = FALSE, status = 'CLOSED'
    WHERE id = p_period_id
    RETURNING * INTO changed_period;
  END IF;

  IF changed_period.id IS NULL THEN
    RAISE EXCEPTION 'Clearance period was not found.' USING ERRCODE = 'P0002';
  END IF;
  RETURN changed_period;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_clearance_period(
  p_period_id UUID,
  p_title TEXT,
  p_academic_year TEXT,
  p_semester TEXT,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS public.clearance_periods
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  period_row public.clearance_periods%ROWTYPE;
  changed_period public.clearance_periods%ROWTYPE;
  local_today DATE := (NOW() AT TIME ZONE 'Asia/Manila')::DATE;
  next_status TEXT;
  next_is_active BOOLEAN;
BEGIN
  IF NOT public.is_clearance_admin() THEN
    RAISE EXCEPTION 'Administrator access is required.' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(TRIM(p_title), '') IS NULL OR NULLIF(TRIM(p_academic_year), '') IS NULL
    OR p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
    RAISE EXCEPTION 'Enter a title, academic year, and a valid date range.' USING ERRCODE = '22023';
  END IF;
  IF p_end_date < local_today THEN
    RAISE EXCEPTION 'The clearance period cannot end before today.' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(742031);
  SELECT * INTO period_row
  FROM public.clearance_periods
  WHERE id = p_period_id
  FOR UPDATE;
  IF period_row.id IS NULL THEN
    RAISE EXCEPTION 'Clearance period was not found.' USING ERRCODE = 'P0002';
  END IF;

  next_status := COALESCE(period_row.status, 'CLOSED');
  next_is_active := period_row.is_active;
  IF period_row.archived_at IS NOT NULL OR next_status = 'ARCHIVED' THEN
    next_status := 'ARCHIVED';
    next_is_active := FALSE;
  ELSIF period_row.is_active OR next_status IN ('ACTIVE', 'SCHEDULED') THEN
    IF EXISTS (
      SELECT 1 FROM public.clearance_periods other_period
      WHERE other_period.id <> p_period_id
        AND (other_period.is_active = TRUE OR other_period.status = 'SCHEDULED')
        AND other_period.archived_at IS NULL
        AND (
          other_period.start_date IS NULL
          OR other_period.end_date IS NULL
          OR (other_period.start_date <= p_end_date AND other_period.end_date >= p_start_date)
        )
    ) THEN
      RAISE EXCEPTION 'This date range overlaps another active or scheduled period.' USING ERRCODE = '23P01';
    END IF;
    IF p_start_date <= local_today THEN
      UPDATE public.clearance_periods
      SET is_active = FALSE, status = 'CLOSED'
      WHERE is_active = TRUE AND id <> p_period_id;
      next_status := 'ACTIVE';
      next_is_active := TRUE;
    ELSE
      next_status := 'SCHEDULED';
      next_is_active := FALSE;
    END IF;
  ELSE
    next_status := 'CLOSED';
    next_is_active := FALSE;
  END IF;

  UPDATE public.clearance_periods
  SET title = TRIM(p_title),
      academic_year = TRIM(p_academic_year),
      semester = p_semester,
      start_date = p_start_date,
      end_date = p_end_date,
      status = next_status,
      is_active = next_is_active
  WHERE id = p_period_id
  RETURNING * INTO changed_period;
  RETURN changed_period;
END;
$$;

-- A due period may be activated by any active app role. Keep this idempotent
-- call ahead of student self-healing request creation.
CREATE OR REPLACE FUNCTION public.ensure_student_clearance()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id UUID := auth.uid();
  active_period_id UUID;
  request_row_id UUID;
  user_role TEXT;
  user_status TEXT;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Sign in to initialize your clearance.' USING ERRCODE = '42501';
  END IF;

  SELECT UPPER(user_row.role::TEXT), UPPER(COALESCE(user_row.status::TEXT, 'ACTIVE'))
  INTO user_role, user_status
  FROM public.users user_row WHERE user_row.id = current_user_id;
  IF user_role IS DISTINCT FROM 'STUDENT' OR user_status <> 'ACTIVE'
    OR EXISTS (
      SELECT 1 FROM auth.users auth_user
      WHERE auth_user.id = current_user_id AND auth_user.banned_until > NOW()
    ) THEN
    RAISE EXCEPTION 'Only active student accounts can initialize student clearance.' USING ERRCODE = '42501';
  END IF;

  PERFORM public.activate_due_clearance_period();
  SELECT period.id INTO active_period_id
  FROM public.clearance_periods period
  WHERE period.is_active = TRUE
    AND (period.start_date IS NULL OR period.start_date <= (NOW() AT TIME ZONE 'Asia/Manila')::DATE)
    AND (period.end_date IS NULL OR period.end_date >= (NOW() AT TIME ZONE 'Asia/Manila')::DATE)
  ORDER BY period.created_at DESC NULLS LAST
  LIMIT 1;
  IF active_period_id IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(current_user_id::TEXT || ':' || active_period_id::TEXT, 0));

  SELECT request.id INTO request_row_id
  FROM public.clearance_requests request
  WHERE request.student_id = current_user_id AND request.clearance_period_id = active_period_id
  LIMIT 1;
  IF request_row_id IS NULL THEN
    INSERT INTO public.clearance_requests (student_id, clearance_period_id, overall_status)
    VALUES (current_user_id, active_period_id, 'PENDING')
    RETURNING id INTO request_row_id;
  END IF;

  INSERT INTO public.clearance_items (clearance_request_id, office_id)
  SELECT request_row_id, office.id
  FROM public.offices office
  WHERE office.code::TEXT = ANY (ARRAY[
    'ACCOUNTING', 'REGISTRAR', 'DEAN', 'DIRECTOR_SAS', 'GUIDANCE',
    'ADVISER', 'PROPERTY', 'LIBRARIAN', 'COUNCIL', 'CLINIC'
  ])
    AND NOT EXISTS (
      SELECT 1 FROM public.clearance_items item
      WHERE item.clearance_request_id = request_row_id AND item.office_id = office.id
    );
  RETURN request_row_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.student_can_submit_clearance_item(p_item_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.clearance_items item
    JOIN public.clearance_requests request ON request.id = item.clearance_request_id
    JOIN public.clearance_periods period ON period.id = request.clearance_period_id
    JOIN public.offices office ON office.id = item.office_id
    JOIN public.users student ON student.id = auth.uid()
    WHERE item.id = p_item_id
      AND request.student_id = auth.uid()
      AND UPPER(student.role::TEXT) = 'STUDENT'
      AND UPPER(COALESCE(student.status::TEXT, 'ACTIVE')) = 'ACTIVE'
      AND NOT EXISTS (
        SELECT 1 FROM auth.users auth_user
        WHERE auth_user.id = auth.uid() AND auth_user.banned_until > NOW()
      )
      AND period.is_active = TRUE
      AND (period.start_date IS NULL OR period.start_date <= (NOW() AT TIME ZONE 'Asia/Manila')::DATE)
      AND (period.end_date IS NULL OR period.end_date >= (NOW() AT TIME ZONE 'Asia/Manila')::DATE)
      AND UPPER(COALESCE(item.status::TEXT, '')) <> 'APPROVED'
      AND (
        office.code::TEXT = 'ACCOUNTING'
        OR EXISTS (
          SELECT 1
          FROM public.clearance_items accounting_item
          JOIN public.offices accounting_office ON accounting_office.id = accounting_item.office_id
          WHERE accounting_item.clearance_request_id = item.clearance_request_id
            AND accounting_office.code::TEXT = 'ACCOUNTING'
            AND UPPER(COALESCE(accounting_item.status::TEXT, '')) = 'APPROVED'
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.admin_open_clearance_period(TEXT, TEXT, TEXT, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_open_clearance_period(TEXT, TEXT, TEXT, DATE, DATE) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_set_clearance_period_state(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_clearance_period_state(UUID, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_update_clearance_period(UUID, TEXT, TEXT, TEXT, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_clearance_period(UUID, TEXT, TEXT, TEXT, DATE, DATE) TO authenticated;
REVOKE ALL ON FUNCTION public.ensure_student_clearance() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_student_clearance() TO authenticated;
REVOKE ALL ON FUNCTION public.student_can_submit_clearance_item(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.student_can_submit_clearance_item(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';


-- Migration mirror: 20261016000006_explicit_accounting_ledger_setup.sql
-- A zero balance means no fees are due only after Accounting has entered or
-- verified the actual fee amounts. New ledgers start unconfigured.
ALTER TABLE public.student_ledgers
  ADD COLUMN IF NOT EXISTS is_configured BOOLEAN NOT NULL DEFAULT FALSE;

DROP POLICY IF EXISTS student_ledgers_accounting_staff_update ON public.student_ledgers;
REVOKE UPDATE ON public.student_ledgers FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ensure_default_student_ledger(p_student_id UUID)
RETURNS public.student_ledgers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ledger_row public.student_ledgers%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_student_id::text || ':ledger', 0));
  SELECT * INTO ledger_row FROM public.student_ledgers
  WHERE student_id = p_student_id ORDER BY created_at DESC NULLS LAST LIMIT 1 FOR UPDATE;

  IF ledger_row.id IS NULL THEN
    INSERT INTO public.student_ledgers (
      student_id, tuition_fee, lab_fee, misc_fee, outstanding_balance,
      total_balance, required_action, is_configured
    ) VALUES (p_student_id, 0, 0, 0, 0, 0, 'LEDGER SETUP REQUIRED', FALSE)
    RETURNING * INTO ledger_row;
  ELSE
    UPDATE public.student_ledgers
    SET total_balance = COALESCE(tuition_fee, 0) + COALESCE(lab_fee, 0) + COALESCE(misc_fee, 0)
    WHERE id = ledger_row.id
    RETURNING * INTO ledger_row;
  END IF;
  RETURN ledger_row;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_default_student_ledger(UUID) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_student_ledger_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT'
    OR NEW.tuition_fee IS DISTINCT FROM OLD.tuition_fee
    OR NEW.lab_fee IS DISTINCT FROM OLD.lab_fee
    OR NEW.misc_fee IS DISTINCT FROM OLD.misc_fee THEN
    NEW.total_balance := COALESCE(NEW.tuition_fee, 0) + COALESCE(NEW.lab_fee, 0) + COALESCE(NEW.misc_fee, 0);
    NEW.outstanding_balance := NEW.total_balance;
    NEW.required_action := CASE WHEN NEW.is_configured THEN CASE WHEN NEW.total_balance = 0 THEN 'NO ACTION REQUIRED' ELSE 'SETTLE PAYMENT' END ELSE 'LEDGER SETUP REQUIRED' END;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.accounting_save_student_ledger(
  p_student_id UUID,
  p_tuition_fee NUMERIC,
  p_lab_fee NUMERIC,
  p_misc_fee NUMERIC,
  p_mark_paid BOOLEAN DEFAULT FALSE
)
RETURNS public.student_ledgers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  accounting_office_id UUID;
  active_period_id UUID;
  active_request_id UUID;
  accounting_item_id UUID;
  next_total NUMERIC(10,2);
  ledger_row public.student_ledgers%ROWTYPE;
  status_type TEXT;
BEGIN
  SELECT o.id INTO accounting_office_id FROM public.offices o WHERE o.code::text = 'ACCOUNTING';
  IF accounting_office_id IS NULL OR NOT public.is_active_staff_for_office(accounting_office_id) THEN
    RAISE EXCEPTION 'An active Accounting staff assignment is required.' USING ERRCODE = '42501';
  END IF;
  IF p_tuition_fee IS NULL OR p_lab_fee IS NULL OR p_misc_fee IS NULL
    OR p_tuition_fee < 0 OR p_lab_fee < 0 OR p_misc_fee < 0 THEN
    RAISE EXCEPTION 'Enter valid fee amounts of zero or more.' USING ERRCODE = '22023';
  END IF;

  SELECT cp.id INTO active_period_id FROM public.clearance_periods cp
  WHERE cp.is_active = TRUE ORDER BY cp.created_at DESC NULLS LAST LIMIT 1;
  IF active_period_id IS NULL THEN RAISE EXCEPTION 'There is no active clearance period.' USING ERRCODE = 'P0002'; END IF;
  SELECT cr.id INTO active_request_id FROM public.clearance_requests cr
  WHERE cr.student_id = p_student_id AND cr.clearance_period_id = active_period_id;
  IF active_request_id IS NULL THEN RAISE EXCEPTION 'This student has no clearance request in the active period.' USING ERRCODE = 'P0002'; END IF;
  SELECT ci.id INTO accounting_item_id FROM public.clearance_items ci
  WHERE ci.clearance_request_id = active_request_id AND ci.office_id = accounting_office_id FOR UPDATE;
  IF accounting_item_id IS NULL THEN RAISE EXCEPTION 'The Accounting clearance item has not been initialized.' USING ERRCODE = 'P0002'; END IF;

  next_total := p_tuition_fee + p_lab_fee + p_misc_fee;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_student_id::text || ':ledger', 0));
  SELECT * INTO ledger_row FROM public.student_ledgers
  WHERE student_id = p_student_id ORDER BY created_at DESC NULLS LAST LIMIT 1 FOR UPDATE;

  IF ledger_row.id IS NULL THEN
    INSERT INTO public.student_ledgers (
      student_id, tuition_fee, lab_fee, misc_fee, total_balance,
      outstanding_balance, required_action, is_configured
    ) VALUES (
      p_student_id, p_tuition_fee, p_lab_fee, p_misc_fee, next_total,
      next_total, CASE WHEN next_total = 0 THEN 'NO ACTION REQUIRED' ELSE 'SETTLE PAYMENT' END, TRUE
    ) RETURNING * INTO ledger_row;
  ELSE
    UPDATE public.student_ledgers
    SET tuition_fee = p_tuition_fee, lab_fee = p_lab_fee, misc_fee = p_misc_fee,
        total_balance = next_total, outstanding_balance = next_total,
        is_configured = TRUE,
        required_action = CASE WHEN next_total = 0 THEN 'NO ACTION REQUIRED' ELSE 'SETTLE PAYMENT' END
    WHERE id = ledger_row.id RETURNING * INTO ledger_row;
  END IF;

  SELECT format_type(a.atttypid, a.atttypmod) INTO status_type
  FROM pg_attribute a
  WHERE a.attrelid = 'public.clearance_items'::regclass AND a.attname = 'status' AND NOT a.attisdropped;
  IF p_mark_paid THEN
    IF next_total <> 0 THEN RAISE EXCEPTION 'Set all fees to zero before marking the ledger fully paid.' USING ERRCODE = '22023'; END IF;
    EXECUTE format(
      'UPDATE public.clearance_items SET balance_amount = 0, status = $1::%s, remarks = $2, processed_by = auth.uid(), processed_at = NOW() WHERE id = $3',
      status_type
    ) USING 'APPROVED', 'Marked fully paid by Accounting ledger editor', accounting_item_id;
  ELSE
    EXECUTE format(
      'UPDATE public.clearance_items SET balance_amount = $1, status = CASE WHEN UPPER(status::text) = ''APPROVED'' AND $1 > 0 THEN $2::%s ELSE status END, remarks = CASE WHEN UPPER(status::text) = ''APPROVED'' AND $1 > 0 THEN ''Balance updated by Accounting; re-approval required'' ELSE remarks END WHERE id = $3',
      status_type
    ) USING next_total, 'PENDING', accounting_item_id;
  END IF;
  RETURN ledger_row;
END;
$$;

REVOKE ALL ON FUNCTION public.accounting_save_student_ledger(UUID, NUMERIC, NUMERIC, NUMERIC, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accounting_save_student_ledger(UUID, NUMERIC, NUMERIC, NUMERIC, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_accounting_clearance_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  student_user_id UUID;
BEGIN
  IF UPPER(COALESCE(NEW.status::TEXT, '')) <> 'APPROVED'
    OR COALESCE(auth.role(), '') = 'service_role'
    OR public.is_clearance_admin() THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM public.offices office WHERE office.id = NEW.office_id AND UPPER(office.code::TEXT) = 'ACCOUNTING') THEN
    IF NOT public.accounting_has_clearance_paper(NEW.id) THEN
      RAISE EXCEPTION 'A student-submitted Accounting Clearance Paper is required before approval.' USING ERRCODE = '22023';
    END IF;
    SELECT request.student_id INTO student_user_id FROM public.clearance_requests request WHERE request.id = NEW.clearance_request_id;
    IF NOT EXISTS (SELECT 1 FROM public.student_ledgers ledger WHERE ledger.student_id = student_user_id AND ledger.is_configured) THEN
      RAISE EXCEPTION 'Accounting must configure the actual fee ledger before approval.' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.accounting_decide_clearance_item(
  p_item_id UUID,
  p_status TEXT,
  p_remarks TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item_row public.clearance_items%ROWTYPE;
  student_user_id UUID;
  item_status_type TEXT;
  proof_status_type TEXT;
  decision_at TIMESTAMPTZ := NOW();
BEGIN
  IF p_status NOT IN ('APPROVED', 'REJECTED', 'REQUIREMENT_NEEDED') THEN
    RAISE EXCEPTION 'Unsupported Accounting decision.' USING ERRCODE = '22023';
  END IF;
  IF p_status <> 'APPROVED' AND NULLIF(TRIM(p_remarks), '') IS NULL THEN
    RAISE EXCEPTION 'A remark is required when returning or rejecting a clearance paper.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO item_row FROM public.clearance_items WHERE id = p_item_id FOR UPDATE;
  IF item_row.id IS NULL OR NOT public.staff_can_access_clearance_item(p_item_id)
    OR NOT EXISTS (SELECT 1 FROM public.offices office WHERE office.id = item_row.office_id AND UPPER(office.code::TEXT) = 'ACCOUNTING') THEN
    RAISE EXCEPTION 'This Accounting item is not assigned to your active staff account.' USING ERRCODE = '42501';
  END IF;
  IF p_status = 'APPROVED' AND NOT public.accounting_has_clearance_paper(p_item_id) THEN
    RAISE EXCEPTION 'A student-submitted physical Accounting Clearance Paper is required before approval.' USING ERRCODE = '22023';
  END IF;
  SELECT request.student_id INTO student_user_id FROM public.clearance_requests request WHERE request.id = item_row.clearance_request_id;
  IF p_status = 'APPROVED' AND NOT EXISTS (
    SELECT 1 FROM public.student_ledgers ledger WHERE ledger.student_id = student_user_id AND ledger.is_configured
  ) THEN
    RAISE EXCEPTION 'Accounting must configure the actual fee ledger before approval.' USING ERRCODE = '22023';
  END IF;

  SELECT format_type(attribute.atttypid, attribute.atttypmod) INTO item_status_type
  FROM pg_attribute attribute WHERE attribute.attrelid = 'public.clearance_items'::regclass
    AND attribute.attname = 'status' AND NOT attribute.attisdropped;
  EXECUTE format(
    'UPDATE public.clearance_items SET status = $1::%s,
       remarks = COALESCE(NULLIF(TRIM($2), ''''), CASE WHEN $1 = ''APPROVED'' THEN ''Physical Clearance Paper verified and approved by Accounting Staff.'' ELSE NULL END),
       balance_amount = CASE WHEN $1 = ''APPROVED'' THEN 0 ELSE balance_amount END,
       verified_by = auth.uid(), verified_at = $3, updated_at = $3 WHERE id = $4', item_status_type
  ) USING p_status, NULLIF(TRIM(p_remarks), ''), decision_at, p_item_id;

  SELECT format_type(attribute.atttypid, attribute.atttypmod) INTO proof_status_type
  FROM pg_attribute attribute WHERE attribute.attrelid = 'public.clearance_proofs'::regclass
    AND attribute.attname = 'status' AND NOT attribute.attisdropped;
  EXECUTE format(
    'UPDATE public.clearance_proofs SET status = $1::%s, reviewed_by = auth.uid(), reviewed_at = $2,
       rejection_reason = CASE WHEN $1 = ''APPROVED'' THEN NULL ELSE $3 END WHERE clearance_item_id = $4', proof_status_type
  ) USING p_status, decision_at, NULLIF(TRIM(p_remarks), ''), p_item_id;

  IF p_status = 'APPROVED' THEN
    UPDATE public.student_ledgers
    SET tuition_fee = 0, lab_fee = 0, misc_fee = 0, total_balance = 0,
        outstanding_balance = 0, required_action = 'NO ACTION REQUIRED', is_configured = TRUE
    WHERE student_id = student_user_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.accounting_decide_clearance_item(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accounting_decide_clearance_item(UUID, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';


-- Migration mirror: 20261016000007_rpc_only_clearance_item_updates.sql
-- Keep clearance decisions and student submissions inside narrow RPCs. Direct
-- table updates could otherwise bypass the office workflow and audit fields.
REVOKE UPDATE ON public.clearance_items FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS clearance_items_student_submit_unlocked ON public.clearance_items;
DROP POLICY IF EXISTS clearance_items_assigned_staff_update ON public.clearance_items;

CREATE OR REPLACE FUNCTION public.student_mark_clearance_item_submitted(p_item_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_student_id UUID := auth.uid();
  item_row public.clearance_items%ROWTYPE;
  office_code TEXT;
  item_status_type TEXT;
BEGIN
  IF current_student_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = current_student_id
      AND UPPER(u.role::text) = 'STUDENT'
      AND UPPER(COALESCE(u.status::text, 'ACTIVE')) = 'ACTIVE'
  ) OR EXISTS (
    SELECT 1 FROM auth.users au WHERE au.id = current_student_id AND au.banned_until > NOW()
  ) THEN
    RAISE EXCEPTION 'An active student account is required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO item_row FROM public.clearance_items WHERE id = p_item_id FOR UPDATE;
  IF item_row.id IS NULL OR NOT public.student_can_submit_clearance_item(p_item_id) THEN
    RAISE EXCEPTION 'This clearance item is unavailable for submission.' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.clearance_proofs proof
    WHERE proof.clearance_item_id = p_item_id AND proof.student_id = current_student_id
  ) THEN
    RAISE EXCEPTION 'Upload a proof document before submitting this clearance item.' USING ERRCODE = '22023';
  END IF;

  SELECT UPPER(o.code::text) INTO office_code FROM public.offices o WHERE o.id = item_row.office_id;
  IF office_code = 'ACCOUNTING' AND NOT public.accounting_has_clearance_paper(p_item_id) THEN
    RAISE EXCEPTION 'A valid Accounting Clearance Paper upload is required.' USING ERRCODE = '22023';
  END IF;

  SELECT format_type(a.atttypid, a.atttypmod) INTO item_status_type
  FROM pg_attribute a
  WHERE a.attrelid = 'public.clearance_items'::regclass AND a.attname = 'status' AND NOT a.attisdropped;
  EXECUTE format(
    'UPDATE public.clearance_items SET status = $1::%s, remarks = NULL, updated_at = NOW() WHERE id = $2',
    item_status_type
  ) USING 'SUBMITTED', p_item_id;
END;
$$;

REVOKE ALL ON FUNCTION public.student_mark_clearance_item_submitted(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_mark_clearance_item_submitted(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';


-- Migration mirror: 20261016000008_rpc_only_proof_review.sql
-- Student uploads are INSERT-only; staff proof review is committed in the
-- same transaction as the clearance-item decision RPC.
REVOKE UPDATE ON public.clearance_proofs FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS clearance_proofs_assigned_staff_review_update ON public.clearance_proofs;

CREATE OR REPLACE FUNCTION public.staff_decide_clearance_items(
  p_item_ids UUID[],
  p_status TEXT,
  p_remarks TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item_id UUID;
  item_row public.clearance_items%ROWTYPE;
  item_status_type TEXT;
  proof_status_type TEXT;
  decision_at TIMESTAMPTZ := NOW();
  changed_count INTEGER := 0;
BEGIN
  IF COALESCE(array_length(p_item_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Select at least one clearance item.' USING ERRCODE = '22023';
  END IF;
  IF p_status NOT IN ('APPROVED', 'REQUIREMENT_NEEDED') THEN
    RAISE EXCEPTION 'Staff may approve an item or return it as requirement needed.' USING ERRCODE = '22023';
  END IF;
  IF p_status = 'REQUIREMENT_NEEDED' AND NULLIF(TRIM(p_remarks), '') IS NULL THEN
    RAISE EXCEPTION 'A deficiency remark is required.' USING ERRCODE = '22023';
  END IF;

  SELECT format_type(a.atttypid, a.atttypmod) INTO item_status_type
  FROM pg_attribute a
  WHERE a.attrelid = 'public.clearance_items'::regclass AND a.attname = 'status' AND NOT a.attisdropped;
  SELECT format_type(a.atttypid, a.atttypmod) INTO proof_status_type
  FROM pg_attribute a
  WHERE a.attrelid = 'public.clearance_proofs'::regclass AND a.attname = 'status' AND NOT a.attisdropped;

  FOREACH item_id IN ARRAY p_item_ids LOOP
    SELECT * INTO item_row FROM public.clearance_items WHERE id = item_id FOR UPDATE;
    IF item_row.id IS NULL OR NOT public.staff_can_access_clearance_item(item_id) THEN
      RAISE EXCEPTION 'A selected item is outside your assigned office or Accounting has not approved it.' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM public.offices o WHERE o.id = item_row.office_id AND UPPER(o.code::text) = 'ACCOUNTING') THEN
      RAISE EXCEPTION 'Accounting decisions must use the Accounting verification workflow.' USING ERRCODE = '42501';
    END IF;
    IF p_status = 'APPROVED' AND NOT EXISTS (
      SELECT 1 FROM public.clearance_proofs proof WHERE proof.clearance_item_id = item_id
    ) THEN
      RAISE EXCEPTION 'A student proof document is required before approval.' USING ERRCODE = '22023';
    END IF;

    EXECUTE format(
      'UPDATE public.clearance_items SET status = $1::%s, remarks = $2, processed_by = auth.uid(), processed_at = $3, updated_at = $3 WHERE id = $4',
      item_status_type
    ) USING p_status, NULLIF(TRIM(p_remarks), ''), decision_at, item_id;
    EXECUTE format(
      'UPDATE public.clearance_proofs SET status = $1::%s, reviewed_by = auth.uid(), reviewed_at = $2,
         rejection_reason = CASE WHEN $1 = ''APPROVED'' THEN NULL ELSE $3 END WHERE clearance_item_id = $4',
      proof_status_type
    ) USING p_status, decision_at, NULLIF(TRIM(p_remarks), ''), item_id;
    changed_count := changed_count + 1;
  END LOOP;
  RETURN changed_count;
END;
$$;

REVOKE ALL ON FUNCTION public.staff_decide_clearance_items(UUID[], TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_decide_clearance_items(UUID[], TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
