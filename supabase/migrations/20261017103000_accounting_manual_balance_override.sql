-- Allow Accounting staff to save a manual outstanding balance even when a
-- student has no ledger row yet. Fee component amounts are kept unchanged.
CREATE OR REPLACE FUNCTION public.accounting_adjust_clearance_balance(
  p_item_id UUID,
  p_balance NUMERIC,
  p_receipt_number TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  item_row public.clearance_items%ROWTYPE;
  student_user_id UUID;
  ledger_id UUID;
  status_type TEXT;
BEGIN
  IF p_balance IS NULL OR p_balance < 0 THEN
    RAISE EXCEPTION 'Enter a valid balance of zero or more.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO item_row
  FROM public.clearance_items
  WHERE id = p_item_id
  FOR UPDATE;

  IF item_row.id IS NULL OR NOT public.staff_can_access_clearance_item(p_item_id) THEN
    RAISE EXCEPTION 'An active Accounting assignment is required to adjust this balance.' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.offices office
    WHERE office.id = item_row.office_id
      AND UPPER(office.code::TEXT) = 'ACCOUNTING'
  ) THEN
    RAISE EXCEPTION 'Only Accounting clearance balances can be adjusted here.' USING ERRCODE = '42501';
  END IF;

  SELECT request.student_id
  INTO student_user_id
  FROM public.clearance_requests request
  WHERE request.id = COALESCE(item_row.clearance_request_id, item_row.request_id);

  IF student_user_id IS NULL THEN
    RAISE EXCEPTION 'The student for this Accounting item could not be found.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(student_user_id::TEXT || ':ledger', 0));
  SELECT ledger.id INTO ledger_id
  FROM public.student_ledgers ledger
  WHERE ledger.student_id = student_user_id
  ORDER BY ledger.created_at DESC NULLS LAST
  LIMIT 1
  FOR UPDATE;

  IF ledger_id IS NULL THEN
    INSERT INTO public.student_ledgers (
      student_id, total_balance, outstanding_balance, required_action,
      official_receipt_number, is_configured
    ) VALUES (
      student_user_id, p_balance, p_balance,
      CASE WHEN p_balance = 0 THEN 'NO ACTION REQUIRED' ELSE 'SETTLE PAYMENT' END,
      NULLIF(TRIM(p_receipt_number), ''), TRUE
    );
  ELSE
    UPDATE public.student_ledgers
    SET total_balance = p_balance,
        outstanding_balance = p_balance,
        required_action = CASE WHEN p_balance = 0 THEN 'NO ACTION REQUIRED' ELSE 'SETTLE PAYMENT' END,
        official_receipt_number = NULLIF(TRIM(p_receipt_number), ''),
        is_configured = TRUE,
        updated_at = NOW()
    WHERE id = ledger_id;
  END IF;

  SELECT format_type(attribute.atttypid, attribute.atttypmod)
  INTO status_type
  FROM pg_catalog.pg_attribute attribute
  WHERE attribute.attrelid = 'public.clearance_items'::regclass
    AND attribute.attname = 'status'
    AND NOT attribute.attisdropped;

  EXECUTE format(
    'UPDATE public.clearance_items SET balance_amount = $1, official_receipt_number = $2,
       processed_by = auth.uid(), processed_at = NOW(),
       status = CASE WHEN UPPER(status::text) = ''APPROVED'' AND $1 > 0 THEN $3::%s ELSE status END
     WHERE id = $4',
    status_type
  ) USING p_balance, NULLIF(TRIM(p_receipt_number), ''), 'PENDING', p_item_id;
END;
$$;

REVOKE ALL ON FUNCTION public.accounting_adjust_clearance_balance(UUID, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accounting_adjust_clearance_balance(UUID, NUMERIC, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
