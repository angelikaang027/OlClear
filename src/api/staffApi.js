import { supabase } from './supabase.js';

const one = (value) => Array.isArray(value) ? value[0] || null : value || null;
const isMissingColumn = (error, column) => {
  const message = String(error?.message || '').toLowerCase();
  return (error?.code === '42703' || error?.code === 'PGRST204' || /schema cache|does not exist|could not find/i.test(message))
    && new RegExp(`(^|[^a-z0-9_])${column}($|[^a-z0-9_])`).test(message);
};

/**
 * Fetch proof metadata only for the staff member's assigned office.
 * Admins may review proofs for every office. The clearance item join is
 * intentional: office filtering is applied to the owning item, not to a
 * client-side list of proof IDs.
 */
export async function fetchOfficePendingProofs(staffProfile = {}, { clearanceItemIds = [] } = {}) {
  if (!supabase) throw new Error('Supabase is not configured.');
  if (Array.isArray(clearanceItemIds) && clearanceItemIds.length === 0) return [];

  const role = String(staffProfile.role || '').toUpperCase();
  const office = one(staffProfile.offices);
  if (role === 'ADMIN') {
    const { data, error } = await supabase
      .from('clearance_proofs')
      .select('*, clearance_items!clearance_proofs_clearance_item_id_fkey(*)')
      .order('uploaded_at', { ascending: false });
    if (error) throw error;
    return attachPreviewUrls(data || []);
  }

  const officeId = staffProfile.assigned_office_id || office?.id;
  const officeCode = String(staffProfile.office_code || office?.code || '').toUpperCase();
  if (!officeId && !officeCode) {
    throw new Error('Your staff account has no assigned office. Contact an administrator.');
  }

  const runQuery = async (itemFields, filterField, filterValue) => {
    let query = supabase
      .from('clearance_proofs')
      .select(`*, clearance_items!clearance_proofs_clearance_item_id_fkey!inner(${itemFields})`)
      .order('uploaded_at', { ascending: false });
    query = query.eq(`clearance_items.${filterField}`, filterValue);
    if (clearanceItemIds.length) query = query.in('clearance_items.id', clearanceItemIds);
    return query;
  };

  let result;
  if (officeId) {
    result = await runQuery('id, office_id, office_code', 'office_id', officeId);
    if (result.error && isMissingColumn(result.error, 'office_code')) {
      result = await runQuery('id, office_id', 'office_id', officeId);
    }
  } else {
    result = await runQuery('id, office_code', 'office_code', officeCode);
  }

  // Older schemas may not store office_code on clearance_items. Resolve the
  // office ID from public.offices, then apply the stronger ID-based filter.
  if (result.error && officeCode && isMissingColumn(result.error, 'office_code')) {
    const { data: officeRow, error: officeError } = await supabase
      .from('offices').select('id').eq('code', officeCode).maybeSingle();
    if (officeError) throw officeError;
    if (!officeRow?.id) throw result.error;
    result = await runQuery('id, office_id', 'office_id', officeRow.id);
  }

  if (result.error) throw result.error;
  return attachPreviewUrls(result.data || []);
}

async function attachPreviewUrls(proofs) {
  return Promise.all(proofs.map(async (proof) => {
    if (!proof.storage_path) return proof.file_url ? { ...proof, preview_url: proof.file_url } : proof;
    try {
      const { data, error } = await supabase.storage
        .from('clearance_proofs')
        .createSignedUrl(proof.storage_path, 5 * 60);
      if (!error && data?.signedUrl) return { ...proof, preview_url: data.signedUrl };
    } catch (_error) {
      // Keep the proof row visible; tapping it can show the storage error.
    }
    return proof;
  }));
}

export function proofClearanceItemId(proof) {
  const item = one(proof?.clearance_items);
  return item?.id || proof?.clearance_item_id || proof?.item_id || null;
}
