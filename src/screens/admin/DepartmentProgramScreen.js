import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { BookOpen, ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from 'lucide-react-native';
import { supabase } from '../../api/supabase.js';
import { AdminButton, AdminConfirmModal, AdminField, AdminPage, AdminRow, AdminSelect, DataNote, Panel, SectionTitle, DEPARTMENT_FALLBACKS, PROGRAM_FALLBACKS, ADMIN_COLORS } from './AdminUI.js';

function readableCatalogError(error) {
  const message = error?.message || 'An unexpected database error occurred.';
  if (error?.code === '42501' || /row-level security|permission denied/i.test(message)) {
    return 'Supabase denied this change. Sign in with an ADMIN account and apply the academic catalog admin RLS migration.';
  }
  if (['42703', '42P01', 'PGRST200', 'PGRST204', 'PGRST205'].includes(error?.code) || /schema cache|column .* does not exist|could not find the table/i.test(message)) {
    return 'The Supabase programs schema is missing or stale. Apply the academic catalog migration, then reload the API schema cache.';
  }
  if (error?.code === '23503') return 'This record is still referenced by student profiles or programs. Reassign those records before deleting it.';
  if (error?.code === '23505') return 'A department or program with this code already exists.';
  return message;
}

export function DepartmentProgramScreen({ navigation, embedded = false }) {
  const { width } = useWindowDimensions();
  const [departments, setDepartments] = useState(DEPARTMENT_FALLBACKS);
  const [programs, setPrograms] = useState(PROGRAM_FALLBACKS);
  const [counts, setCounts] = useState({});
  const [expanded, setExpanded] = useState('CICTE');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [departmentCode, setDepartmentCode] = useState('');
  const [level, setLevel] = useState('UNDERGRADUATE');
  const [departmentModalOpen, setDepartmentModalOpen] = useState(false);
  const [departmentEditing, setDepartmentEditing] = useState(null);
  const [departmentFormCode, setDepartmentFormCode] = useState('');
  const [departmentFormName, setDepartmentFormName] = useState('');
  const [pendingDelete, setPendingDelete] = useState(null);
  const [saving, setSaving] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [catalogError, setCatalogError] = useState('');

  const load = useCallback(async () => {
    if (!supabase) { setFallback(true); return; }
    try {
    const [departmentResult, programResult, userResult] = await Promise.all([
      supabase.from('academic_departments').select('id, code, name').order('code'),
      supabase.from('programs').select('id, code, name, academic_level, department_id').order('code'),
      supabase.from('users').select('department_id').eq('role', 'STUDENT'),
    ]);
    if (departmentResult.error) {
      setFallback(true);
      setCatalogError(`Could not load academic departments: ${departmentResult.error.message}`);
      return;
    }
    const hasLiveDepartments = Boolean(departmentResult.data?.length);
    const deptRows = hasLiveDepartments ? departmentResult.data : DEPARTMENT_FALLBACKS;
    setDepartments(deptRows);
    const deptCodeById = Object.fromEntries(deptRows.map((item) => [item.id, item.code]));
    if (!programResult.error) setPrograms((programResult.data || []).map((item) => ({ ...item, departmentCode: item.departmentCode || deptCodeById[item.department_id] })));
    else setPrograms(PROGRAM_FALLBACKS);
    if (!userResult.error) {
      const nextCounts = {};
      (userResult.data || []).forEach((item) => { nextCounts[item.department_id] = (nextCounts[item.department_id] || 0) + 1; });
      setCounts(nextCounts);
    }
    const loadError = programResult.error || userResult.error;
    setFallback(Boolean(loadError) || !hasLiveDepartments);
    setCatalogError(loadError
      ? `Could not load the live academic catalog: ${loadError.message}`
      : !hasLiveDepartments ? 'No academic departments are stored in Supabase yet. The sample list is display-only until the department rows are added.' : '');
    } catch (error) {
      setFallback(true);
      setCatalogError(`Could not load the academic catalog: ${error?.message || 'Network request failed.'}`);
    }
  }, []);
  useEffect(() => { const timer = setTimeout(load, 0); return () => clearTimeout(timer); }, [load]);

  const programsForDepartment = useMemo(() => (departmentCode) => programs.filter((program) => program.departmentCode === departmentCode || program.department_id && departments.find((department) => department.code === departmentCode)?.id === program.department_id), [programs, departments]);
  const openCreate = (deptCode) => { setEditing(null); setCode(''); setName(''); setDepartmentCode(deptCode || ''); setLevel(deptCode === 'HS' ? 'HIGH_SCHOOL' : 'UNDERGRADUATE'); setModalOpen(true); };
  const openEdit = (program) => { setEditing(program); setCode(program.code || ''); setName(program.name || ''); setDepartmentCode(program.departmentCode || ''); setLevel(program.academic_level || 'UNDERGRADUATE'); setModalOpen(true); };
  const openDepartmentForm = (department = null) => { setDepartmentEditing(department); setDepartmentFormCode(department?.code || ''); setDepartmentFormName(department?.name || ''); setDepartmentModalOpen(true); };

  const save = async () => {
    if (!code.trim() || !name.trim() || !departmentCode) { Alert.alert('Missing details', 'Enter a program code, title, department, and academic level.'); return; }
    if (!supabase) { Alert.alert('Supabase unavailable', 'The sample catalog is read-only until Supabase is configured.'); return; }
    const department = departments.find((item) => item.code === departmentCode);
    if (!department?.id) { Alert.alert('Department not available', 'Load the department from Supabase before saving a program.'); return; }
    setSaving(true);
    try {
      const payload = { code: code.trim().toUpperCase(), name: name.trim(), department_id: department.id, academic_level: level };
      const { data: duplicate, error: duplicateError } = await supabase.from('programs').select('id').eq('department_id', department.id).ilike('code', payload.code).limit(1).maybeSingle();
      if (duplicateError) throw duplicateError;
      if (duplicate && duplicate.id !== editing?.id) {
        Alert.alert('Program code already exists', `${payload.code} is already listed under ${department.code}. Choose a different code or edit the existing program.`);
        return;
      }
      const result = editing?.id
        ? await supabase.from('programs').update(payload).eq('id', editing.id).select('id, code, name, academic_level, department_id').single()
        : await supabase.from('programs').insert(payload).select('id, code, name, academic_level, department_id').single();
      if (result.error) throw result.error;
      if (!result.data?.id) throw new Error('Supabase did not return the saved program record. Check the programs table permissions and schema.');
      const savedProgram = { ...result.data, departmentCode };
      setPrograms((current) => editing
        ? current.map((item) => item.id === editing.id ? savedProgram : item)
        : [...current.filter((item) => item.id !== savedProgram.id), savedProgram]);
      setModalOpen(false);
      await load();
    } catch (error) { Alert.alert('Could not save program', readableCatalogError(error)); await load(); }
    finally { setSaving(false); }
  };

  const saveDepartment = async () => {
    if (!departmentFormCode.trim() || !departmentFormName.trim()) { Alert.alert('Missing details', 'Enter a department code and name.'); return; }
    if (!supabase) { Alert.alert('Supabase unavailable', 'The fallback department list is read-only.'); return; }
    if (departmentEditing && !departmentEditing.id) { Alert.alert('Department unavailable', 'This is a sample department. Load the live department record before editing it.'); return; }
    setSaving(true);
    try {
      const payload = { code: departmentFormCode.trim().toUpperCase(), name: departmentFormName.trim() };
      const result = departmentEditing?.id
        ? await supabase.from('academic_departments').update(payload).eq('id', departmentEditing.id).select('id, code, name').single()
        : await supabase.from('academic_departments').insert(payload).select('id, code, name').single();
      if (result.error) throw result.error;
      if (!result.data?.id) throw new Error('Supabase did not return the saved department record. Check the academic_departments permissions and schema.');
      setDepartments((current) => departmentEditing
        ? current.map((item) => item.id === departmentEditing.id ? result.data : item)
        : [...current.filter((item) => item.id !== result.data.id), result.data]);
      setDepartmentModalOpen(false); await load();
    } catch (error) { Alert.alert('Could not save department', readableCatalogError(error)); await load(); }
    finally { setSaving(false); }
  };

  const deleteProgram = (program) => setPendingDelete({ type: 'program', record: program });

  const deleteDepartment = (department) => {
    const linkedPrograms = programsForDepartment(department.code);
    if ((counts[department.id] || 0) > 0) { Alert.alert('Department is in use', 'Move its students to another department before deleting it.'); return; }
    if (linkedPrograms.length) { Alert.alert('Department has programs', 'Delete or move its programs before deleting this department.'); return; }
    setPendingDelete({ type: 'department', record: department });
  };

  const confirmDelete = async () => {
    const { type, record } = pendingDelete || {};
    if (!record?.id || !supabase) { Alert.alert('Unavailable', 'Fallback catalog rows cannot be deleted.'); return; }
    setSaving(true);
    if (type === 'program') setPrograms((current) => current.filter((item) => item.id !== record.id));
    else setDepartments((current) => current.filter((item) => item.id !== record.id));
    try {
      const result = type === 'program'
        ? await supabase.from('programs').delete().eq('id', record.id).select('id').single()
        : await supabase.from('academic_departments').delete().eq('id', record.id).select('id').single();
      if (result.error) throw result.error;
      if (!result.data?.id) throw new Error('No record was deleted. It may be protected by a student reference or database policy.');
      setPendingDelete(null);
    } catch (error) { Alert.alert('Could not delete record', readableCatalogError(error)); await load(); }
    finally { setSaving(false); }
  };

  return <AdminPage navigation={navigation} embedded={embedded} onRefresh={load} title="Departments & programs" subtitle="Academic structure settings" rightAction={<View style={styles.headerActions}><Pressable onPress={() => openDepartmentForm()} style={[styles.add, styles.addAlt]}><Plus size={17} color="#FFFFFF" /><Text style={styles.addText}>Department</Text></Pressable><Pressable onPress={() => openCreate('')} style={styles.add}><Plus size={17} color="#FFFFFF" /><Text style={styles.addText}>Program</Text></Pressable></View>}>
    {catalogError ? <DataNote error>{catalogError} Add/update requires a valid Supabase department ID and authenticated admin access.</DataNote> : fallback ? <DataNote>Showing default academic catalog while live data loads.</DataNote> : null}
    <Panel style={styles.summary}><BookOpen size={21} color={ADMIN_COLORS.green} /><Text style={styles.summaryText}>7 academic departments · {programs.length} program records</Text></Panel>
    <SectionTitle>Academic departments</SectionTitle>
    <View style={[styles.departmentGrid, width >= 600 && styles.departmentGridWide]}>{departments.map((department) => {
      const rows = programsForDepartment(department.code);
      const isOpen = expanded === department.code;
      return <Panel key={department.code} style={[styles.departmentCard, width >= 600 && styles.departmentCardWide]}>
        <View style={styles.departmentHeader}><Pressable onPress={() => setExpanded(isOpen ? '' : department.code)} style={styles.departmentToggle}><View style={styles.departmentMark}><Text style={styles.departmentMarkText}>{department.code.slice(0, 2)}</Text></View><View style={styles.departmentCopy}><Text style={styles.departmentCode}>{department.code}</Text><Text style={styles.departmentName}>{department.name}</Text></View><View style={styles.count}><Text style={styles.countText}>{counts[department.id] || 0}</Text></View>{isOpen ? <ChevronUp size={18} color={ADMIN_COLORS.green} /> : <ChevronDown size={18} color={ADMIN_COLORS.green} />}</Pressable><View style={styles.departmentActions}><Pressable onPress={() => openDepartmentForm(department)}><Pencil size={15} color={ADMIN_COLORS.green} /></Pressable><Pressable onPress={() => deleteDepartment(department)}><Trash2 size={15} color={ADMIN_COLORS.red} /></Pressable></View></View>
        {isOpen ? <View style={styles.programArea}><View style={styles.programTitleRow}><Text style={styles.programTitle}>Programs</Text><Pressable onPress={() => openCreate(department.code)}><Text style={styles.addProgram}>+ Add</Text></Pressable></View>{rows.length ? rows.map((program) => <AdminRow key={program.id || `${department.code}-${program.code}`} title={`${program.code} · ${program.name}`} detail={program.academic_level?.replaceAll('_', ' ') || 'Academic level not set'} right={<View style={styles.programActions}><Pressable style={styles.editButton} onPress={() => openEdit(program)} accessibilityRole="button"><Pencil size={14} color={ADMIN_COLORS.green} /></Pressable><Pressable style={styles.editButton} onPress={() => deleteProgram(program)} accessibilityRole="button"><Trash2 size={14} color={ADMIN_COLORS.red} /></Pressable></View>} />) : <Text style={styles.noProgram}>No programs listed for this department yet.</Text>}</View> : null}
      </Panel>;
    })}</View>
    <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={() => setModalOpen(false)}><View style={styles.modalBackdrop}><ScrollView style={styles.modalCard} contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="always"><Text style={styles.modalTitle}>{editing ? 'Edit program' : 'Add program'}</Text><AdminField label="Program code" value={code} onChangeText={setCode} placeholder="BSIT" /><AdminField label="Degree / program title" value={name} onChangeText={setName} placeholder="Bachelor of Science in Information Technology" /><AdminSelect label="Department" value={departmentCode} options={departments.map((item) => item.code)} onChange={setDepartmentCode} placeholder="Choose department" /><AdminSelect label="Academic level" value={level} options={['HIGH_SCHOOL', 'UNDERGRADUATE', 'POSTGRADUATE']} onChange={setLevel} /><AdminButton title={editing ? 'Save changes' : 'Add program'} onPress={save} loading={saving} /><AdminButton title="Cancel" secondary onPress={() => setModalOpen(false)} /></ScrollView></View></Modal>
    <Modal visible={departmentModalOpen} transparent animationType="slide" onRequestClose={() => setDepartmentModalOpen(false)}><View style={styles.modalBackdrop}><ScrollView style={styles.modalCard} contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="always"><Text style={styles.modalTitle}>{departmentEditing ? 'Edit department' : 'Add department'}</Text><AdminField label="Department code" value={departmentFormCode} onChangeText={setDepartmentFormCode} placeholder="CICTE" /><AdminField label="Department name" value={departmentFormName} onChangeText={setDepartmentFormName} placeholder="College or school name" /><AdminButton title={departmentEditing ? 'Save changes' : 'Add department'} onPress={saveDepartment} loading={saving} /><AdminButton title="Cancel" secondary onPress={() => setDepartmentModalOpen(false)} /></ScrollView></View></Modal>
    <AdminConfirmModal visible={Boolean(pendingDelete)} title={pendingDelete?.type === 'program' ? 'Delete program?' : 'Delete department?'} message={pendingDelete?.type === 'program' ? `${pendingDelete?.record?.code} will be removed. Supabase foreign keys will block deletion if student profiles still reference it.` : `${pendingDelete?.record?.code} will be removed. Deletion is blocked while students or programs are assigned to it.`} confirmLabel="Delete" destructive onCancel={() => setPendingDelete(null)} onConfirm={confirmDelete} busy={saving} />
  </AdminPage>;
}

const styles = StyleSheet.create({ headerActions: { flexDirection: 'row', gap: 6 }, add: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: ADMIN_COLORS.green, paddingHorizontal: 10, paddingVertical: 9, borderRadius: 11 }, addAlt: { backgroundColor: '#426A4A' }, addText: { color: '#FFFFFF', fontWeight: '900', fontSize: 12 }, summary: { flexDirection: 'row', alignItems: 'center', gap: 9 }, summaryText: { color: ADMIN_COLORS.ink, fontSize: 14, fontWeight: '800' }, departmentGridWide: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }, departmentCard: { padding: 0, overflow: 'hidden' }, departmentCardWide: { width: '49%' }, departmentHeader: { minHeight: 76, padding: 13, flexDirection: 'row', gap: 8, alignItems: 'center' }, departmentToggle: { flexDirection: 'row', gap: 9, alignItems: 'center', flex: 1 }, departmentActions: { flexDirection: 'row', gap: 8 }, departmentMark: { width: 40, height: 40, borderRadius: 13, backgroundColor: '#EAF0E6', alignItems: 'center', justifyContent: 'center' }, departmentMarkText: { color: ADMIN_COLORS.green, fontWeight: '900', fontSize: 12 }, departmentCopy: { flex: 1 }, departmentCode: { color: ADMIN_COLORS.ink, fontSize: 14, fontWeight: '900' }, departmentName: { color: ADMIN_COLORS.muted, fontSize: 11, lineHeight: 15, marginTop: 2 }, count: { minWidth: 31, height: 27, paddingHorizontal: 6, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1F4EF' }, countText: { color: ADMIN_COLORS.green, fontWeight: '900', fontSize: 12 }, programArea: { borderTopWidth: 1, borderTopColor: ADMIN_COLORS.line, paddingHorizontal: 14, paddingBottom: 9 }, programTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 41 }, programTitle: { color: ADMIN_COLORS.muted, fontWeight: '900', fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase' }, addProgram: { color: ADMIN_COLORS.green, fontSize: 12, fontWeight: '900' }, programActions: { flexDirection: 'row', gap: 5 }, editButton: { width: 30, height: 30, borderRadius: 9, backgroundColor: '#EAF0E6', alignItems: 'center', justifyContent: 'center' }, noProgram: { color: ADMIN_COLORS.muted, fontSize: 12, paddingVertical: 11 }, modalBackdrop: { flex: 1, backgroundColor: 'rgba(13,35,19,0.5)', justifyContent: 'center', alignItems: 'center', padding: 17 }, modalCard: { width: '100%', maxWidth: 550, maxHeight: '94%', backgroundColor: '#FFFFFF', borderRadius: 19, padding: 17 }, modalContent: { paddingBottom: 5 }, modalTitle: { color: ADMIN_COLORS.ink, fontSize: 20, fontWeight: '900', marginBottom: 13 },
});
