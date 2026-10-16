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
