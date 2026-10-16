-- Accounting staff may review and process only their assigned office queue.
-- Accounting remains the gateway: other offices can be processed only after
-- the Accounting item for the same clearance request is approved.

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
  clearance_item_id UUID REFERENCES public.clearance_items(id) ON DELETE CASCADE,
  student_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  storage_path TEXT,
  file_url TEXT,
  file_name TEXT,
  mime_type TEXT,
  file_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.clearance_proofs
  ADD COLUMN IF NOT EXISTS clearance_item_id UUID,
  ADD COLUMN IF NOT EXISTS student_id UUID REFERENCES public.users(id) ON DELETE CASCADE;
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

ALTER TABLE public.clearance_items
  ADD COLUMN IF NOT EXISTS balance_amount NUMERIC(10,2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS official_receipt_number TEXT,
  ADD COLUMN IF NOT EXISTS processed_by UUID REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_office_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clearance_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clearance_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clearance_items ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_active_staff_for_office(p_office_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.staff_office_assignments a ON a.user_id = u.id
    WHERE u.id = auth.uid()
      AND UPPER(COALESCE(u.role::text, '')) = 'STAFF'
      AND UPPER(COALESCE(u.status::text, '')) = 'ACTIVE'
      AND a.office_id = p_office_id
  );
$$;

CREATE OR REPLACE FUNCTION public.staff_can_access_clearance_item(p_item_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.clearance_items ci
    WHERE ci.id = p_item_id
      AND public.is_active_staff_for_office(ci.office_id)
      AND (
        EXISTS (
          SELECT 1 FROM public.offices o
          WHERE o.id = ci.office_id AND UPPER(o.code::text) = 'ACCOUNTING'
        )
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

CREATE OR REPLACE FUNCTION public.staff_can_read_accounting_student(p_student_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.clearance_requests cr
    JOIN public.clearance_items ci ON ci.clearance_request_id = cr.id
    JOIN public.offices o ON o.id = ci.office_id
    WHERE cr.student_id = p_student_id
      AND UPPER(o.code::text) = 'ACCOUNTING'
      AND public.is_active_staff_for_office(ci.office_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.accounting_staff_can_read_proof_path(p_object_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN split_part(p_object_name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN EXISTS (
      SELECT 1 FROM public.clearance_items ci
      WHERE ci.id = split_part(p_object_name, '/', 2)::UUID
        AND public.staff_can_access_clearance_item(ci.id)
    )
    ELSE FALSE
  END;
$$;

REVOKE ALL ON FUNCTION public.is_active_staff_for_office(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.staff_can_access_clearance_item(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.staff_can_read_accounting_student(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accounting_staff_can_read_proof_path(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_staff_for_office(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_can_access_clearance_item(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_can_read_accounting_student(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accounting_staff_can_read_proof_path(TEXT) TO authenticated;

-- Staff can read their own account and office assignment for login checks.
DROP POLICY IF EXISTS users_self_read ON public.users;
CREATE POLICY users_self_read ON public.users
  FOR SELECT TO authenticated USING (id = auth.uid());

DROP POLICY IF EXISTS staff_office_assignments_self_read ON public.staff_office_assignments;
CREATE POLICY staff_office_assignments_self_read ON public.staff_office_assignments
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS offices_assigned_staff_read ON public.offices;
CREATE POLICY offices_assigned_staff_read ON public.offices
  FOR SELECT TO authenticated USING (public.is_active_staff_for_office(id));

-- Staff only see their own assigned queue, its student profile, and its proofs.
DROP POLICY IF EXISTS clearance_items_assigned_staff_read ON public.clearance_items;
CREATE POLICY clearance_items_assigned_staff_read ON public.clearance_items
  FOR SELECT TO authenticated USING (public.is_active_staff_for_office(office_id));

DROP POLICY IF EXISTS clearance_items_assigned_staff_update ON public.clearance_items;
CREATE POLICY clearance_items_assigned_staff_update ON public.clearance_items
  FOR UPDATE TO authenticated
  USING (public.staff_can_access_clearance_item(id))
  WITH CHECK (public.staff_can_access_clearance_item(id));

DROP POLICY IF EXISTS clearance_requests_assigned_staff_read ON public.clearance_requests;
CREATE POLICY clearance_requests_assigned_staff_read ON public.clearance_requests
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.clearance_items ci
      WHERE ci.clearance_request_id = id
        AND public.is_active_staff_for_office(ci.office_id)
    )
  );

DROP POLICY IF EXISTS users_accounting_queue_read ON public.users;
CREATE POLICY users_accounting_queue_read ON public.users
  FOR SELECT TO authenticated USING (public.staff_can_read_accounting_student(id));

ALTER TABLE public.clearance_proofs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS clearance_proofs_assigned_staff_read ON public.clearance_proofs;
CREATE POLICY clearance_proofs_assigned_staff_read ON public.clearance_proofs
  FOR SELECT TO authenticated USING (public.staff_can_access_clearance_item(clearance_item_id));
GRANT SELECT ON public.clearance_proofs TO authenticated;
GRANT SELECT, UPDATE ON public.clearance_items TO authenticated;
GRANT SELECT ON public.clearance_requests, public.offices, public.staff_office_assignments TO authenticated;

-- The queue can show active periods to signed-in staff; period management
-- remains governed by the admin-only policies.
DROP POLICY IF EXISTS clearance_periods_authenticated_active_read ON public.clearance_periods;
CREATE POLICY clearance_periods_authenticated_active_read ON public.clearance_periods
  FOR SELECT TO authenticated USING (is_active = TRUE);

-- Student ledgers are optional in installations without the accounting ledger.
DO $$
BEGIN
  IF to_regclass('public.student_ledgers') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.student_ledgers ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.student_ledgers ADD COLUMN IF NOT EXISTS official_receipt_number TEXT';
    EXECUTE 'DROP POLICY IF EXISTS student_ledgers_accounting_staff_read ON public.student_ledgers';
    EXECUTE 'CREATE POLICY student_ledgers_accounting_staff_read ON public.student_ledgers FOR SELECT TO authenticated USING (public.staff_can_read_accounting_student(student_id))';
    EXECUTE 'DROP POLICY IF EXISTS student_ledgers_accounting_staff_update ON public.student_ledgers';
    EXECUTE 'CREATE POLICY student_ledgers_accounting_staff_update ON public.student_ledgers FOR UPDATE TO authenticated USING (public.staff_can_read_accounting_student(student_id)) WITH CHECK (public.staff_can_read_accounting_student(student_id))';
    EXECUTE 'GRANT SELECT, UPDATE ON public.student_ledgers TO authenticated';
  END IF;
END
$$;

-- Private proof files can be opened by staff only when the object path maps
-- to a clearance item they are allowed to review.
DROP POLICY IF EXISTS accounting_staff_read_clearance_proofs ON storage.objects;
CREATE POLICY accounting_staff_read_clearance_proofs ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'clearance_proofs'
    AND public.accounting_staff_can_read_proof_path(name)
  );

NOTIFY pgrst, 'reload schema';
