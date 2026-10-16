import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return response({ error: 'Method not allowed.' }, 405);

  try {
    const { token } = await request.json();
    const normalizedToken = String(token || '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalizedToken)) {
      return response({ record: null });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY');
    if (!supabaseUrl || !serviceKey) return response({ error: 'Verification service is not configured.' }, 500);

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await adminClient
      .from('clearance_requests')
      .select('id, qr_code_token, overall_status, completion_date, clearance_periods(title, semester, academic_year)')
      .eq('qr_code_token', normalizedToken)
      .eq('overall_status', 'APPROVED')
      .maybeSingle();
    if (error) throw error;
    if (!data) return response({ record: null });

    const period = Array.isArray(data.clearance_periods) ? data.clearance_periods[0] : data.clearance_periods;
    return response({ record: {
      valid: true,
      period: period?.title || [period?.semester, period?.academic_year].filter(Boolean).join(' '),
      completedAt: data.completion_date || null,
    } });
  } catch (_error) {
    return response({ error: 'The clearance record could not be checked. Try again later.' }, 500);
  }
});
