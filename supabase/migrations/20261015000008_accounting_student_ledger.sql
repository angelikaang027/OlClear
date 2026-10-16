-- Default Accounting ledgers, accounting office editor RPC, and student ledger realtime.

ALTER TABLE public.student_ledgers
  ADD COLUMN IF NOT EXISTS total_balance NUMERIC(10,2) NOT NULL DEFAULT 0.00;

-- Serialize creation by student so signup and clearance initialization can race safely.
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
      total_balance, required_action
    ) VALUES (p_student_id, 0, 0, 0, 0, 0, 'LEDGER SETUP REQUIRED')
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

-- Signup path: the profile upsert inserts into public.users after Auth signup.
CREATE OR REPLACE FUNCTION public.create_student_ledger_after_profile_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF UPPER(NEW.role::text) = 'STUDENT' THEN
    PERFORM public.ensure_default_student_ledger(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS create_student_ledger_after_profile_insert ON public.users;
CREATE TRIGGER create_student_ledger_after_profile_insert
AFTER INSERT ON public.users
FOR EACH ROW EXECUTE FUNCTION public.create_student_ledger_after_profile_insert();

-- Clearance item creation path: make sure a ledger exists and copy its balance
-- into the student's Accounting item, including when a new term is initialized.
CREATE OR REPLACE FUNCTION public.initialize_accounting_item_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  student_user_id UUID;
  ledger_row public.student_ledgers%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.offices o WHERE o.id = NEW.office_id AND o.code::text = 'ACCOUNTING') THEN
    RETURN NEW;
  END IF;

  SELECT cr.student_id INTO student_user_id
  FROM public.clearance_requests cr WHERE cr.id = NEW.clearance_request_id;
  IF student_user_id IS NULL THEN RETURN NEW; END IF;

  PERFORM public.ensure_default_student_ledger(student_user_id);
  SELECT * INTO ledger_row FROM public.student_ledgers
  WHERE student_id = student_user_id ORDER BY created_at DESC NULLS LAST LIMIT 1;

  NEW.balance_amount := CASE WHEN UPPER(NEW.status::text) = 'APPROVED' THEN 0 ELSE ledger_row.outstanding_balance END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS initialize_accounting_item_balance ON public.clearance_items;
CREATE TRIGGER initialize_accounting_item_balance
BEFORE INSERT ON public.clearance_items
FOR EACH ROW EXECUTE FUNCTION public.initialize_accounting_item_balance();

-- Backfill students already registered before these triggers were installed.
DO $$
DECLARE student_row RECORD;
BEGIN
  FOR student_row IN
    SELECT u.id FROM public.users u WHERE UPPER(u.role::text) = 'STUDENT'
  LOOP
    PERFORM public.ensure_default_student_ledger(student_row.id);
  END LOOP;
END;
$$;

UPDATE public.clearance_items ci
SET balance_amount = CASE WHEN UPPER(ci.status::text) = 'APPROVED' THEN 0 ELSE sl.outstanding_balance END
FROM public.clearance_requests cr
JOIN public.student_ledgers sl ON sl.student_id = cr.student_id
JOIN public.offices o ON o.code::text = 'ACCOUNTING'
WHERE ci.clearance_request_id = cr.id
  AND ci.office_id = o.id;

-- Admin-only editor endpoint. It verifies the caller's active Accounting
-- assignment, updates the ledger and current active-period Accounting item in
-- one transaction, and can mark a verified zero-balance student approved.
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
      outstanding_balance, required_action
    ) VALUES (
      p_student_id, p_tuition_fee, p_lab_fee, p_misc_fee, next_total,
      next_total, CASE WHEN next_total = 0 THEN 'NO ACTION REQUIRED' ELSE 'SETTLE PAYMENT' END
    ) RETURNING * INTO ledger_row;
  ELSE
    UPDATE public.student_ledgers
    SET tuition_fee = p_tuition_fee, lab_fee = p_lab_fee, misc_fee = p_misc_fee,
        total_balance = next_total, outstanding_balance = next_total,
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

-- Keep total_balance/outstanding_balance in sync when a ledger is edited through
-- other trusted workflows, and refresh the current Accounting item amount.
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
    NEW.required_action := CASE WHEN NEW.total_balance = 0 THEN 'NO ACTION REQUIRED' ELSE 'SETTLE PAYMENT' END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_student_ledger_balance ON public.student_ledgers;
CREATE TRIGGER sync_student_ledger_balance
BEFORE INSERT OR UPDATE ON public.student_ledgers
FOR EACH ROW EXECUTE FUNCTION public.sync_student_ledger_balance();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
    AND NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'student_ledgers'
    ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.student_ledgers;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
