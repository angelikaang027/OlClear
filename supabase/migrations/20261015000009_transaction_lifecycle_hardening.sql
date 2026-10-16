-- Transaction lifecycle hardening: normalize legacy references and keep
-- Accounting and assigned staff decisions atomic and server-authorized.

ALTER TABLE public.clearance_items
  ADD COLUMN IF NOT EXISTS clearance_request_id UUID,
  ADD COLUMN IF NOT EXISTS office_id UUID,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS remarks TEXT,
  ADD COLUMN IF NOT EXISTS balance_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS official_receipt_number TEXT,
  ADD COLUMN IF NOT EXISTS processed_by UUID REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'clearance_items' AND column_name = 'request_id'
  ) THEN
    EXECUTE 'UPDATE public.clearance_items SET clearance_request_id = request_id WHERE clearance_request_id IS NULL';
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clearance_items_clearance_request_id_lifecycle_fk') THEN
    ALTER TABLE public.clearance_items
      ADD CONSTRAINT clearance_items_clearance_request_id_lifecycle_fk
      FOREIGN KEY (clearance_request_id) REFERENCES public.clearance_requests(id) ON DELETE CASCADE NOT VALID;
  END IF;
END;
$$;

ALTER TABLE public.clearance_proofs
  ADD COLUMN IF NOT EXISTS clearance_item_id UUID,
  ADD COLUMN IF NOT EXISTS student_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS storage_path TEXT,
  ADD COLUMN IF NOT EXISTS file_url TEXT,
  ADD COLUMN IF NOT EXISTS file_name TEXT,
  ADD COLUMN IF NOT EXISTS mime_type TEXT,
  ADD COLUMN IF NOT EXISTS file_type TEXT,
  ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'clearance_proofs' AND column_name = 'item_id'
  ) THEN
    EXECUTE 'UPDATE public.clearance_proofs SET clearance_item_id = item_id WHERE clearance_item_id IS NULL';
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clearance_proofs_clearance_item_id_lifecycle_fk') THEN
    ALTER TABLE public.clearance_proofs
      ADD CONSTRAINT clearance_proofs_clearance_item_id_lifecycle_fk
      FOREIGN KEY (clearance_item_id) REFERENCES public.clearance_items(id) ON DELETE CASCADE NOT VALID;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS clearance_items_request_id_idx ON public.clearance_items(clearance_request_id);
CREATE INDEX IF NOT EXISTS clearance_proofs_item_id_idx ON public.clearance_proofs(clearance_item_id);
CREATE INDEX IF NOT EXISTS clearance_proofs_student_id_idx ON public.clearance_proofs(student_id);

-- Make sure the private bucket exists. Object paths are scoped to
-- {student UUID}/{clearance item UUID}/{filename} by the existing guard.
INSERT INTO storage.buckets (id, name, public)
VALUES ('clearance_proofs', 'clearance_proofs', FALSE)
ON CONFLICT (id) DO UPDATE SET public = FALSE;

CREATE OR REPLACE FUNCTION public.accounting_adjust_clearance_balance(
  p_item_id UUID,
  p_balance NUMERIC,
  p_receipt_number TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item_row public.clearance_items%ROWTYPE;
  student_user_id UUID;
  status_type TEXT;
BEGIN
  IF p_balance IS NULL OR p_balance < 0 THEN
    RAISE EXCEPTION 'Enter a valid balance of zero or more.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO item_row FROM public.clearance_items WHERE id = p_item_id FOR UPDATE;
  IF item_row.id IS NULL OR NOT public.staff_can_access_clearance_item(p_item_id) THEN
    RAISE EXCEPTION 'An active Accounting assignment is required to adjust this balance.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.offices o WHERE o.id = item_row.office_id AND o.code::text = 'ACCOUNTING') THEN
    RAISE EXCEPTION 'Only Accounting clearance balances can be adjusted here.' USING ERRCODE = '42501';
  END IF;

  SELECT cr.student_id INTO student_user_id
  FROM public.clearance_requests cr WHERE cr.id = item_row.clearance_request_id;

  SELECT format_type(a.atttypid, a.atttypmod) INTO status_type
  FROM pg_attribute a
  WHERE a.attrelid = 'public.clearance_items'::regclass AND a.attname = 'status' AND NOT a.attisdropped;
  EXECUTE format(
    'UPDATE public.clearance_items SET balance_amount = $1, official_receipt_number = $2, processed_by = auth.uid(), processed_at = NOW(), status = CASE WHEN UPPER(status::text) = ''APPROVED'' AND $1 > 0 THEN $3::%s ELSE status END WHERE id = $4',
    status_type
  ) USING p_balance, NULLIF(TRIM(p_receipt_number), ''), 'PENDING', p_item_id;

  UPDATE public.student_ledgers
  SET outstanding_balance = p_balance,
      total_balance = p_balance,
      required_action = CASE WHEN p_balance = 0 THEN 'NO ACTION REQUIRED' ELSE 'SETTLE PAYMENT' END,
      official_receipt_number = NULLIF(TRIM(p_receipt_number), '')
  WHERE student_id = student_user_id;
END;
$$;

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
  status_type TEXT;
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

  SELECT format_type(a.atttypid, a.atttypmod) INTO status_type
  FROM pg_attribute a
  WHERE a.attrelid = 'public.clearance_items'::regclass AND a.attname = 'status' AND NOT a.attisdropped;

  FOREACH item_id IN ARRAY p_item_ids LOOP
    SELECT * INTO item_row FROM public.clearance_items WHERE id = item_id FOR UPDATE;
    IF item_row.id IS NULL OR NOT public.staff_can_access_clearance_item(item_id) THEN
      RAISE EXCEPTION 'A selected item is outside your assigned office or Accounting has not approved it.' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM public.offices o WHERE o.id = item_row.office_id AND o.code::text = 'ACCOUNTING') THEN
      RAISE EXCEPTION 'Accounting decisions must use the Accounting verification workflow.' USING ERRCODE = '42501';
    END IF;
    IF p_status = 'APPROVED' AND NOT EXISTS (
      SELECT 1 FROM public.clearance_proofs proof WHERE proof.clearance_item_id = item_id
    ) THEN
      RAISE EXCEPTION 'A student proof document is required before approval.' USING ERRCODE = '22023';
    END IF;
    EXECUTE format(
      'UPDATE public.clearance_items SET status = $1::%s, remarks = $2, processed_by = auth.uid(), processed_at = NOW() WHERE id = $3',
      status_type
    ) USING p_status, NULLIF(TRIM(p_remarks), ''), item_id;
    changed_count := changed_count + 1;
  END LOOP;
  RETURN changed_count;
END;
$$;

-- Replace the Accounting decision RPC so clearing a verified balance updates
-- the ledger and clearance item in the same transaction.
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
  status_type TEXT;
BEGIN
  IF p_status NOT IN ('APPROVED', 'REJECTED', 'REQUIREMENT_NEEDED') THEN
    RAISE EXCEPTION 'Unsupported Accounting decision.' USING ERRCODE = '22023';
  END IF;
  IF p_status <> 'APPROVED' AND NULLIF(TRIM(p_remarks), '') IS NULL THEN
    RAISE EXCEPTION 'A remark is required when returning or rejecting a payment proof.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO item_row FROM public.clearance_items WHERE id = p_item_id FOR UPDATE;
  IF item_row.id IS NULL OR NOT public.staff_can_access_clearance_item(p_item_id)
    OR NOT EXISTS (SELECT 1 FROM public.offices o WHERE o.id = item_row.office_id AND o.code::text = 'ACCOUNTING') THEN
    RAISE EXCEPTION 'This Accounting item is not assigned to your active staff account.' USING ERRCODE = '42501';
  END IF;
  IF p_status = 'APPROVED' AND NOT EXISTS (
    SELECT 1 FROM public.clearance_proofs proof WHERE proof.clearance_item_id = p_item_id
  ) THEN
    RAISE EXCEPTION 'A submitted payment proof is required before Accounting can approve this clearance.' USING ERRCODE = '22023';
  END IF;
  SELECT cr.student_id INTO student_user_id
  FROM public.clearance_requests cr WHERE cr.id = item_row.clearance_request_id;
  SELECT format_type(a.atttypid, a.atttypmod) INTO status_type
  FROM pg_attribute a
  WHERE a.attrelid = 'public.clearance_items'::regclass AND a.attname = 'status' AND NOT a.attisdropped;
  EXECUTE format(
    'UPDATE public.clearance_items SET status = $1::%s, remarks = $2, balance_amount = CASE WHEN $1 = ''APPROVED'' THEN 0 ELSE balance_amount END, processed_by = auth.uid(), processed_at = NOW() WHERE id = $3',
    status_type
  ) USING p_status, NULLIF(TRIM(p_remarks), ''), p_item_id;

  IF p_status = 'APPROVED' THEN
    UPDATE public.student_ledgers
    SET tuition_fee = 0, lab_fee = 0, misc_fee = 0,
        total_balance = 0, outstanding_balance = 0,
        required_action = 'NO ACTION REQUIRED'
    WHERE student_id = student_user_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.accounting_adjust_clearance_balance(UUID, NUMERIC, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.staff_decide_clearance_items(UUID[], TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accounting_adjust_clearance_balance(UUID, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_decide_clearance_items(UUID[], TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accounting_decide_clearance_item(UUID, TEXT, TEXT) TO authenticated;

-- The existing role-aware RLS policies from migrations 06/07 remain the
-- authority. Ensure legacy wide-open policies cannot bypass their safeguards.
DROP POLICY IF EXISTS "Allow Staff Clearance Updates" ON public.clearance_items;
DROP POLICY IF EXISTS "Allow Student Insert Proofs" ON public.clearance_proofs;
DROP POLICY IF EXISTS "Allow Staff Read Proofs" ON public.clearance_proofs;

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_logs_admin_read ON public.audit_logs;
CREATE POLICY audit_logs_admin_read ON public.audit_logs FOR SELECT TO authenticated
  USING (public.is_clearance_admin());
DROP POLICY IF EXISTS audit_logs_admin_insert ON public.audit_logs;
CREATE POLICY audit_logs_admin_insert ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (public.is_clearance_admin() AND admin_id = auth.uid());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'clearance_items') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.clearance_items;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'clearance_requests') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.clearance_requests;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'student_ledgers') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.student_ledgers;
    END IF;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
