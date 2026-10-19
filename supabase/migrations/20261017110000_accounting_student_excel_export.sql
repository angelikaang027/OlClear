-- Return the Accounting student record datasets only to active Accounting staff
-- member. The RPC intentionally bypasses row-level filters after verifying
-- that assignment, so students without a clearance request are included too.
CREATE OR REPLACE FUNCTION public.accounting_export_student_records()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  accounting_office_id UUID;
  export_data JSONB;
BEGIN
  SELECT office.id INTO accounting_office_id
  FROM public.offices office
  WHERE UPPER(office.code::TEXT) = 'ACCOUNTING'
  LIMIT 1;

  IF accounting_office_id IS NULL
    OR NOT public.is_active_staff_for_office(accounting_office_id) THEN
    RAISE EXCEPTION 'An active Accounting staff assignment is required to view student records.'
      USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'exported_at', NOW(),
    'students', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'student_id', student.id,
        'full_name', student.full_name,
        'email', student.email,
        'student_id_number', student.student_id_number,
        'academic_level', student.academic_level,
        'department_code', department.code,
        'department_name', department.name,
        'program_code', program.code,
        'program_name', program.name,
        'year_level', student.year_level,
        'is_graduating', student.is_graduating,
        'account_status', student.status,
        'created_at', student.created_at
      ) ORDER BY student.full_name, student.student_id_number)
      FROM public.users student
      LEFT JOIN public.academic_departments department ON department.id = student.department_id
      LEFT JOIN public.programs program ON program.id = student.program_id
      WHERE UPPER(student.role::TEXT) = 'STUDENT'
    ), '[]'::JSONB),
    'payments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'payment_id', payment.id,
        'student_id', student.id,
        'student_id_number', student.student_id_number,
        'student_name', student.full_name,
        'email', student.email,
        'department_code', department.code,
        'program_code', program.code,
        'payment_date', payment.payment_date,
        'amount', payment.amount,
        'status', payment.status,
        'recorded_at', payment.created_at
      ) ORDER BY payment.payment_date DESC, payment.created_at DESC)
      FROM public.student_payments payment
      JOIN public.users student ON student.id = payment.student_id
      LEFT JOIN public.academic_departments department ON department.id = student.department_id
      LEFT JOIN public.programs program ON program.id = student.program_id
      WHERE UPPER(student.role::TEXT) = 'STUDENT'
    ), '[]'::JSONB),
    'ledgers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'ledger_id', ledger.id,
        'student_id', student.id,
        'student_id_number', student.student_id_number,
        'student_name', student.full_name,
        'tuition_fee', ledger.tuition_fee,
        'lab_fee', ledger.lab_fee,
        'misc_fee', ledger.misc_fee,
        'total_balance', ledger.total_balance,
        'outstanding_balance', ledger.outstanding_balance,
        'required_action', ledger.required_action,
        'official_receipt_number', ledger.official_receipt_number,
        'is_configured', ledger.is_configured,
        'created_at', ledger.created_at,
        'updated_at', ledger.updated_at
      ) ORDER BY student.full_name, ledger.created_at DESC)
      FROM public.student_ledgers ledger
      JOIN public.users student ON student.id = ledger.student_id
      WHERE UPPER(student.role::TEXT) = 'STUDENT'
    ), '[]'::JSONB),
    'clearances', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'student_id', student.id,
        'student_id_number', student.student_id_number,
        'student_name', student.full_name,
        'email', student.email,
        'period_title', period.title,
        'academic_year', period.academic_year,
        'semester', period.semester,
        'request_status', request.overall_status,
        'clearance_type', request.clearance_type,
        'office_code', office.code,
        'office_name', office.name,
        'item_status', item.status,
        'balance_amount', item.balance_amount,
        'official_receipt_number', item.official_receipt_number,
        'remarks', item.remarks,
        'updated_at', item.updated_at
      ) ORDER BY student.full_name, period.created_at DESC, office.name)
      FROM public.clearance_items item
      JOIN public.clearance_requests request
        ON request.id = COALESCE(item.clearance_request_id, item.request_id)
      JOIN public.users student ON student.id = request.student_id
      JOIN public.offices office ON office.id = item.office_id
      LEFT JOIN public.clearance_periods period
        ON period.id = COALESCE(request.clearance_period_id, request.period_id)
      WHERE UPPER(student.role::TEXT) = 'STUDENT'
    ), '[]'::JSONB)
  ) INTO export_data;

  RETURN export_data;
END;
$$;

REVOKE ALL ON FUNCTION public.accounting_export_student_records() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accounting_export_student_records() TO authenticated;

NOTIFY pgrst, 'reload schema';
