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
