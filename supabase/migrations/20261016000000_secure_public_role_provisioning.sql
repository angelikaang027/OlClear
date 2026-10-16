-- Public Auth signup metadata is user-controlled. Never let it create an
-- administrator profile; administrator creation goes through the
-- administrator-authorized admin-manage-user Edge Function.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  metadata_role TEXT := COALESCE(UPPER(NULLIF(BTRIM(NEW.raw_user_meta_data ->> 'role'), '')), 'STUDENT');
  metadata_academic_level TEXT;
  profile_role public.user_role_enum;
  profile_academic_level public.users.academic_level%TYPE;
BEGIN
  IF metadata_role NOT IN ('STUDENT', 'STAFF') THEN
    metadata_role := 'STUDENT';
  END IF;

  profile_role := metadata_role::public.user_role_enum;
  metadata_academic_level := UPPER(NULLIF(BTRIM(NEW.raw_user_meta_data ->> 'academic_level'), ''));
  IF metadata_academic_level IS NULL
    OR metadata_academic_level NOT IN ('HIGH_SCHOOL', 'UNDERGRADUATE', 'POSTGRADUATE') THEN
    metadata_academic_level := 'UNDERGRADUATE';
  END IF;
  profile_academic_level := metadata_academic_level;

  INSERT INTO public.users (
    id, email, full_name, role, student_id_number, employee_id_number,
    department_id, program_id, academic_level, year_level, is_graduating,
    status, requested_office_id, requested_department_id
  ) VALUES (
    NEW.id,
    LOWER(NEW.email),
    COALESCE(NULLIF(BTRIM(NEW.raw_user_meta_data ->> 'full_name'), ''), ''),
    profile_role,
    NULLIF(BTRIM(NEW.raw_user_meta_data ->> 'student_id_number'), ''),
    NULLIF(BTRIM(NEW.raw_user_meta_data ->> 'employee_id_number'), ''),
    NULLIF(NEW.raw_user_meta_data ->> 'department_id', '')::UUID,
    NULLIF(NEW.raw_user_meta_data ->> 'program_id', '')::UUID,
    profile_academic_level,
    NULLIF(BTRIM(NEW.raw_user_meta_data ->> 'year_level'), ''),
    COALESCE((NEW.raw_user_meta_data ->> 'is_graduating')::BOOLEAN, FALSE),
    CASE WHEN profile_role::TEXT = 'STAFF' THEN 'PENDING_APPROVAL' ELSE 'ACTIVE' END,
    NULLIF(NEW.raw_user_meta_data ->> 'requested_office_id', '')::UUID,
    NULLIF(NEW.raw_user_meta_data ->> 'requested_department_id', '')::UUID
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_auth_user_profile() FROM PUBLIC;

-- A suspended account's existing token must not continue to satisfy database
-- authorization helpers while the Auth ban is in force.
CREATE OR REPLACE FUNCTION public.is_clearance_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND UPPER(u.role::text) = 'ADMIN'
      AND UPPER(COALESCE(u.status::text, 'ACTIVE')) = 'ACTIVE'
      AND NOT EXISTS (
        SELECT 1 FROM auth.users au
        WHERE au.id = auth.uid() AND au.banned_until > NOW()
      )
  );
$$;

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
      AND UPPER(u.role::text) = 'STAFF'
      AND UPPER(COALESCE(u.status::text, '')) = 'ACTIVE'
      AND a.office_id = p_office_id
      AND NOT EXISTS (
        SELECT 1 FROM auth.users au
        WHERE au.id = auth.uid() AND au.banned_until > NOW()
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_clearance_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_staff_for_office(UUID) TO authenticated;

-- Uploaded proofs are private and bounded to the file types accepted by the
-- student workflow. The client also checks this limit before upload.
UPDATE storage.buckets
SET public = FALSE,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[]
WHERE id = 'clearance_proofs';

NOTIFY pgrst, 'reload schema';
