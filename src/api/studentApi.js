import { getOffice } from '../constants/offices.js';
import { ACCOUNTING_REQUIRED_MESSAGE, isOfficeUnlocked } from '../utils/clearanceRules.js';
import { fetchStudentClearanceOverview } from './clearanceService.js';
import { supabase } from './supabase.js';

function requireSupabase() {
  if (!supabase) throw new Error('Supabase is not configured. Check the app environment.');
}

function decorateItems(items = []) {
  return items.map((item) => {
    const relation = Array.isArray(item.offices) ? item.offices[0] : item.offices;
    const office = getOffice(item.office_code || relation?.code || item.office_name || relation?.name || item.office);
    return {
      ...item,
      office_code: item.office_code || relation?.code || office?.code || null,
      office_name: relation?.name || office?.name || item.office_name || item.office || 'Clearance office',
    };
  });
}

function isMissingReferenceColumn(error, column) {
  const message = String(error?.message || '').toLowerCase();
  const escapedColumn = column.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const namesColumn = new RegExp(`(^|[^a-z0-9_])${escapedColumn}($|[^a-z0-9_])`).test(message);
  const indicatesMissingColumn = error?.code === '42703'
    || error?.code === 'PGRST204'
    || message.includes('schema cache')
    || message.includes('does not exist')
    || message.includes('could not find');
  return namesColumn && indicatesMissingColumn;
}

function isMissingProofReferenceColumn(error, column) {
  return isMissingReferenceColumn(error, column);
}

const PERIOD_REFERENCE_COLUMNS = ['clearance_period_id', 'period_id'];

function normalizeRequestPeriod(request, period) {
  if (!request) return null;
  const requestPeriodId = request.clearance_period_id || request.period_id || period?.id || null;
  return {
    ...request,
    clearance_period_id: request.clearance_period_id || requestPeriodId,
    period_id: request.period_id || requestPeriodId,
    clearance_periods: period || null,
  };
}

/**
 * Clearance schemas have used both request_id and clearance_request_id.
 * Query both when possible, then retry with the one reference column present
 * in the deployed schema if PostgREST reports a missing column.
 */
export async function fetchClearanceItemsForRequest(requestId) {
  requireSupabase();
  if (!requestId) return [];

  const fullSelect = 'id, clearance_request_id, request_id, office_id, office_code, status, balance_amount, remarks, offices(id, code, name)';
  const canonicalSelect = 'id, clearance_request_id, office_id, office_code, status, balance_amount, remarks, offices(id, code, name)';
  const legacySelect = 'id, request_id, office_id, office_code, status, balance_amount, remarks, offices(id, code, name)';

  let result = await supabase
    .from('clearance_items')
    .select(fullSelect)
    .or(`clearance_request_id.eq.${requestId},request_id.eq.${requestId}`);
  if (!result.error) return decorateItems(result.data || []);

  if (isMissingReferenceColumn(result.error, 'request_id')) {
    result = await supabase
      .from('clearance_items')
      .select(canonicalSelect)
      .eq('clearance_request_id', requestId);
  } else if (isMissingReferenceColumn(result.error, 'clearance_request_id')) {
    result = await supabase
      .from('clearance_items')
      .select(legacySelect)
      .eq('request_id', requestId);
  }

  if (result.error) throw result.error;
  return decorateItems(result.data || []);
}

export async function fetchStudentProfile(userId) {
  requireSupabase();
  const { data: profile, error } = await supabase
    .from('users')
    .select(`
      *,
      academic_departments!users_department_id_fkey (id, code, name),
      programs (id, code, name, academic_level)
    `)
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return profile || null;
}

export async function ensureStudentClearance(userId) {
  requireSupabase();
  if (!userId) return null;

  const { data: requestId, error: rpcError } = await supabase.rpc(
    'ensure_student_clearance',
  );
  if (!rpcError) return requestId || null;
  const functionMissing = rpcError.code === '42883' || rpcError.code === 'PGRST202'
    || /ensure_student_clearance/i.test(rpcError.message || '') && /function|schema cache|not found/i.test(rpcError.message || '');
  const periodSchemaMismatch = PERIOD_REFERENCE_COLUMNS.some((column) => isMissingReferenceColumn(rpcError, column));
  if (functionMissing || periodSchemaMismatch) {
    throw new Error('Student clearance setup is incomplete. Apply the Supabase migrations in SUPABASE_DEPLOYMENT.md, then try again.');
  }
  throw rpcError;
}

export async function fetchStudentDashboard(userId) {
  requireSupabase();
  const request = await fetchStudentRequest(userId);
  if (!request) return { request: null, items: [], activities: [] };

  const items = request.clearance_items || [];
  const itemIds = items.map((item) => item.id).filter(Boolean);
  let proofs = [];
  if (itemIds.length) {
    const proofGroups = await Promise.all(itemIds.map((itemId) => fetchOfficeProofs(itemId)));
    proofs = proofGroups.flat()
      .sort((first, second) => new Date(second.created_at || second.uploaded_at || 0) - new Date(first.created_at || first.uploaded_at || 0))
      .slice(0, 8);
  }

  const proofActivities = proofs.map((proof) => {
    const proofItemId = proof.clearance_item_id || proof.item_id;
    const item = items.find((row) => row.id === proofItemId);
    return {
      id: proof.id,
      office: item?.office_name || 'Clearance office',
      description: proof.file_name ? `Uploaded ${proof.file_name}` : 'Uploaded proof document',
      created_at: proof.created_at || proof.uploaded_at,
    };
  });
  const statusActivities = items
    .filter((item) => ['APPROVED', 'HOLD'].includes(item.status))
    .map((item) => ({
      id: `status-${item.id}`,
      office: item.office_name,
      description: item.status === 'APPROVED' ? 'Clearance item approved' : `Office placed item on hold${item.remarks ? `: ${item.remarks}` : ''}`,
      created_at: item.updated_at || item.created_at || null,
    }));
  const activities = [...proofActivities, ...statusActivities]
    .sort((first, second) => new Date(second.created_at || 0) - new Date(first.created_at || 0))
    .slice(0, 8);

  return { request, items, activities };
}

export async function fetchActiveClearancePeriod() {
  requireSupabase();
  const { data, error } = await supabase
    .from('clearance_periods')
    .select('id, title, academic_year, semester, start_date, end_date, status, is_active')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function fetchStudentRequest(userId) {
  requireSupabase();
  const overview = await fetchStudentClearanceOverview(userId);
  if (!overview.request) return null;
  const period = Array.isArray(overview.request.clearance_periods)
    ? overview.request.clearance_periods[0]
    : overview.request.clearance_periods;
  return {
    ...normalizeRequestPeriod(overview.request, period),
    clearance_items: decorateItems(overview.items || []),
  };
}

export async function fetchGuidanceExitSurvey(clearanceItemId) {
  requireSupabase();
  if (!clearanceItemId) return null;
  const { data, error } = await supabase
    .from('guidance_exit_survey_responses')
    .select('id, clearance_item_id, student_id, response, created_at, updated_at')
    .eq('clearance_item_id', clearanceItemId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function submitGuidanceExitSurvey(clearanceItemId, response) {
  requireSupabase();
  if (!clearanceItemId) throw new Error('An active Guidance clearance item is required.');
  const normalizedResponse = String(response || '').trim();
  if (!normalizedResponse || normalizedResponse.length > 2000) {
    throw new Error('Write a response of 1 to 2000 characters.');
  }
  const { data, error } = await supabase.rpc('submit_guidance_exit_survey', {
    p_clearance_item_id: clearanceItemId,
    p_response: normalizedResponse,
  });
  if (error) throw error;
  return data;
}

export async function fetchOfficeProofs(clearanceItemId) {
  requireSupabase();
  if (!clearanceItemId) return [];

  let result = await supabase
    .from('clearance_proofs')
    .select('*')
    .or(`clearance_item_id.eq.${clearanceItemId},item_id.eq.${clearanceItemId}`);
  if (result.error && isMissingProofReferenceColumn(result.error, 'item_id')) {
    result = await supabase
      .from('clearance_proofs')
      .select('*')
      .eq('clearance_item_id', clearanceItemId);
  } else if (result.error && isMissingProofReferenceColumn(result.error, 'clearance_item_id')) {
    result = await supabase
      .from('clearance_proofs')
      .select('*')
      .eq('item_id', clearanceItemId);
  }
  if (result.error) throw result.error;
  return (result.data || []).sort((first, second) => new Date(second.created_at || second.uploaded_at || 0) - new Date(first.created_at || first.uploaded_at || 0));
}

export async function uploadOfficeProof({ file, item, userId, documentType = null }) {
  requireSupabase();
  const itemId = item?.id;
  const isUuid = typeof itemId === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(itemId);
  if (!isUuid) throw new Error('Clearance item record not found. Please refresh the page and try again.');
  if (!file?.uri) throw new Error('Choose a document before submitting proof.');
  const officeCode = item.office_code || item.offices?.code || getOffice(item.office_name || item.office)?.code;
  if (!officeCode) throw new Error('Could not verify this office. Reload the clearance checklist and try again.');
  if (officeCode && officeCode !== 'ACCOUNTING') {
    const request = await fetchStudentRequest(userId);
    if (!isOfficeUnlocked(officeCode, request?.clearance_items || [])) {
      throw new Error(ACCOUNTING_REQUIRED_MESSAGE);
    }
  }
  const extension = file.name?.split('.').pop()?.toLowerCase() || 'bin';
  const sourceFileName = file.name || `proof-${Date.now()}.${extension}`;
  const fileName = documentType === 'CLEARANCE_PAPER'
    ? `clearance-paper-${Date.now()}-${sourceFileName}`
    : sourceFileName;
  const storagePath = `${userId}/${itemId}/${Date.now()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const response = await fetch(file.uri);
  const blob = await response.blob();
  const contentType = file.mimeType || blob.type || 'application/octet-stream';

  const { error: uploadError } = await supabase.storage
    .from('clearance_proofs')
    .upload(storagePath, blob, { contentType, upsert: false });
  if (uploadError) throw uploadError;

  let fileUrl = null;
  try {
    const { data: signedData } = await supabase.storage.from('clearance_proofs').createSignedUrl(storagePath, 60 * 60 * 24 * 7);
    fileUrl = signedData?.signedUrl || null;
  } catch (_signedUrlError) {
    // The stored path remains the durable reference; preview URLs can be renewed later.
  }

  const proofPayload = {
    clearance_item_id: itemId,
    item_id: itemId,
    student_id: userId,
    storage_path: storagePath,
    file_name: fileName,
    ...(fileUrl ? { file_url: fileUrl } : {}),
    file_type: contentType,
    uploaded_at: new Date().toISOString(),
    ...(documentType ? { document_type: documentType } : {}),
  };

  const { data: proofId, error: insertError } = await supabase.rpc('student_create_clearance_proof', {
    p_clearance_item_id: itemId,
    p_storage_path: storagePath,
    p_file_name: fileName,
    p_mime_type: contentType,
    p_document_type: documentType || 'GENERAL',
  });
  if (insertError) {
    await supabase.storage.from('clearance_proofs').remove([storagePath]);
    if (/not eligible for proof submission/i.test(String(insertError.message || ''))) {
      try {
        const period = await fetchActiveClearancePeriod();
        if (!period) throw new Error('There is no open clearance period right now. You can submit proof when the administrator opens one.');
        const detail = officeCode === 'ACCOUNTING'
          ? 'Refresh your checklist and try again. If this continues, contact the administrator to check your account and clearance item.'
          : 'Other offices accept proof after Accounting approves your clearance paper. Refresh your checklist and try again.';
        throw new Error(`The clearance period is open, but this item cannot accept proof yet. ${detail}`);
      } catch (periodError) {
        if (/There is no open clearance period|The clearance period is open/.test(String(periodError?.message || ''))) throw periodError;
        // Keep the original server error if the period status cannot be checked.
      }
    }
    throw insertError;
  }
  return { ...proofPayload, id: proofId };
}

export async function markClearanceItemSubmitted(clearanceItemId) {
  requireSupabase();
  if (!clearanceItemId) throw new Error('The clearance item is unavailable. Refresh and try again.');
  const { error } = await supabase.rpc('student_mark_clearance_item_submitted', {
    p_item_id: clearanceItemId,
  });
  if (error) throw error;
}

export async function createProofPreviewUrl(storagePath) {
  requireSupabase();
  try {
    const { data, error } = await supabase.storage.from('clearance_proofs').createSignedUrl(storagePath, 300);
    if (error) {
      if (/bucket[^\n]*not found/i.test(String(error.message || error))) return null;
      throw error;
    }
    return data?.signedUrl || null;
  } catch (error) {
    if (/bucket[^\n]*not found/i.test(String(error?.message || error))) return null;
    throw error;
  }
}
