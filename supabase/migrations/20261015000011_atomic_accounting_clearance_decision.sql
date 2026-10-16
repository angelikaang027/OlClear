-- Keep Accounting approval/rejection, proof review, and ledger balance atomic.

ALTER TABLE public.clearance_proofs
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS document_type TEXT DEFAULT 'CLEARANCE_PAPER',
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

ALTER TABLE public.clearance_items
  ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

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
      SELECT 1 FROM public.offices o
      WHERE o.id = item_row.office_id AND UPPER(o.code::text) = 'ACCOUNTING'
    ) THEN
    RAISE EXCEPTION 'This Accounting item is not assigned to your active staff account.' USING ERRCODE = '42501';
  END IF;

  IF p_status = 'APPROVED' AND NOT EXISTS (
    SELECT 1 FROM public.clearance_proofs proof
    WHERE proof.clearance_item_id = p_item_id
      AND UPPER(COALESCE(proof.document_type, 'CLEARANCE_PAPER')) = 'CLEARANCE_PAPER'
  ) THEN
    RAISE EXCEPTION 'A submitted physical Accounting Clearance Paper is required before approval.' USING ERRCODE = '22023';
  END IF;

  SELECT cr.student_id INTO student_user_id
  FROM public.clearance_requests cr
  WHERE cr.id = item_row.clearance_request_id;

  SELECT format_type(a.atttypid, a.atttypmod) INTO item_status_type
  FROM pg_attribute a
  WHERE a.attrelid = 'public.clearance_items'::regclass
    AND a.attname = 'status' AND NOT a.attisdropped;

  EXECUTE format(
    'UPDATE public.clearance_items
       SET status = $1::%s,
           remarks = COALESCE(
             NULLIF(TRIM($2), ''),
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

  SELECT format_type(a.atttypid, a.atttypmod) INTO proof_status_type
  FROM pg_attribute a
  WHERE a.attrelid = 'public.clearance_proofs'::regclass
    AND a.attname = 'status' AND NOT a.attisdropped;

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
