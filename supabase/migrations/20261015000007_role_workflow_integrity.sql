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
