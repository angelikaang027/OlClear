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
