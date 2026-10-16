-- Enforce office-level proof visibility in the database as well as the UI.
-- An admin can inspect all offices; active staff can inspect only their own.

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
    JOIN public.offices o ON o.id = p_office_id
    WHERE u.id = auth.uid()
      AND UPPER(COALESCE(u.role::text, '')) = 'STAFF'
      AND UPPER(COALESCE(u.status::text, '')) = 'ACTIVE'
      AND (
        u.assigned_office_id = p_office_id
        OR UPPER(COALESCE(u.office_code::text, '')) = UPPER(o.code::text)
        OR EXISTS (
          SELECT 1
          FROM public.staff_office_assignments a
          WHERE a.user_id = u.id AND a.office_id = p_office_id
        )
      )
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
      AND (
        public.is_clearance_admin()
        OR (
          public.is_active_staff_for_office(ci.office_id)
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
        )
      )
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
    THEN public.staff_can_access_clearance_item(split_part(p_object_name, '/', 2)::UUID)
    ELSE FALSE
  END;
$$;

REVOKE ALL ON FUNCTION public.is_active_staff_for_office(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.staff_can_access_clearance_item(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accounting_staff_can_read_proof_path(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_staff_for_office(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_can_access_clearance_item(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accounting_staff_can_read_proof_path(TEXT) TO authenticated;

-- Copy legacy proof foreign keys into the canonical reference before applying
-- the office-scoped policy. Keep this conditional for installations that only
-- have one of the two columns.
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

ALTER TABLE public.clearance_proofs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow Admin Full Access" ON public.clearance_proofs;
DROP POLICY IF EXISTS "Allow Staff Read Proofs" ON public.clearance_proofs;
DROP POLICY IF EXISTS "Allow Student Insert Proofs" ON public.clearance_proofs;
DROP POLICY IF EXISTS clearance_proofs_assigned_staff_read ON public.clearance_proofs;
CREATE POLICY clearance_proofs_assigned_staff_read ON public.clearance_proofs
  FOR SELECT TO authenticated
  USING (public.staff_can_access_clearance_item(clearance_item_id));
DROP POLICY IF EXISTS clearance_proofs_assigned_staff_review_update ON public.clearance_proofs;
CREATE POLICY clearance_proofs_assigned_staff_review_update ON public.clearance_proofs
  FOR UPDATE TO authenticated
  USING (public.staff_can_access_clearance_item(clearance_item_id))
  WITH CHECK (public.staff_can_access_clearance_item(clearance_item_id));
GRANT SELECT, UPDATE ON public.clearance_proofs TO authenticated;

-- Staff and admin storage reads must pass the same clearance-item scope check.
DROP POLICY IF EXISTS accounting_staff_read_clearance_proofs ON storage.objects;
CREATE POLICY accounting_staff_read_clearance_proofs ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'clearance_proofs'
    AND public.accounting_staff_can_read_proof_path(name)
  );

NOTIFY pgrst, 'reload schema';
