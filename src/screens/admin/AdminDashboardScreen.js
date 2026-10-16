import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, RefreshControl, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { Activity, ArrowUp, Building2, Check, ChevronRight, ClipboardCheck, FileText, Home, LogOut, Menu, Search, Settings, ShieldCheck, Stethoscope, UsersRound, Bell, X } from 'lucide-react-native';
import { useAuth } from '../../context/AuthContext.js';
import { OFFICES } from '../../constants/offices.js';
import { supabase } from '../../api/supabase.js';
import { UserManagementScreen } from './UserManagementScreen.js';
import { DepartmentProgramScreen } from './DepartmentProgramScreen.js';
import { ClearanceOverrideScreen } from './ClearanceOverrideScreen.js';
import { SystemAnalyticsScreen } from './SystemAnalyticsScreen.js';
import { ClearancePeriodsScreen } from './ClearancePeriodsScreen.js';
import { AdminConfirmModal } from './AdminUI.js';

const COLORS = {
  green: '#1b4332', greenDeep: '#163b24', greenSoft: '#e8f0e9', canvas: '#f4f6f4',
  white: '#ffffff', ink: '#1c2921', muted: '#76827a', line: '#e5ebe6',
  blue: '#2563eb', emerald: '#16a34a', amber: '#ca8a04', red: '#dc2626',
};

const NAV_ITEMS = [
  { key: 'Home', label: 'Home', icon: Home },
  { key: 'UserManagement', label: 'User Management', icon: UsersRound },
  { key: 'DepartmentProgram', label: 'Department', icon: Building2 },
  { key: 'AdminClearance', label: 'Approval', icon: ClipboardCheck },
  { key: 'SystemAnalytics', label: 'Reports', icon: FileText },
  { key: 'ClearancePeriods', label: 'Settings', icon: Settings },
];

const OFFICE_LABELS = {
  ACCOUNTING: 'Accounting', REGISTRAR: 'Registrar', DEAN: "Dean's Office", DIRECTOR_SAS: 'Student Affairs',
  GUIDANCE: 'Guidance', ADVISER: 'Org Adviser', PROPERTY: 'Property Custodian', LIBRARIAN: 'Library',
  COUNCIL: 'CSSC', CLINIC: 'Clinic / Medical',
};

const EMPTY_DASHBOARD = {
  requests: 0,
  completed: 0,
  pending: 0,
  hold: 0,
  period: 'Live data unavailable',
  offices: OFFICES.map((office) => ({ ...office, name: OFFICE_LABELS[office.code] || office.label, pending: 0, clear: 0 })),
  progressByDepartment: [],
  progressByLevel: [],
  activity: [],
};

function getRelated(value) { return Array.isArray(value) ? value[0] : value; }

function getRelativeTime(value) {
  if (!value) return 'Recently';
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'Recently';
  const minutes = Math.max(1, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function StatCard({ title, count, subtitle, accent, icon: Icon, wide, onPress }) {
  return <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.statCard, wide && styles.statCardWide, pressed && styles.cardPressed]}>
    <View style={[styles.statAccent, { backgroundColor: accent }]} />
    <View style={styles.statHead}><Text style={styles.statLabel}>{title}</Text><Icon size={18} color={accent} /></View>
    <Text style={styles.statNumber}>{count}</Text>
    <Text style={styles.statSubtitle}>{subtitle}</Text>
  </Pressable>;
}

function OfficeMetric({ office, wide, onPress }) {
  const Icon = office.code === 'CLINIC' ? Stethoscope : office.icon || Building2;
  const bottleneck = office.pending >= 3;
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${office.name}: ${office.pending} pending and ${office.clear} approved`} style={({ pressed }) => [styles.officeCard, wide && styles.officeCardWide, pressed && styles.cardPressed]}>
    <View style={styles.officeTitleRow}><View style={styles.officeIcon}><Icon size={16} color={COLORS.green} /></View><Text numberOfLines={1} style={styles.officeTitle}>{office.name}</Text>{bottleneck ? <Text style={styles.officeFlag}>BOTTLENECK</Text> : null}</View>
    <View style={styles.officeCounts}><Text style={styles.pendingCount}>{office.pending} pending</Text><Text style={styles.clearCount}>{office.clear} clear</Text></View>
    <View style={styles.officeBar}><View style={[styles.officeBarClear, { flex: Math.max(1, office.clear) }]} /><View style={[styles.officeBarPending, { flex: Math.max(1, office.pending) }]} /></View>
  </Pressable>;
}

export function AdminDashboardScreen({ navigation }) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1200;
  const isTablet = width >= 768 && width < 1200;
  const fourStats = width >= 1420;
  const { user, profile, signOut } = useAuth();
  const [dashboard, setDashboard] = useState(EMPTY_DASHBOARD);
  const [loading, setLoading] = useState(true);
  const [activityFallback, setActivityFallback] = useState(false);
  const [queueFallback, setQueueFallback] = useState(false);
  const [activeTab, setActiveTab] = useState('Home');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedOfficeCode, setSelectedOfficeCode] = useState('All offices');
  const [requestStatusFilter, setRequestStatusFilter] = useState('ALL');
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [signOutConfirmOpen, setSignOutConfirmOpen] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const scrollRef = useRef(null);

  const fetchActivityLogs = useCallback(async () => {
    if (!supabase) { setActivityFallback(true); return; }
    try {
      const { data, error } = await supabase.from('clearance_items').select('id, status, updated_at, remarks, offices(code, name), clearance_requests(users(full_name, student_id_number))').order('updated_at', { ascending: false }).limit(6);
      if (error) throw error;
      const activity = (data || []).map((item) => {
        const request = getRelated(item.clearance_requests);
        const student = getRelated(request?.users);
        const office = getRelated(item.offices);
        return {
          id: item.id,
          name: student?.full_name || 'Student account',
          studentId: student?.student_id_number || 'Student ID unavailable',
          office: OFFICE_LABELS[office?.code] || office?.name || 'Office',
          officeCode: office?.code,
          status: item.status || 'PENDING',
          remarks: item.remarks || '',
          time: getRelativeTime(item.updated_at),
        };
      });
      setDashboard((current) => ({ ...current, activity }));
      setActivityFallback(false);
    } catch {
      setDashboard((current) => ({ ...current, activity: [] }));
      setActivityFallback(true);
    }
  }, []);

  const fetchOfficeQueueSummary = useCallback(async () => {
    if (!supabase) { setQueueFallback(true); return; }
    try {
      const { error: activationError } = await supabase.rpc('activate_due_clearance_period');
      if (activationError) throw activationError;
      const { data: period, error: periodError } = await supabase.from('clearance_periods').select('id, title, academic_year, semester').eq('is_active', true).maybeSingle();
      if (periodError) throw periodError;
      const officeCounts = Object.fromEntries(OFFICES.map((office) => [office.code, { ...office, name: OFFICE_LABELS[office.code] || office.label, pending: 0, clear: 0 }]));
      if (!period?.id) {
        setDashboard((current) => ({ ...current, requests: 0, completed: 0, pending: 0, hold: 0, period: 'No active clearance period', offices: Object.values(officeCounts), progressByDepartment: [], progressByLevel: [] }));
        setQueueFallback(false);
        return;
      }
      const [{ data: requests, error }, { data: students, error: studentsError }, { data: departments, error: departmentsError }] = await Promise.all([
        supabase.from('clearance_requests').select('id, student_id, clearance_items(id, status, offices(code, name))').eq('clearance_period_id', period.id).neq('overall_status', 'VOIDED'),
        supabase.from('users').select('id, role::text, academic_level::text, department_id, academic_departments(code)').eq('role', 'STUDENT'),
        supabase.from('academic_departments').select('id, code'),
      ]);
      if (error) throw error;
      if (studentsError) throw studentsError;
      if (departmentsError) throw departmentsError;
      let pending = 0;
      let hold = 0;
      let completed = 0;
      (requests || []).forEach((request) => {
        const items = request.clearance_items || [];
        if (items.length === OFFICES.length && items.every((item) => item.status === 'APPROVED')) completed += 1;
        if (items.some((item) => ['PENDING', 'SUBMITTED', 'IN_REVIEW', 'IN_PROGRESS'].includes(String(item.status || '').toUpperCase()))) pending += 1;
        if (items.some((item) => ['REJECTED', 'REQUIREMENT_NEEDED', 'HOLD'].includes(item.status))) hold += 1;
        items.forEach((item) => {
          const office = getRelated(item.offices);
          const code = office?.code;
          if (!code || !officeCounts[code]) return;
          if (item.status === 'APPROVED') officeCounts[code].clear += 1;
          else if (['PENDING', 'SUBMITTED', 'IN_REVIEW', 'IN_PROGRESS'].includes(String(item.status || '').toUpperCase())) officeCounts[code].pending += 1;
        });
      });
      const studentById = Object.fromEntries((students || []).map((student) => [student.id, student]));
      const departmentById = Object.fromEntries((departments || []).map((department) => [department.id, department]));
      const departmentStats = {};
      const levelStats = {};
      (requests || []).forEach((request) => {
        const student = studentById[request.student_id];
        if (!student) return;
        const relation = getRelated(student.academic_departments);
        const departmentCode = relation?.code || departmentById[student.department_id]?.code || 'Unassigned';
        const level = String(student.academic_level || 'UNSPECIFIED').toUpperCase();
        const cleared = (request.clearance_items || []).length === OFFICES.length
          && request.clearance_items.every((item) => item.status === 'APPROVED');
        [
          [departmentStats, departmentCode],
          [levelStats, level],
        ].forEach(([group, key]) => {
          if (!group[key]) group[key] = { label: key, total: 0, cleared: 0 };
          group[key].total += 1;
          if (cleared) group[key].cleared += 1;
        });
      });
      const toProgressRows = (stats) => Object.values(stats).map((row) => ({
        ...row,
        percent: row.total ? Math.round((row.cleared / row.total) * 100) : 0,
      })).sort((a, b) => a.label.localeCompare(b.label));
      setDashboard((current) => ({
        ...current,
        requests: (requests || []).length,
        completed,
        pending,
        hold,
        period: period.title || `${period.semester || ''} ${period.academic_year || ''}`.trim(),
        offices: Object.values(officeCounts).sort((a, b) => b.pending - a.pending),
        progressByDepartment: toProgressRows(departmentStats),
        progressByLevel: toProgressRows(levelStats),
      }));
      setQueueFallback(false);
    } catch {
      setDashboard((current) => ({ ...current, ...EMPTY_DASHBOARD, activity: current.activity }));
      setQueueFallback(true);
    }
  }, []);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchActivityLogs(), fetchOfficeQueueSummary()]);
    setLoading(false);
  }, [fetchActivityLogs, fetchOfficeQueueSummary]);

  useEffect(() => {
    const timer = setTimeout(loadDashboard, 0);
    return () => clearTimeout(timer);
  }, [loadDashboard]);

  useEffect(() => {
    if (!supabase) return undefined;
    const channel = supabase.channel('admin-dashboard-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clearance_items' }, () => {
        fetchActivityLogs();
        fetchOfficeQueueSummary();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clearance_requests' }, fetchOfficeQueueSummary)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchActivityLogs, fetchOfficeQueueSummary]);

  const visibleActivity = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return dashboard.activity;
    return dashboard.activity.filter((item) => `${item.name} ${item.studentId} ${item.office}`.toLowerCase().includes(query));
  }, [dashboard.activity, search]);
  const fallback = activityFallback || queueFallback;

  const onNavigate = (item) => {
    setActiveTab(item.key);
    setDrawerOpen(false);
  };

  const openApprovalQueue = (officeCode = 'All offices', status = 'ALL') => {
    setSelectedOfficeCode(officeCode || 'All offices');
    setRequestStatusFilter(status);
    setActiveTab('AdminClearance');
    setDrawerOpen(false);
  };

  const onMetricPress = (status) => openApprovalQueue('All offices', status);

  const childNavigation = {
    goBack: () => setActiveTab('Home'),
    navigate: (...args) => navigation.navigate(...args),
    setParams: (params) => { if (params?.officeCode === null) setSelectedOfficeCode('All offices'); },
  };
  const renderActiveSubview = () => {
    if (activeTab === 'UserManagement') return <UserManagementScreen navigation={childNavigation} embedded />;
    if (activeTab === 'DepartmentProgram') return <DepartmentProgramScreen navigation={childNavigation} embedded />;
    if (activeTab === 'AdminClearance') return <ClearanceOverrideScreen navigation={childNavigation} searchQuery={search} onSearchChange={setSearch} selectedOfficeCode={selectedOfficeCode} selectedRequestStatus={requestStatusFilter} onOfficeFilterChange={setSelectedOfficeCode} embedded />;
    if (activeTab === 'SystemAnalytics') return <SystemAnalyticsScreen navigation={childNavigation} embedded />;
    if (activeTab === 'ClearancePeriods') return <ClearancePeriodsScreen navigation={childNavigation} embedded />;
    return null;
  };
  const notifications = [
    ...(dashboard.period === 'No active clearance period' ? [{ id: 'period', title: 'No active clearance period', detail: 'Open a period to start clearance processing.', action: () => setActiveTab('ClearancePeriods') }] : []),
    ...dashboard.offices.filter((office) => office.pending > 0).sort((a, b) => b.pending - a.pending).slice(0, 3).map((office) => ({ id: office.code, title: `${office.name} has ${office.pending} pending`, detail: `${office.clear} clearance items approved.`, action: () => openApprovalQueue(office.code, 'ALL') })),
  ];

  const onSignOut = async () => {
    setSignOutBusy(true);
    try {
      await signOut();
      setSignOutConfirmOpen(false);
      navigation.reset({ index: 0, routes: [{ name: 'Landing' }] });
    } catch (error) { Alert.alert('Sign out failed', error.message); }
    finally { setSignOutBusy(false); }
  };

  const sidebar = <View style={[styles.sidebar, isDesktop && styles.sidebarDesktop, isTablet && styles.sidebarTablet]}>
    <View style={styles.brandRow}><View style={styles.brandIcon}><ShieldCheck size={22} color={COLORS.green} /></View><View><Text style={styles.brandName}>OLClear</Text><Text style={styles.brandSub}>Admin Portal</Text></View></View>
    <Text style={styles.navCaption}>WORKSPACE</Text>
    {NAV_ITEMS.map((item) => {
      const Icon = item.icon;
      const selected = activeTab === item.key;
      return <Pressable key={item.key} onPress={() => onNavigate(item)} accessibilityRole="button" accessibilityState={{ selected }} style={({ pressed, hovered }) => [styles.navItem, selected && styles.navItemActive, (pressed || hovered) && !selected && styles.navItemHover]}>
        <Icon size={18} color={selected ? COLORS.green : '#d1ded4'} /><Text style={[styles.navLabel, selected && styles.navLabelActive]}>{item.label}</Text>{selected ? <View style={styles.navActiveMark} /> : null}
      </Pressable>;
    })}
    <View style={styles.sidebarSpacer} />
    <View style={styles.profileCard}><View style={styles.avatar}><Text style={styles.avatarText}>{(profile?.full_name || 'Admin').charAt(0).toUpperCase()}</Text></View><View style={styles.profileCopy}><Text numberOfLines={1} style={styles.profileName}>{profile?.full_name || 'Admin'}</Text><Text numberOfLines={1} style={styles.profileEmail}>{profile?.email || user?.email || 'admin.wlcormoc.edu.ph'}</Text></View></View>
    <Pressable onPress={() => setSignOutConfirmOpen(true)} accessibilityRole="button" accessibilityLabel="Log out" style={({ pressed }) => [styles.logoutButton, pressed && styles.logoutPressed]}><LogOut size={17} color="#fff" /><Text style={styles.logoutText}>Log Out</Text></Pressable>
  </View>;

  return <SafeAreaView style={styles.safe}>
    {!isDesktop ? <View style={styles.mobileTopbar}><Pressable accessibilityRole="button" accessibilityLabel={drawerOpen ? 'Close navigation menu' : 'Open navigation menu'} onPress={() => setDrawerOpen((open) => !open)} style={styles.menuButton}>{drawerOpen ? <X size={21} color={COLORS.green} /> : <Menu size={21} color={COLORS.green} />}</Pressable><Text style={styles.mobileBrand}>OLClear <Text style={styles.mobileBrandSub}>Admin</Text></Text><Pressable onPress={() => setNotificationsOpen(true)} accessibilityRole="button" accessibilityLabel="Open notifications" style={styles.mobileBell}><Bell size={19} color={COLORS.green} /><View style={styles.notificationDot} /></Pressable></View> : null}
    <View style={styles.appRow}>
      {(isDesktop || isTablet) ? sidebar : null}
      <ScrollView
        ref={scrollRef}
        style={styles.workspaceScroll}
        contentContainerStyle={styles.workspaceContent}
        showsVerticalScrollIndicator
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={120}
        onScroll={(event) => setShowScrollTop(event.nativeEvent.contentOffset.y > 200)}
        refreshControl={activeTab === 'Home' ? <RefreshControl refreshing={loading} onRefresh={loadDashboard} tintColor={COLORS.green} colors={[COLORS.green]} /> : undefined}
      >
        <View style={[styles.workspaceRow, isDesktop && styles.workspaceRowDesktop]}>
        <View style={[styles.centerPanel, isDesktop && styles.centerPanelDesktop]}>
        {!isDesktop && !isTablet && drawerOpen ? <View style={styles.drawer}>{sidebar}</View> : null}
        <View style={[styles.contentHeader, !isTablet && !isDesktop && styles.contentHeaderMobile]}>
          <View style={styles.pageTitleBlock}><Text numberOfLines={1} style={styles.pageTitle}>Clearance Dashboard</Text><Text numberOfLines={1} style={styles.pageSubtitle}>Welcome back, {profile?.full_name?.split(' ')[0] || 'Admin'}</Text></View>
          <View style={[styles.headerActions, !isTablet && !isDesktop && styles.headerActionsMobile]}><View style={styles.searchBox}><Search size={17} color={COLORS.muted} /><TextInput value={search} onChangeText={setSearch} placeholder="Search Students, ID's..." placeholderTextColor="#96a19a" style={styles.searchInput} returnKeyType="search" />{search ? <Pressable onPress={() => setSearch('')} accessibilityRole="button" accessibilityLabel="Clear student search" hitSlop={7}><X size={16} color={COLORS.muted} /></Pressable> : null}</View><Pressable onPress={() => setNotificationsOpen(true)} accessibilityRole="button" accessibilityLabel="Open notifications" style={styles.bellButton}><Bell size={19} color={COLORS.green} /><View style={styles.notificationDot} /></Pressable></View>
        </View>
        {activeTab !== 'Home' ? <View style={styles.subviewContainer}>{renderActiveSubview()}</View> : <>
        {fallback ? <View style={styles.fallback}><Text style={styles.fallbackText}>Live dashboard data is unavailable. Counts and activity are withheld until Supabase can be reached.</Text></View> : null}
        <View style={styles.activePeriodRow}><View><Text style={styles.periodEyebrow}>ACTIVE CLEARANCE PERIOD</Text><Text style={styles.periodTitle}>{dashboard.period}</Text></View><View style={styles.activeBadge}><View style={styles.activeDot} /><Text style={styles.activeBadgeText}>{dashboard.period === 'No active clearance period' ? 'CLOSED' : 'ACTIVE'}</Text></View></View>

        <View style={styles.sectionHeading}><View><Text style={styles.sectionTitle}>Clearance Operations Overview</Text><Text style={styles.sectionSub}>Current status across student requests</Text></View><Pressable onPress={loadDashboard} style={styles.refreshButton}><Activity size={15} color={COLORS.green} /><Text style={styles.refreshText}>Refresh</Text></Pressable></View>
        <View style={[styles.statsGrid, fourStats && styles.statsGridDesktop]}>
          <StatCard wide={fourStats} onPress={() => onMetricPress('ALL')} title="TOTAL REQUESTS" count={dashboard.requests} subtitle="Active clearance requests" accent={COLORS.blue} icon={FileText} />
          <StatCard wide={fourStats} onPress={() => onMetricPress('CLEARED')} title="FULLY CLEARED" count={dashboard.completed} subtitle="All offices approved" accent={COLORS.emerald} icon={Check} />
          <StatCard wide={fourStats} onPress={() => onMetricPress('PENDING_ACTIONS')} title="PENDING ACTIONS" count={dashboard.pending} subtitle="Across all offices" accent={COLORS.amber} icon={Activity} />
          <StatCard wide={fourStats} onPress={() => onMetricPress('ON_HOLD')} title="ON HOLD" count={dashboard.hold} subtitle="Requires student action" accent={COLORS.red} icon={ShieldCheck} />
        </View>

        <View style={styles.sectionHeading}><View><Text style={styles.sectionTitle}>Clearance Status by Office</Text><Text style={styles.sectionSub}>Pending and approved items by signatory office</Text></View><Text style={styles.officeTotal}>10 OFFICES</Text></View>
        <View style={styles.officesPanel}><View style={styles.officeGrid}>{dashboard.offices.map((office) => <OfficeMetric key={office.code} office={office} wide={isDesktop} onPress={() => openApprovalQueue(office.code, 'ALL')} />)}</View></View>
        <View style={[styles.analyticsGroups, isDesktop && styles.analyticsGroupsWide]}>
          <ProgressGroup title="Completion by department" rows={dashboard.progressByDepartment || []} />
          <ProgressGroup title="Completion by academic level" rows={dashboard.progressByLevel || []} />
        </View>
        {loading ? <View style={styles.loading}><ActivityIndicator color={COLORS.green} /><Text style={styles.loadingText}>Loading latest clearance data...</Text></View> : null}
        {!isDesktop ? <ActivityPanel items={visibleActivity} search={search} onViewAll={() => setActiveTab('SystemAnalytics')} onSelectOffice={(officeCode) => openApprovalQueue(officeCode, 'ALL')} /> : null}
        </>}
      </View>
      {isDesktop && activeTab === 'Home' ? <View style={[styles.rightRail, styles.rightRailResponsive]}>
        <ActivityPanel items={visibleActivity} search={search} onViewAll={() => setActiveTab('SystemAnalytics')} onSelectOffice={(officeCode) => openApprovalQueue(officeCode, 'ALL')} />
        <View style={styles.queuePanel}><Text style={styles.railTitle}>Office Queue Summary</Text><Text style={styles.railSubtitle}>Pending requests by office</Text>{dashboard.offices.slice().sort((a, b) => b.pending - a.pending).map((office) => <Pressable key={office.code} onPress={() => openApprovalQueue(office.code, 'ALL')} accessibilityRole="button" accessibilityLabel={`${office.name}: ${office.pending} pending and ${office.clear} clear`} style={({ pressed }) => [styles.queuePill, pressed && styles.queuePillPressed]}><Text numberOfLines={1} style={styles.queueName}>{office.name}</Text><View style={styles.queueCounts}><Text style={styles.queuePending}>{office.pending} pending</Text><Text style={styles.queueClear}>{office.clear} clear</Text></View></Pressable>)}</View>
      </View> : null}
        </View>
      </ScrollView>
    </View>
    {showScrollTop ? <Pressable
      onPress={() => scrollRef.current?.scrollTo({ y: 0, animated: true })}
      accessibilityRole="button"
      accessibilityLabel="Scroll dashboard to top"
      style={[styles.scrollTopButton, isDesktop && styles.scrollTopButtonDesktop]}
    ><ArrowUp size={21} color="#FFFFFF" /></Pressable> : null}
    <Modal visible={notificationsOpen} transparent animationType="fade" onRequestClose={() => setNotificationsOpen(false)}>
      <View style={styles.modalBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setNotificationsOpen(false)} accessibilityRole="button" accessibilityLabel="Close notifications" />
        <View style={styles.notificationModal}>
          <View style={styles.notificationHeader}><View><Text style={styles.notificationTitle}>System alerts</Text><Text style={styles.notificationSubtitle}>Current clearance period</Text></View><Pressable onPress={() => setNotificationsOpen(false)} accessibilityRole="button" accessibilityLabel="Close notifications"><X size={20} color={COLORS.muted} /></Pressable></View>
          {notifications.length ? notifications.map((item) => <Pressable key={item.id} onPress={() => { setNotificationsOpen(false); item.action(); }} style={styles.notificationItem}><View style={styles.notificationBullet} /><View style={styles.notificationCopy}><Text style={styles.notificationItemTitle}>{item.title}</Text><Text style={styles.notificationItemDetail}>{item.detail}</Text></View><ChevronRight size={17} color={COLORS.muted} /></Pressable>) : <Text style={styles.noNotifications}>No pending office queues or period alerts.</Text>}
        </View>
      </View>
    </Modal>
    <AdminConfirmModal
      visible={signOutConfirmOpen}
      title="Log out of the Admin Portal?"
      message="You will need to sign in again to manage clearance periods, accounts, and approvals."
      confirmLabel="Log Out"
      destructive
      busy={signOutBusy}
      onCancel={() => setSignOutConfirmOpen(false)}
      onConfirm={onSignOut}
    />
  </SafeAreaView>;
}

function ActivityPanel({ items, search, onViewAll, onSelectOffice }) {
  return <View style={styles.activityPanel}><View style={styles.railHeadingRow}><View><Text style={styles.railTitle}>Activity Log</Text><Text style={styles.railSubtitle}>{search ? 'Matching recent activity' : 'Recent student updates'}</Text></View><Pressable onPress={onViewAll} hitSlop={8}><ChevronRight size={19} color={COLORS.muted} /></Pressable></View>
    {items.length ? items.slice(0, 8).map((item) => {
      const actionNeeded = ['HOLD', 'REJECTED', 'REQUIREMENT_NEEDED'].includes(item.status);
      const statusText = item.status === 'APPROVED' ? 'Clearance approved' : actionNeeded ? 'Action needed' : item.status === 'PENDING' ? 'Request is pending' : 'Review in progress';
      return <Pressable key={item.id} onPress={() => onSelectOffice?.(item.officeCode)} style={({ pressed }) => [styles.activityItem, pressed && styles.activityPressed]} accessibilityRole="button" accessibilityLabel={`${item.name}, ${item.studentId}, ${item.office}, ${statusText}`}><View style={[styles.statusDot, item.status === 'APPROVED' ? styles.dotGreen : actionNeeded ? styles.dotRed : styles.dotAmber]} /><View style={styles.activityCopy}><View style={styles.activityNameRow}><Text numberOfLines={1} style={styles.activityName}>{item.name}</Text><Text style={styles.activityTime}>{item.time}</Text></View><Text numberOfLines={1} style={styles.activityMeta}>{item.studentId} · {item.office}</Text><Text style={styles.activityStatus}>{statusText}</Text></View></Pressable>;
    }) : <Text style={styles.emptyActivity}>No activity matches this search.</Text>}
  </View>;
}

function ProgressGroup({ title, rows }) {
  return <View style={styles.progressPanel}>
    <Text style={styles.progressPanelTitle}>{title}</Text>
    {rows.length ? rows.map((row) => <View key={row.label} style={styles.progressMetric}>
      <View style={styles.progressMetricHeader}><Text style={styles.progressMetricLabel}>{row.label.replaceAll('_', ' ')}</Text><Text style={styles.progressMetricPercent}>{row.percent}%</Text></View>
      <View style={styles.progressMetricTrack}><View style={[styles.progressMetricFill, { width: `${row.percent}%` }]} /></View>
      <Text style={styles.progressMetricCaption}>{row.cleared} of {row.total} students cleared</Text>
    </View>) : <Text style={styles.progressEmpty}>No active student requests.</Text>}
  </View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.canvas },
  mobileTopbar: { height: 58, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, backgroundColor: COLORS.white, borderBottomWidth: 1, borderBottomColor: COLORS.line, gap: 12 },
  menuButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: COLORS.greenSoft },
  mobileBrand: { flex: 1, fontSize: 17, color: COLORS.green, fontWeight: '900' }, mobileBrandSub: { color: COLORS.muted, fontSize: 12, fontWeight: '600' }, mobileBell: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  appRow: { flex: 1, flexDirection: 'row', minHeight: 0, minWidth: 0 },
  sidebar: { width: 250, height: '100%', backgroundColor: COLORS.green, paddingHorizontal: 16, paddingTop: 23, paddingBottom: 18, minHeight: 600 },
  sidebarDesktop: { width: 260 }, sidebarTablet: { width: 224, paddingHorizontal: 12 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 5, marginBottom: 35 },
  brandIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: '#d9ec67', alignItems: 'center', justifyContent: 'center' },
  brandName: { color: '#fff', fontSize: 20, fontWeight: '900', letterSpacing: 0.2 }, brandSub: { color: '#c3d4c7', fontSize: 11, marginTop: 1 },
  navCaption: { color: '#a8c0ad', fontSize: 10, fontWeight: '900', letterSpacing: 1.3, marginHorizontal: 11, marginBottom: 10 },
  navItem: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, marginBottom: 5, borderRadius: 12 },
  navItemActive: { backgroundColor: '#e7efe8' }, navItemHover: { backgroundColor: 'rgba(255,255,255,0.1)' },
  navLabel: { flex: 1, color: '#e2ebe4', fontSize: 13, fontWeight: '700' }, navLabelActive: { color: COLORS.green, fontWeight: '900' }, navActiveMark: { width: 5, height: 20, borderRadius: 4, backgroundColor: '#9fcb68' },
  sidebarSpacer: { flex: 1, minHeight: 35 }, profileCard: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 9, marginBottom: 10, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.09)' },
  avatar: { width: 35, height: 35, borderRadius: 18, backgroundColor: '#d9ec67', alignItems: 'center', justifyContent: 'center' }, avatarText: { color: COLORS.greenDeep, fontWeight: '900', fontSize: 15 }, profileCopy: { flex: 1 }, profileName: { color: '#fff', fontWeight: '800', fontSize: 12 }, profileEmail: { color: '#b6c9ba', fontSize: 10, marginTop: 2 },
  logoutButton: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 11, backgroundColor: '#d45c53' }, logoutPressed: { opacity: 0.8 }, logoutText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  workspaceScroll: { flex: 1, minWidth: 0, width: '100%' }, workspaceContent: { flexGrow: 1, width: '100%', minWidth: 0, paddingBottom: 85 },
  workspaceRow: { flexGrow: 1, width: '100%', minWidth: 0, flexDirection: 'column' }, workspaceRowDesktop: { flexDirection: 'row', alignItems: 'stretch' },
  centerPanel: { flexGrow: 1, flexShrink: 1, flexBasis: 0, width: '100%', minWidth: 0, paddingHorizontal: 22, paddingTop: 22, paddingBottom: 36 }, centerPanelDesktop: { width: 0, minWidth: 500 },
  subviewContainer: { flexGrow: 1, width: '100%', minWidth: 0 },
  drawer: { marginBottom: 12, borderRadius: 15, overflow: 'hidden', elevation: 7, shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } },
  contentHeader: { minHeight: 65, width: '100%', minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 15, marginBottom: 22 }, contentHeaderMobile: { flexDirection: 'column', alignItems: 'stretch', gap: 12 }, pageTitleBlock: { flex: 1, minWidth: 0 }, pageTitle: { color: COLORS.ink, fontWeight: '900', fontSize: 24, flexShrink: 1 }, pageSubtitle: { color: COLORS.muted, fontSize: 12, marginTop: 4, flexShrink: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 }, headerActionsMobile: { width: '100%' }, searchBox: { width: 250, maxWidth: '72%', height: 41, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: COLORS.line, borderRadius: 12, backgroundColor: COLORS.white, paddingHorizontal: 11 }, searchInput: { flex: 1, padding: 0, color: COLORS.ink, fontSize: 12 },
  bellButton: { width: 41, height: 41, borderRadius: 12, backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.line, alignItems: 'center', justifyContent: 'center' }, notificationDot: { position: 'absolute', width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.red, top: 8, right: 8 },
  fallback: { padding: 10, borderRadius: 10, backgroundColor: '#fff4dc', marginBottom: 14 }, fallbackText: { color: '#835d05', fontSize: 12 },
  activePeriodRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: COLORS.green, borderRadius: 14, paddingHorizontal: 17, paddingVertical: 14, marginBottom: 22 }, periodEyebrow: { color: '#c5d7c7', fontWeight: '800', letterSpacing: 1, fontSize: 9 }, periodTitle: { color: '#fff', fontSize: 16, fontWeight: '900', marginTop: 4 }, activeBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 9, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)' }, activeDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#9be27d' }, activeBadgeText: { color: '#fff', fontSize: 9, fontWeight: '900' },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12, marginTop: 4 }, sectionTitle: { color: COLORS.ink, fontWeight: '900', fontSize: 17 }, sectionSub: { color: COLORS.muted, fontSize: 11, marginTop: 3 }, refreshButton: { height: 34, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.line, borderRadius: 10 }, refreshText: { color: COLORS.green, fontSize: 11, fontWeight: '800' },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 11, marginBottom: 20 }, statsGridDesktop: { flexWrap: 'nowrap' }, statCard: { flex: 1, minWidth: '46%', backgroundColor: COLORS.white, borderRadius: 13, overflow: 'hidden', padding: 14, elevation: 2, shadowColor: '#16251a', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } }, statCardWide: { minWidth: 0 }, cardPressed: { opacity: 0.76, transform: [{ scale: 0.99 }] }, statAccent: { height: 4, position: 'absolute', top: 0, left: 0, right: 0 }, statHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 3 }, statLabel: { color: COLORS.muted, fontWeight: '900', fontSize: 9, letterSpacing: 0.65 }, statNumber: { color: COLORS.ink, fontWeight: '900', fontSize: 27, marginTop: 13 }, statSubtitle: { color: COLORS.muted, fontSize: 10, marginTop: 3 },
  analyticsGroups: { gap: 12, marginTop: 14 }, analyticsGroupsWide: { flexDirection: 'row' }, progressPanel: { flex: 1, minWidth: 0, backgroundColor: COLORS.white, borderRadius: 15, padding: 14, borderWidth: 1, borderColor: COLORS.line }, progressPanelTitle: { color: COLORS.ink, fontSize: 13, fontWeight: '900', marginBottom: 10 }, progressMetric: { marginTop: 4, marginBottom: 7 }, progressMetricHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, progressMetricLabel: { color: COLORS.ink, fontSize: 10, fontWeight: '800', flexShrink: 1 }, progressMetricPercent: { color: COLORS.emerald, fontSize: 10, fontWeight: '900', marginLeft: 7 }, progressMetricTrack: { height: 6, borderRadius: 3, backgroundColor: '#edf1ee', overflow: 'hidden', marginTop: 5 }, progressMetricFill: { height: 6, borderRadius: 3, backgroundColor: COLORS.emerald }, progressMetricCaption: { color: COLORS.muted, fontSize: 9, marginTop: 3 }, progressEmpty: { color: COLORS.muted, fontSize: 11 },
  officeTotal: { color: COLORS.green, fontSize: 9, fontWeight: '900', letterSpacing: 0.8 }, officesPanel: { backgroundColor: COLORS.white, borderRadius: 15, padding: 12, elevation: 2, shadowColor: '#16251a', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } }, officeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 }, officeCard: { width: '48%', flexGrow: 1, minWidth: 135, backgroundColor: '#f4f6f4', borderRadius: 11, padding: 11, borderBottomWidth: 3, borderBottomColor: '#a9c5ae' }, officeCardWide: { width: '23%', minWidth: 130 }, officeTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 }, officeIcon: { width: 27, height: 27, borderRadius: 8, backgroundColor: '#e5eee6', alignItems: 'center', justifyContent: 'center' }, officeTitle: { flex: 1, color: COLORS.ink, fontWeight: '800', fontSize: 10 }, officeFlag: { color: '#9A6500', backgroundColor: '#FFF0C2', fontSize: 7, fontWeight: '900', paddingHorizontal: 4, paddingVertical: 3, borderRadius: 5 }, officeCounts: { flexDirection: 'row', justifyContent: 'space-between', gap: 5, marginTop: 12 }, pendingCount: { color: '#936800', fontSize: 10, fontWeight: '800' }, clearCount: { color: COLORS.emerald, fontSize: 10, fontWeight: '800' }, officeBar: { height: 4, flexDirection: 'row', overflow: 'hidden', backgroundColor: '#e8ece8', borderRadius: 3, marginTop: 9 }, officeBarClear: { backgroundColor: COLORS.emerald, borderRadius: 3 }, officeBarPending: { backgroundColor: '#e5bd50', borderRadius: 3 },
  rightRail: { width: 292, backgroundColor: '#fff', borderLeftWidth: 1, borderLeftColor: COLORS.line, padding: 17 }, activityPanel: { backgroundColor: COLORS.white, borderRadius: 14, padding: 14, marginBottom: 14, elevation: 2, shadowColor: '#16251a', shadowOpacity: 0.04, shadowRadius: 7, shadowOffset: { width: 0, height: 2 } }, railHeadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }, railTitle: { color: COLORS.ink, fontSize: 14, fontWeight: '900' }, railSubtitle: { color: COLORS.muted, fontSize: 10, marginTop: 3 }, activityItem: { flexDirection: 'row', gap: 9, paddingVertical: 11, borderTopWidth: 1, borderTopColor: '#eef1ee' }, activityPressed: { opacity: 0.7 }, statusDot: { width: 8, height: 8, borderRadius: 5, marginTop: 4 }, dotGreen: { backgroundColor: COLORS.emerald }, dotAmber: { backgroundColor: COLORS.amber }, dotRed: { backgroundColor: COLORS.red }, activityCopy: { flex: 1, minWidth: 0 }, activityNameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 5 }, activityName: { flex: 1, color: COLORS.ink, fontSize: 10, fontWeight: '900' }, activityTime: { color: COLORS.muted, fontSize: 9 }, activityMeta: { color: COLORS.muted, fontSize: 9, marginTop: 3 }, activityStatus: { color: COLORS.green, fontSize: 9, fontWeight: '700', marginTop: 4 }, emptyActivity: { color: COLORS.muted, fontSize: 11, paddingVertical: 18, textAlign: 'center' },
  queuePanel: { padding: 14, backgroundColor: COLORS.greenDeep, borderRadius: 14 }, queuePill: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 5, paddingHorizontal: 9, marginTop: 7, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.1)' }, queuePillPressed: { backgroundColor: 'rgba(255,255,255,0.2)' }, queueName: { flex: 1, color: '#f3f7f3', fontWeight: '700', fontSize: 9 }, queueCounts: { alignItems: 'flex-end' }, queuePending: { color: '#f3d278', fontWeight: '800', fontSize: 8 }, queueClear: { color: '#9be2b1', fontWeight: '700', fontSize: 8, marginTop: 2 },
  loading: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, padding: 17 }, loadingText: { color: COLORS.muted, fontSize: 11 },
  rightRailResponsive: { width: 300, flexShrink: 0 },
  scrollTopButton: { position: 'absolute', right: 30, bottom: 30, width: 56, height: 56, borderRadius: 28, backgroundColor: '#1b4332', alignItems: 'center', justifyContent: 'center', elevation: 7, shadowColor: '#000000', shadowOpacity: 0.22, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } }, scrollTopButtonDesktop: { right: 30 },
  modalBackdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(7,25,14,0.45)', padding: 18 }, notificationModal: { width: '100%', maxWidth: 480, maxHeight: '80%', backgroundColor: COLORS.white, borderRadius: 18, padding: 17, elevation: 12 }, notificationHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: COLORS.line }, notificationTitle: { color: COLORS.ink, fontSize: 18, fontWeight: '900' }, notificationSubtitle: { color: COLORS.muted, fontSize: 11, marginTop: 3 }, notificationItem: { minHeight: 65, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: COLORS.line }, notificationBullet: { width: 9, height: 9, borderRadius: 5, backgroundColor: COLORS.amber }, notificationCopy: { flex: 1 }, notificationItemTitle: { color: COLORS.ink, fontWeight: '800', fontSize: 12 }, notificationItemDetail: { color: COLORS.muted, fontSize: 10, marginTop: 4 }, noNotifications: { textAlign: 'center', color: COLORS.muted, fontSize: 12, paddingVertical: 24 },
});
