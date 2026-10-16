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
