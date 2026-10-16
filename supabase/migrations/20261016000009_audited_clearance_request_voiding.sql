-- Keep cancelled requests for audit and prevent student self-initialization
-- from silently recreating a request that an administrator has voided.
ALTER TABLE public.clearance_requests
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS void_reason TEXT;
ALTER TABLE public.clearance_requests
  ALTER COLUMN overall_status TYPE TEXT USING overall_status::TEXT;

CREATE TABLE IF NOT EXISTS public.clearance_request_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clearance_request_id UUID REFERENCES public.clearance_requests(id) ON DELETE SET NULL,
  student_id UUID NOT NULL,
  actor_id UUID NOT NULL,
  previous_status TEXT NOT NULL,
  new_status TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.clearance_request_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS clearance_request_events_admin_read ON public.clearance_request_events;
CREATE POLICY clearance_request_events_admin_read ON public.clearance_request_events
  FOR SELECT TO authenticated USING (public.is_clearance_admin());
REVOKE ALL ON public.clearance_request_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.clearance_request_events TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_clearance_request_void_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.role(), '') = 'service_role' OR auth.uid() IS NULL
    OR NOT ((UPPER(COALESCE(OLD.overall_status, '')) = 'VOIDED') <> (UPPER(COALESCE(NEW.overall_status, '')) = 'VOIDED')) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.clearance_request_events request_event
    WHERE request_event.clearance_request_id = NEW.id
      AND request_event.actor_id = auth.uid()
      AND request_event.previous_status = COALESCE(OLD.overall_status, 'PENDING')
      AND request_event.new_status = NEW.overall_status
  ) THEN
    RAISE EXCEPTION 'Void and restore actions must use the audited administrator workflow.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_clearance_request_void_audit ON public.clearance_requests;
CREATE TRIGGER guard_clearance_request_void_audit
BEFORE UPDATE OF overall_status ON public.clearance_requests
FOR EACH ROW EXECUTE FUNCTION public.guard_clearance_request_void_audit();
REVOKE ALL ON FUNCTION public.guard_clearance_request_void_audit() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_clearance_request_voided(
  p_request_id UUID,
  p_voided BOOLEAN,
  p_reason TEXT DEFAULT NULL
)
RETURNS public.clearance_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  request_row public.clearance_requests%ROWTYPE;
  previous_status TEXT;
  next_status TEXT;
  office_count INTEGER;
  approved_count INTEGER;
  normalized_reason TEXT := NULLIF(BTRIM(p_reason), '');
BEGIN
  IF NOT public.is_clearance_admin() THEN
    RAISE EXCEPTION 'Administrator access is required.' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL OR p_voided IS NULL THEN
    RAISE EXCEPTION 'Choose a clearance request and action.' USING ERRCODE = '22023';
  END IF;
  IF p_voided AND normalized_reason IS NULL THEN
    RAISE EXCEPTION 'A reason is required to void a clearance request.' USING ERRCODE = '22023';
  END IF;
  IF normalized_reason IS NOT NULL AND CHAR_LENGTH(normalized_reason) > 2000 THEN
    RAISE EXCEPTION 'The reason must be 2000 characters or fewer.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO request_row FROM public.clearance_requests
  WHERE id = p_request_id FOR UPDATE;
  IF request_row.id IS NULL THEN
    RAISE EXCEPTION 'Clearance request not found.' USING ERRCODE = 'P0002';
  END IF;
  IF (request_row.overall_status = 'VOIDED') = p_voided THEN
    RETURN request_row;
  END IF;
  previous_status := COALESCE(request_row.overall_status, 'PENDING');

  IF p_voided THEN
    INSERT INTO public.clearance_request_events
      (clearance_request_id, student_id, actor_id, previous_status, new_status, reason)
    VALUES
      (request_row.id, request_row.student_id, auth.uid(), previous_status, 'VOIDED', normalized_reason);
    UPDATE public.clearance_requests
    SET overall_status = 'VOIDED', voided_at = NOW(), voided_by = auth.uid(), void_reason = normalized_reason
    WHERE id = p_request_id RETURNING * INTO request_row;
  ELSE
    SELECT COUNT(*), COUNT(*) FILTER (WHERE UPPER(item.status::TEXT) = 'APPROVED')
    INTO office_count, approved_count
    FROM public.clearance_items item
    JOIN public.offices office ON office.id = item.office_id
    WHERE item.clearance_request_id = p_request_id
      AND UPPER(office.code::TEXT) = ANY (ARRAY[
        'ACCOUNTING', 'REGISTRAR', 'DEAN', 'DIRECTOR_SAS', 'GUIDANCE',
        'ADVISER', 'PROPERTY', 'LIBRARIAN', 'COUNCIL', 'CLINIC'
      ]);
    next_status := CASE WHEN office_count = 10 AND approved_count = 10 THEN 'APPROVED' ELSE 'IN_PROGRESS' END;
    INSERT INTO public.clearance_request_events
      (clearance_request_id, student_id, actor_id, previous_status, new_status, reason)
    VALUES
      (request_row.id, request_row.student_id, auth.uid(), 'VOIDED', next_status,
       COALESCE(normalized_reason, 'Administrator restored the request.'));
    UPDATE public.clearance_requests
    SET overall_status = next_status,
        voided_at = NULL,
        voided_by = NULL,
        void_reason = NULL,
        completion_date = CASE WHEN next_status = 'APPROVED' THEN COALESCE(completion_date, NOW()) ELSE NULL END,
        qr_code_token = CASE WHEN next_status = 'APPROVED' THEN COALESCE(qr_code_token, gen_random_uuid()::TEXT) ELSE NULL END
    WHERE id = p_request_id RETURNING * INTO request_row;
  END IF;
  RETURN request_row;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_clearance_request_voided(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_clearance_request_voided(UUID, BOOLEAN, TEXT) TO authenticated;

-- Students should not be able to read or submit against voided requests.
DROP POLICY IF EXISTS clearance_requests_student_read_self ON public.clearance_requests;
CREATE POLICY clearance_requests_student_read_self ON public.clearance_requests
  FOR SELECT TO authenticated
  USING (student_id = auth.uid() AND UPPER(COALESCE(overall_status, '')) <> 'VOIDED');

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
  request_status TEXT;
  user_role TEXT;
  user_status TEXT;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Sign in to initialize your clearance.' USING ERRCODE = '42501';
  END IF;
  SELECT UPPER(user_row.role::TEXT), UPPER(COALESCE(user_row.status::TEXT, 'ACTIVE'))
  INTO user_role, user_status FROM public.users user_row WHERE user_row.id = current_user_id;
  IF user_role IS DISTINCT FROM 'STUDENT' OR user_status <> 'ACTIVE'
    OR EXISTS (SELECT 1 FROM auth.users auth_user WHERE auth_user.id = current_user_id AND auth_user.banned_until > NOW()) THEN
    RAISE EXCEPTION 'Only active student accounts can initialize student clearance.' USING ERRCODE = '42501';
  END IF;

  PERFORM public.activate_due_clearance_period();
  SELECT period.id INTO active_period_id FROM public.clearance_periods period
  WHERE period.is_active = TRUE
    AND (period.start_date IS NULL OR period.start_date <= (NOW() AT TIME ZONE 'Asia/Manila')::DATE)
    AND (period.end_date IS NULL OR period.end_date >= (NOW() AT TIME ZONE 'Asia/Manila')::DATE)
  ORDER BY period.created_at DESC NULLS LAST LIMIT 1;
  IF active_period_id IS NULL THEN RETURN NULL; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(current_user_id::TEXT || ':' || active_period_id::TEXT, 0));
  SELECT request.id, UPPER(COALESCE(request.overall_status, ''))
  INTO request_row_id, request_status
  FROM public.clearance_requests request
  WHERE request.student_id = current_user_id AND request.clearance_period_id = active_period_id
  ORDER BY request.created_at DESC NULLS LAST LIMIT 1;
  IF request_status = 'VOIDED' THEN RETURN NULL; END IF;
  IF request_row_id IS NULL THEN
    INSERT INTO public.clearance_requests (student_id, clearance_period_id, overall_status)
    VALUES (current_user_id, active_period_id, 'PENDING') RETURNING id INTO request_row_id;
  END IF;

  INSERT INTO public.clearance_items (clearance_request_id, office_id)
  SELECT request_row_id, office.id FROM public.offices office
  WHERE office.code::TEXT = ANY (ARRAY[
    'ACCOUNTING', 'REGISTRAR', 'DEAN', 'DIRECTOR_SAS', 'GUIDANCE',
    'ADVISER', 'PROPERTY', 'LIBRARIAN', 'COUNCIL', 'CLINIC'
  ]) AND NOT EXISTS (
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
    SELECT 1 FROM public.clearance_items item
    JOIN public.clearance_requests request ON request.id = item.clearance_request_id
    JOIN public.clearance_periods period ON period.id = request.clearance_period_id
    JOIN public.offices office ON office.id = item.office_id
    JOIN public.users student ON student.id = auth.uid()
    WHERE item.id = p_item_id AND request.student_id = auth.uid()
      AND UPPER(COALESCE(request.overall_status, '')) <> 'VOIDED'
      AND UPPER(student.role::TEXT) = 'STUDENT'
      AND UPPER(COALESCE(student.status::TEXT, 'ACTIVE')) = 'ACTIVE'
      AND NOT EXISTS (SELECT 1 FROM auth.users auth_user WHERE auth_user.id = auth.uid() AND auth_user.banned_until > NOW())
      AND period.is_active = TRUE
      AND (period.start_date IS NULL OR period.start_date <= (NOW() AT TIME ZONE 'Asia/Manila')::DATE)
      AND (period.end_date IS NULL OR period.end_date >= (NOW() AT TIME ZONE 'Asia/Manila')::DATE)
      AND UPPER(COALESCE(item.status::TEXT, '')) <> 'APPROVED'
      AND (office.code::TEXT = 'ACCOUNTING' OR EXISTS (
        SELECT 1 FROM public.clearance_items accounting_item
        JOIN public.offices accounting_office ON accounting_office.id = accounting_item.office_id
        WHERE accounting_item.clearance_request_id = item.clearance_request_id
          AND accounting_office.code::TEXT = 'ACCOUNTING'
          AND UPPER(COALESCE(accounting_item.status::TEXT, '')) = 'APPROVED'
      ))
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
    SELECT 1 FROM public.clearance_items item
    JOIN public.clearance_requests request ON request.id = item.clearance_request_id
    WHERE item.id = p_item_id AND UPPER(COALESCE(request.overall_status, '')) <> 'VOIDED'
      AND (
        public.is_clearance_admin()
        OR (public.is_active_staff_for_office(item.office_id) AND (
          EXISTS (SELECT 1 FROM public.offices office WHERE office.id = item.office_id AND UPPER(office.code::TEXT) = 'ACCOUNTING')
          OR EXISTS (
            SELECT 1 FROM public.clearance_items accounting_item
            JOIN public.offices accounting_office ON accounting_office.id = accounting_item.office_id
            WHERE accounting_item.clearance_request_id = item.clearance_request_id
              AND UPPER(accounting_office.code::TEXT) = 'ACCOUNTING'
              AND UPPER(COALESCE(accounting_item.status::TEXT, '')) = 'APPROVED'
          )
        ))
      )
  );
$$;

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
  IF NOT public.is_clearance_admin() THEN RAISE EXCEPTION 'Administrator access is required.' USING ERRCODE = '42501'; END IF;
  IF NULLIF(TRIM(p_reason), '') IS NULL THEN RAISE EXCEPTION 'An override reason is required.' USING ERRCODE = '22023'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('PENDING', 'SUBMITTED', 'IN_PROGRESS', 'APPROVED', 'HOLD', 'REJECTED', 'REQUIREMENT_NEEDED') THEN
    RAISE EXCEPTION 'Unsupported clearance status.' USING ERRCODE = '22023';
  END IF;
  SELECT item.* INTO item_row FROM public.clearance_items item WHERE item.id = p_item_id FOR UPDATE;
  IF item_row.id IS NULL THEN RAISE EXCEPTION 'Clearance item not found.' USING ERRCODE = 'P0002'; END IF;
  IF EXISTS (SELECT 1 FROM public.clearance_requests request WHERE request.id = item_row.clearance_request_id AND UPPER(COALESCE(request.overall_status, '')) = 'VOIDED') THEN
    RAISE EXCEPTION 'Restore the clearance request before changing an office status.' USING ERRCODE = '22023';
  END IF;
  SELECT format_type(attribute.atttypid, attribute.atttypmod) INTO status_type
  FROM pg_attribute attribute WHERE attribute.attrelid = 'public.clearance_items'::regclass
    AND attribute.attname = 'status' AND NOT attribute.attisdropped;
  EXECUTE format('UPDATE public.clearance_items SET status = $1::%s, remarks = $2 WHERE id = $3', status_type)
    USING p_status, '[ADMIN OVERRIDE] ' || TRIM(p_reason), p_item_id;
  INSERT INTO public.audit_logs (admin_id, student_id, office_id, clearance_item_id, previous_status, new_status, override_reason)
  SELECT auth.uid(), request.student_id, item_row.office_id, item_row.id, item_row.status::TEXT, p_status, TRIM(p_reason)
  FROM public.clearance_requests request WHERE request.id = item_row.clearance_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_student_clearance() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_student_clearance() TO authenticated;
REVOKE ALL ON FUNCTION public.student_can_submit_clearance_item(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.student_can_submit_clearance_item(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.staff_can_access_clearance_item(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_can_access_clearance_item(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_override_clearance_item(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_override_clearance_item(UUID, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
