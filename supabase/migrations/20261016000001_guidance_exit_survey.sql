CREATE TABLE IF NOT EXISTS public.guidance_exit_survey_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clearance_item_id UUID NOT NULL UNIQUE REFERENCES public.clearance_items(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  response TEXT NOT NULL CHECK (char_length(btrim(response)) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.guidance_exit_survey_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS guidance_exit_survey_response_read ON public.guidance_exit_survey_responses;
CREATE POLICY guidance_exit_survey_response_read
  ON public.guidance_exit_survey_responses
  FOR SELECT TO authenticated
  USING (
    student_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.clearance_items ci
      JOIN public.offices o ON o.id = ci.office_id
      WHERE ci.id = clearance_item_id
        AND UPPER(o.code::text) = 'GUIDANCE'
        AND public.is_active_staff_for_office(ci.office_id)
    )
  );

REVOKE ALL ON public.guidance_exit_survey_responses FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.guidance_exit_survey_responses TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_guidance_exit_survey(
  p_clearance_item_id UUID,
  p_response TEXT
)
RETURNS public.guidance_exit_survey_responses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_student_id UUID := auth.uid();
  saved_response public.guidance_exit_survey_responses;
BEGIN
  IF current_student_id IS NULL THEN
    RAISE EXCEPTION 'Sign in before submitting the survey.' USING ERRCODE = '42501';
  END IF;

  IF p_response IS NULL OR char_length(btrim(p_response)) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'Survey response must contain 1 to 2000 characters.' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = current_student_id
      AND UPPER(u.role::text) = 'STUDENT'
      AND UPPER(COALESCE(u.status::text, 'ACTIVE')) = 'ACTIVE'
  ) OR EXISTS (
    SELECT 1 FROM auth.users au
    WHERE au.id = current_student_id AND au.banned_until > NOW()
  ) THEN
    RAISE EXCEPTION 'An active student account is required.' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.clearance_items ci
    JOIN public.clearance_requests cr ON cr.id = ci.clearance_request_id
    JOIN public.clearance_periods cp ON cp.id = cr.clearance_period_id
    JOIN public.offices o ON o.id = ci.office_id
    WHERE ci.id = p_clearance_item_id
      AND UPPER(o.code::text) = 'GUIDANCE'
      AND cp.is_active = TRUE
      AND public.student_can_submit_clearance_item(ci.id)
  ) THEN
    RAISE EXCEPTION 'The Guidance survey is unavailable for this clearance item.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.guidance_exit_survey_responses (clearance_item_id, student_id, response)
  VALUES (p_clearance_item_id, current_student_id, btrim(p_response))
  ON CONFLICT (clearance_item_id) DO UPDATE
    SET response = EXCLUDED.response,
        updated_at = NOW()
    WHERE guidance_exit_survey_responses.student_id = current_student_id
  RETURNING * INTO saved_response;

  IF saved_response.id IS NULL THEN
    RAISE EXCEPTION 'The existing survey response does not belong to this account.' USING ERRCODE = '42501';
  END IF;

  RETURN saved_response;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_guidance_exit_survey(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_guidance_exit_survey(UUID, TEXT) TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
    AND NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'guidance_exit_survey_responses'
    ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.guidance_exit_survey_responses';
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
