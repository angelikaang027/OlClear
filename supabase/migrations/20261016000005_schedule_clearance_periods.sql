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
