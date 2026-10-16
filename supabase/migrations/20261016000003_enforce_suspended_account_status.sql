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
