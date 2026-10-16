-- Storage-backed student receipt schema. storage_path is the canonical private
-- object reference; file_url remains nullable for legacy/public URL records.
ALTER TABLE public.clearance_items
  ADD COLUMN IF NOT EXISTS clearance_request_id UUID;

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

CREATE TABLE IF NOT EXISTS public.clearance_proofs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clearance_item_id UUID NOT NULL REFERENCES public.clearance_items(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  storage_path TEXT,
  file_url TEXT,
  file_name TEXT,
  mime_type TEXT,
  file_type TEXT,
  amount_paid NUMERIC(10,2),
  reference_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.clearance_proofs
  ADD COLUMN IF NOT EXISTS clearance_item_id UUID,
  ADD COLUMN IF NOT EXISTS student_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS storage_path TEXT,
  ADD COLUMN IF NOT EXISTS file_url TEXT,
  ADD COLUMN IF NOT EXISTS file_name TEXT,
  ADD COLUMN IF NOT EXISTS mime_type TEXT,
  ADD COLUMN IF NOT EXISTS file_type TEXT,
  ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS reference_number TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.clearance_proofs ALTER COLUMN file_url DROP NOT NULL;

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

-- Private, storage-backed upload destinations and optional ledger tables.
INSERT INTO storage.buckets (id, name, public)
VALUES ('clearance_proofs', 'clearance_proofs', FALSE)
ON CONFLICT (id) DO UPDATE SET public = FALSE;

CREATE TABLE IF NOT EXISTS public.student_ledgers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  tuition_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  lab_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  misc_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  outstanding_balance NUMERIC(10,2) NOT NULL DEFAULT 0,
  required_action TEXT NOT NULL DEFAULT 'SETTLE PAYMENT',
  official_receipt_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.student_ledgers
  ADD COLUMN IF NOT EXISTS tuition_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lab_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS misc_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS outstanding_balance NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS required_action TEXT NOT NULL DEFAULT 'SETTLE PAYMENT',
  ADD COLUMN IF NOT EXISTS official_receipt_number TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS public.student_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PAID',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
    WHERE ci.id = p_item_id
      AND cr.student_id = auth.uid()
      AND UPPER(COALESCE(ci.status::text, '')) <> 'APPROVED'
      AND (
        UPPER(o.code::text) = 'ACCOUNTING'
        OR EXISTS (
          SELECT 1
          FROM public.clearance_items accounting_item
          JOIN public.offices accounting_office ON accounting_office.id = accounting_item.office_id
          WHERE accounting_item.clearance_request_id = ci.clearance_request_id
            AND UPPER(accounting_office.code::text) = 'ACCOUNTING'
            AND UPPER(COALESCE(accounting_item.status::text, '')) = 'APPROVED'
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.student_can_upload_clearance_path(p_object_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NOT NULL
      AND split_part(p_object_name, '/', 1) = auth.uid()::TEXT
      AND split_part(p_object_name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN public.student_can_submit_clearance_item(split_part(p_object_name, '/', 2)::UUID)
    ELSE FALSE
  END;
$$;

CREATE OR REPLACE FUNCTION public.guard_student_clearance_item_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL
    OR COALESCE(auth.role(), '') = 'service_role'
    OR public.is_clearance_admin()
    OR NOT EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND UPPER(COALESCE(u.role::text, '')) = 'STUDENT'
    )
  THEN
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - 'status' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'updated_at')
    OR UPPER(COALESCE(NEW.status::text, '')) <> 'SUBMITTED'
    OR NOT public.student_can_submit_clearance_item(OLD.id)
  THEN
    RAISE EXCEPTION 'Students may only submit proof for their own unlocked clearance item.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.student_can_submit_clearance_item(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.student_can_upload_clearance_path(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_student_clearance_item_update() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.student_can_submit_clearance_item(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.student_can_upload_clearance_path(TEXT) TO authenticated;

ALTER TABLE public.clearance_proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_ledgers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_payments ENABLE ROW LEVEL SECURITY;

-- Remove broad policies from older setup snippets so they cannot bypass the
-- owner checks and Accounting gateway below (PostgreSQL policies are ORed).
DROP POLICY IF EXISTS "Allow Student Insert Proofs" ON public.clearance_proofs;
DROP POLICY IF EXISTS "Allow Staff Read Proofs" ON public.clearance_proofs;
DROP POLICY IF EXISTS "Allow Staff Clearance Updates" ON public.clearance_items;

DROP POLICY IF EXISTS users_self_read ON public.users;
CREATE POLICY users_self_read ON public.users
  FOR SELECT TO authenticated USING (id = auth.uid());

DROP POLICY IF EXISTS clearance_requests_student_read_self ON public.clearance_requests;
CREATE POLICY clearance_requests_student_read_self ON public.clearance_requests
  FOR SELECT TO authenticated USING (student_id = auth.uid());

DROP POLICY IF EXISTS clearance_items_student_read_self ON public.clearance_items;
CREATE POLICY clearance_items_student_read_self ON public.clearance_items
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.clearance_requests cr
      WHERE cr.id = clearance_request_id AND cr.student_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS clearance_items_student_submit_unlocked ON public.clearance_items;
CREATE POLICY clearance_items_student_submit_unlocked ON public.clearance_items
  FOR UPDATE TO authenticated
  USING (public.student_can_submit_clearance_item(id))
  WITH CHECK (public.student_can_submit_clearance_item(id));

DROP TRIGGER IF EXISTS guard_student_clearance_item_update ON public.clearance_items;
CREATE TRIGGER guard_student_clearance_item_update
  BEFORE UPDATE ON public.clearance_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_student_clearance_item_update();

DROP POLICY IF EXISTS clearance_proofs_student_read_own ON public.clearance_proofs;
CREATE POLICY clearance_proofs_student_read_own ON public.clearance_proofs
  FOR SELECT TO authenticated USING (student_id = auth.uid());

DROP POLICY IF EXISTS clearance_proofs_student_insert_own_unlocked ON public.clearance_proofs;
CREATE POLICY clearance_proofs_student_insert_own_unlocked ON public.clearance_proofs
  FOR INSERT TO authenticated WITH CHECK (
    student_id = auth.uid()
    AND public.student_can_submit_clearance_item(clearance_item_id)
    AND storage_path LIKE (auth.uid()::TEXT || '/' || clearance_item_id::TEXT || '/%')
  );

DROP POLICY IF EXISTS student_ledgers_student_read_own ON public.student_ledgers;
CREATE POLICY student_ledgers_student_read_own ON public.student_ledgers
  FOR SELECT TO authenticated USING (student_id = auth.uid());

DROP POLICY IF EXISTS student_ledgers_accounting_staff_read ON public.student_ledgers;
CREATE POLICY student_ledgers_accounting_staff_read ON public.student_ledgers
  FOR SELECT TO authenticated USING (public.staff_can_read_accounting_student(student_id));

DROP POLICY IF EXISTS student_ledgers_accounting_staff_update ON public.student_ledgers;
CREATE POLICY student_ledgers_accounting_staff_update ON public.student_ledgers
  FOR UPDATE TO authenticated
  USING (public.staff_can_read_accounting_student(student_id))
  WITH CHECK (public.staff_can_read_accounting_student(student_id));

DROP POLICY IF EXISTS student_payments_student_read_own ON public.student_payments;
CREATE POLICY student_payments_student_read_own ON public.student_payments
  FOR SELECT TO authenticated USING (student_id = auth.uid());

GRANT SELECT ON public.clearance_proofs, public.student_ledgers, public.student_payments TO authenticated;
GRANT UPDATE ON public.student_ledgers TO authenticated;
GRANT INSERT ON public.clearance_proofs TO authenticated;
GRANT UPDATE ON public.clearance_items TO authenticated;

DROP POLICY IF EXISTS student_upload_own_unlocked_clearance_proofs ON storage.objects;
CREATE POLICY student_upload_own_unlocked_clearance_proofs ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'clearance_proofs'
    AND public.student_can_upload_clearance_path(name)
  );

DROP POLICY IF EXISTS student_delete_own_failed_clearance_upload ON storage.objects;
CREATE POLICY student_delete_own_failed_clearance_upload ON storage.objects
  FOR DELETE TO authenticated USING (
    bucket_id = 'clearance_proofs'
    AND public.student_can_upload_clearance_path(name)
  );

DROP POLICY IF EXISTS student_read_own_accounting_clearance_proofs ON storage.objects;
CREATE POLICY student_read_own_accounting_clearance_proofs ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id = 'clearance_proofs'
    AND split_part(name, '/', 1) = auth.uid()::TEXT
  );

NOTIFY pgrst, 'reload schema';
