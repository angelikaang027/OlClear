-- Create public.users profiles from Auth metadata using the database owner
-- context. This works when email confirmation is enabled and the client has
-- no authenticated session yet.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  metadata_role TEXT := UPPER(NULLIF(BTRIM(NEW.raw_user_meta_data ->> 'role'), ''));
  metadata_academic_level TEXT;
  profile_role public.user_role_enum;
  profile_academic_level public.users.academic_level%TYPE;
BEGIN
  IF metadata_role IS NULL THEN
    metadata_role := 'STUDENT';
  END IF;

  -- Auth user metadata is supplied by the caller during public signup. It must
  -- never grant administrator access; privileged roles are provisioned only
  -- by the authenticated admin-manage-user Edge Function.
  IF metadata_role NOT IN ('STUDENT', 'STAFF') THEN
    metadata_role := 'STUDENT';
  END IF;

  -- Parse enum-like metadata as text first. Validate before assigning it to
  -- the column-typed variable so invalid text cannot raise 22P02.
  profile_role := metadata_role::public.user_role_enum;
  metadata_academic_level := UPPER(NULLIF(BTRIM(NEW.raw_user_meta_data ->> 'academic_level'), ''));
  IF metadata_academic_level IS NULL
    OR metadata_academic_level NOT IN ('HIGH_SCHOOL', 'UNDERGRADUATE', 'POSTGRADUATE') THEN
    metadata_academic_level := 'UNDERGRADUATE';
  END IF;
  profile_academic_level := metadata_academic_level;

  INSERT INTO public.users (
    id,
    email,
    full_name,
    role,
    student_id_number,
    employee_id_number,
    department_id,
    program_id,
    academic_level,
    year_level,
    is_graduating,
    status,
    requested_office_id,
    requested_department_id
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
    NULLIF(NEW.raw_user_meta_data ->> 'year_level', ''),
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

DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_auth_user_profile();

NOTIFY pgrst, 'reload schema';
