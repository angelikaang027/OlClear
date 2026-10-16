import { supabase } from './supabase.js';

export const fetchOrCreateStudentClearance = async (studentId) => {
  try {
    if (!supabase) throw new Error('Supabase is not configured. Check the app environment.');

    let requestId = null;
    let rpcError = null;

    if (studentId) {
      const res = await supabase.rpc('ensure_student_clearance', { p_student_id: studentId });
      requestId = res.data;
      rpcError = res.error;
    }

    if (!requestId || rpcError) {
      const fallbackRes = await supabase.rpc('ensure_student_clearance');
      if (!fallbackRes.error && fallbackRes.data) {
        requestId = fallbackRes.data;
        rpcError = null;
      } else {
        rpcError = fallbackRes.error || rpcError;
      }
    }

    if (rpcError) throw rpcError;

    if (!requestId) {
      return {
        request: null,
        items: [],
        message: 'No active clearance period is currently open.',
      };
    }

    const { data: request, error: reqError } = await supabase
      .from('clearance_requests')
      .select('*, clearance_periods(*)')
      .eq('id', requestId)
      .single();

    if (reqError) throw reqError;

    const { data: items, error: itemsError } = await supabase
      .from('clearance_items')
      .select('*, offices(*)')
      .or(`request_id.eq.${requestId},clearance_request_id.eq.${requestId}`);

    if (itemsError) throw itemsError;

    return { request, items: items || [] };
  } catch (error) {
    console.error('Error in fetchOrCreateStudentClearance:', error);
    throw error;
  }
};

export const fetchStudentClearanceOverview = fetchOrCreateStudentClearance;
