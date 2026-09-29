import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import NetInfo from '@react-native-community/netinfo';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AttendanceDay, DEFAULT_POLICY, formatDuration, getAttendanceSummary, localDateKey, PolicyConfig } from './src/lib/attendance';
import { loadDays, loadPolicy, saveDay, savePolicy, syncPending } from './src/lib/storage';
import { isSupabaseConfigured, supabase } from './src/lib/supabase';
import { cancelReminder, scheduleDailyReminder, scheduleTimedReminder } from './src/lib/notifications';
import { colors } from './src/theme';

if (Platform.OS !== 'web') Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: false, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }) });
type Tab = 'Today' | 'History' | 'HR';
const clock = (value: string | null) => value ? new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—';
const monthName = (key: string) => new Date(`${key}-01T12:00:00`).toLocaleDateString([], { month: 'long', year: 'numeric' });

export default function App() {
  return <SafeAreaProvider><OfficeTimeApp /></SafeAreaProvider>;
}

function OfficeTimeApp() {
  const [session, setSession] = useState<any>(null);
  const [role, setRole] = useState('employee');
  const [booting, setBooting] = useState(true);
  const [days, setDays] = useState<AttendanceDay[]>([]);
  const [policy, setPolicy] = useState<PolicyConfig>(DEFAULT_POLICY);
  const [tab, setTab] = useState<Tab>('Today');
  const [online, setOnline] = useState(true);
  const [offlineContinue, setOfflineContinue] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(new Date());
  const [hrRows, setHrRows] = useState<any[]>([]);
  const today = localDateKey(now);
  const day = days.find(item => item.date === today) ?? { date: today, punchInAt: null, punchOutAt: null, breakMinutes: policy.defaultBreakMinutes, managerApproval: false, synced: true };
  const summary = useMemo(() => getAttendanceSummary(day, now, policy), [day, now, policy]);
  const active = !!day.punchInAt && !day.punchOutAt;
  const completed = !!day.punchOutAt;
  const refresh = useCallback(async () => {
    setDays(await loadDays()); setPolicy(await loadPolicy());
  }, []);

  useEffect(() => {
    let mounted = true;
    const subscription = NetInfo.addEventListener(state => { setOnline(!!state.isConnected); if (state.isConnected) void syncPending().then(refresh); });
    const timer = setInterval(() => setNow(new Date()), 30_000);
    void Promise.all([refresh(), scheduleDailyReminder()]).finally(() => { if (mounted) setBooting(false); });
    if (supabase) {
      void supabase.auth.getSession().then(({ data }) => { if (mounted) setSession(data.session); });
      const { data: { subscription: authSubscription } } = supabase.auth.onAuthStateChange((_event, next) => { setSession(next); void refresh(); });
      return () => { mounted = false; subscription(); clearInterval(timer); authSubscription.unsubscribe(); };
    }
    return () => { mounted = false; subscription(); clearInterval(timer); };
  }, [refresh]);

  useEffect(() => {
    let mounted = true;
    if (session && supabase) void supabase.from('profiles').select('role').eq('id', session.user.id).single()
      .then(({ data }) => { if (mounted) setRole(data?.role ?? 'employee'); });
    else setRole('employee');
    return () => { mounted = false; };
  }, [session]);

  useEffect(() => {
    if (tab === 'HR' && role !== 'employee' && supabase) {
      void supabase.rpc('hr_attendance_report').then(({ data, error }) => {
        if (error) Alert.alert('HR report unavailable', error.message); else setHrRows(data ?? []);
      });
    }
  }, [tab, role]);

  async function punch(kind: 'in' | 'out') {
    if (kind === 'in' && day.punchInAt) return Alert.alert('Already punched in', 'There is already a punch-in recorded for today.');
    if (kind === 'out' && !active) return Alert.alert('No active session', 'Punch in before punching out.');
    const stamp = new Date();
    if (kind === 'out' && stamp <= new Date(day.punchInAt!)) return Alert.alert('Invalid time', 'Punch-out must be later than punch-in.');
    const updated = await saveDay({ ...day, date: localDateKey(stamp), punchInAt: kind === 'in' ? stamp.toISOString() : day.punchInAt,
      punchOutAt: kind === 'out' ? stamp.toISOString() : day.punchOutAt, breakMinutes: policy.defaultBreakMinutes });
    setDays(list => [updated, ...list.filter(d => d.date !== updated.date)]);
    if (kind === 'in') {
      await scheduleTimedNotice('missing-punch-out', 'Don’t forget to punch out', 'Your attendance session is still open.', 9 * 60 * 60 * 1000);
      await scheduleWorkTarget(policy, getAttendanceSummary(updated, stamp, policy), updated);
      Alert.alert('Punched in', `Recorded at ${clock(stamp.toISOString())}.`);
    } else {
      await cancelNotice('missing-punch-out');
      await cancelNotice('work-target');
      Alert.alert('Punched out', 'Your attendance for today has been saved.');
    }
  }
  async function scheduleWorkTarget(config = policy, currentSummary = summary, record = day) {
    const futureBreak = config.breakDeductionMode === 'fixed' ? config.defaultBreakMinutes : config.breakDeductionMode === 'actual' ? record.breakMinutes : 0;
    const ms = Math.max(60_000, (config.recordedWorkTargetMinutes + futureBreak - currentSummary.elapsedMinutes) * 60_000);
    await scheduleTimedNotice('work-target', 'Work hours complete', `${formatDuration(config.recordedWorkTargetMinutes)} recorded work hours reached.`, ms);
  }
  async function cancelNotice(kind: string) {
    await cancelReminder(kind);
  }
  async function scheduleTimedNotice(kind: string, title: string, body: string, ms: number) {
    try { await scheduleTimedReminder(kind, title, body, ms); } catch { /* notification permission is optional */ }
  }
  async function submitLateApproval() {
    if (!supabase || !session) return Alert.alert('Sign in to request approval', 'Connect your work account to send a request to your manager.');
    const { error } = await supabase.from('late_arrival_reviews').upsert({ user_id: session.user.id, work_date: day.date,
      login_at: day.punchInAt, minutes_late: summary.lateMinutes, after_flex_limit: summary.afterFlexLimit, review_status: 'pending' }, { onConflict: 'user_id,work_date' });
    if (error) Alert.alert('Request not sent', error.message); else Alert.alert('Request submitted', 'Your manager can review this late-arrival request.');
  }
  async function changePolicy(key: keyof PolicyConfig, value: any) {
    const next = { ...policy, [key]: value }; setPolicy(next); await savePolicy(next);
    if (day.punchInAt && ['recordedWorkTargetMinutes', 'defaultBreakMinutes', 'breakDeductionMode'].includes(key))
      await scheduleWorkTarget(next, getAttendanceSummary(day, now, next), day);
  }
  async function changeTodayBreak(minutes: number) {
    const updated = await saveDay({ ...day, breakMinutes: Math.max(0, Math.min(240, minutes)) });
    setDays(list => [updated, ...list.filter(d => d.date !== updated.date)]);
    if (updated.punchInAt && policy.breakDeductionMode === 'actual') await scheduleWorkTarget(policy, getAttendanceSummary(updated, now, policy), updated);
  }
  async function resolveReview(reviewId: string, status: 'approved' | 'rejected') {
    if (!supabase) return;
    const { error } = await supabase.rpc('resolve_late_arrival', { review_id: reviewId, decision: status });
    if (error) Alert.alert('Could not update approval', error.message);
    else { setHrRows(rows => rows.map(row => row.review_id === reviewId ? { ...row, review_status: status } : row)); }
  }

  if (booting) return <SafeAreaView style={styles.safe}><View style={styles.center}><ActivityIndicator color={colors.blue} /><Text style={styles.muted}>Loading OfficeTime…</Text></View></SafeAreaView>;
  if (!session && isSupabaseConfigured && !offlineContinue) return <AuthScreen onContinue={() => setOfflineContinue(true)} />;

  const lateDays = days.filter(d => d.date.startsWith(today.slice(0, 7)) && d.punchInAt && getAttendanceSummary(d, new Date(d.punchInAt), policy).lateMinutes > 0);
  return <SafeAreaView style={styles.safe}>
    <StatusBar style="dark" />
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.header}><View><Text style={styles.eyebrow}>ATTENDANCE, MADE SIMPLE</Text><Text style={styles.title}>OfficeTime</Text><Text style={styles.subtitle}>{now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}</Text></View><View style={styles.avatar}><Text style={styles.avatarText}>{session?.user?.email?.[0]?.toUpperCase() ?? 'OT'}</Text></View></View>
      <View style={[styles.connection, !online && styles.offline]}><View style={[styles.dot, { backgroundColor: online ? '#16A34A' : '#D97706' }]} /><Text style={styles.connectionText}>{online ? (session ? 'Connected · changes sync automatically' : 'Local mode · sign in to sync') : 'Offline · punches saved on this device'}</Text><Pressable onPress={() => session ? void supabase?.auth.signOut() : null}><Text style={styles.link}>{session ? 'Sign out' : ''}</Text></Pressable></View>
      <View style={styles.tabs}>{(['Today', 'History', ...(role !== 'employee' ? ['HR'] : [])] as Tab[]).map(item => <Pressable key={item} onPress={() => setTab(item)} style={[styles.tab, tab === item && styles.tabActive]}><Text style={[styles.tabText, tab === item && styles.tabTextActive]}>{item}</Text></Pressable>)}</View>
      {tab === 'Today' && <>
        <View style={styles.hero}>
          <View style={styles.heroTop}><View><Text style={styles.heroLabel}>RECORDED WORK HOURS</Text><Text style={styles.heroTime}>{formatDuration(summary.netWorkedMinutes)}</Text></View><View style={styles.progressBadge}><Text style={styles.progressBadgeText}>{summary.progressPercent}%</Text></View></View>
          <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${summary.progressPercent}%` }]} /></View>
          <View style={styles.progressMeta}><Text style={styles.heroSmall}>{summary.targetStatus}</Text><Text style={styles.heroSmall}>Target {formatDuration(policy.recordedWorkTargetMinutes)}</Text></View>
          <View style={styles.buttonRow}><Pressable style={[styles.action, styles.primary]} onPress={() => void punch('in')} disabled={!!day.punchInAt}><Text style={styles.actionText}>↗  Punch in</Text></Pressable><Pressable style={[styles.action, styles.teal, !active && styles.dim]} onPress={() => void punch('out')} disabled={!active}><Text style={styles.actionText}>↙  Punch out</Text></Pressable></View>
          <Text style={styles.helper}>{active ? `Started at ${clock(day.punchInAt)} · don’t forget to punch out` : completed ? 'Your day is complete. Great work.' : 'Tap once when you begin your workday.'}</Text>
        </View>
        <View style={styles.statGrid}><Stat label="Punch in" value={clock(day.punchInAt)} /><Stat label="Punch out" value={active ? 'In progress' : clock(day.punchOutAt)} /><Stat label="Elapsed" value={formatDuration(summary.elapsedMinutes)} /><Stat label="Break deducted" value={formatDuration(summary.deductedBreakMinutes)} /></View>
        <View style={styles.card}><View style={styles.cardHeading}><Text style={styles.sectionTitle}>Policy check</Text><Pill text={summary.afterFlexLimit ? 'Review needed' : summary.lateMinutes ? 'Late login' : day.punchInAt ? 'On time' : 'Awaiting punch'} warning={summary.lateMinutes > 0} /></View>
          <Row label="Standard start" value="9:00 AM" /><Row label="Flexible login limit" value="10:00 AM" /><Row label="Login status" value={summary.loginStatus} warning={summary.lateMinutes > 0} />
          <Row label="Late arrivals this month" value={`${lateDays.length} of ${policy.lateAllowancePerMonth} permitted*`} warning={lateDays.length > policy.lateAllowancePerMonth} />
          {summary.lateMinutes > 0 && day.punchInAt && <Pressable style={styles.outlineButton} onPress={() => void submitLateApproval()}><Text style={styles.outlineText}>Request manager approval</Text></Pressable>}
          <Text style={styles.policyNote}>*Allowance and half-day treatment are not enforced until HR confirms the policy interpretation.</Text>
        </View>
        <View style={styles.card}><Text style={styles.sectionTitle}>Your workday settings</Text><Text style={styles.muted}>Editable defaults pending HR confirmation</Text>
          <Stepper label="Recorded work target" value={formatDuration(policy.recordedWorkTargetMinutes)} onMinus={() => void changePolicy('recordedWorkTargetMinutes', Math.max(60, policy.recordedWorkTargetMinutes - 30))} onPlus={() => void changePolicy('recordedWorkTargetMinutes', policy.recordedWorkTargetMinutes + 30)} />
          <Stepper label="Break deduction" value={`${policy.defaultBreakMinutes} min`} onMinus={() => void changePolicy('defaultBreakMinutes', Math.max(0, policy.defaultBreakMinutes - 15))} onPlus={() => void changePolicy('defaultBreakMinutes', Math.min(240, policy.defaultBreakMinutes + 15))} />
          <SettingChoice label="Deduction mode" value={policy.breakDeductionMode} options={['fixed', 'actual', 'none']} onSelect={value => void changePolicy('breakDeductionMode', value)} />
          {policy.breakDeductionMode === 'actual' && <Stepper label="Today's actual break" value={`${day.breakMinutes} min`} onMinus={() => void changeTodayBreak(day.breakMinutes - 15)} onPlus={() => void changeTodayBreak(day.breakMinutes + 15)} />}
          <SettingChoice label="Half-day rule" value={policy.halfDayRule === 'disabled' ? 'disabled' : 'after 10 AM'} options={['disabled', 'after 10 AM']} onSelect={value => void changePolicy('halfDayRule', value === 'disabled' ? 'disabled' : 'after_flex')} />
          <Stepper label="Late-arrival allowance" value={`${policy.lateAllowancePerMonth} / month`} onMinus={() => void changePolicy('lateAllowancePerMonth', Math.max(0, policy.lateAllowancePerMonth - 1))} onPlus={() => void changePolicy('lateAllowancePerMonth', policy.lateAllowancePerMonth + 1)} />
          <Pressable style={styles.outlineButton} onPress={() => void scheduleWorkTarget()}><Text style={styles.outlineText}>Remind me when target is reached</Text></Pressable>
          {Platform.OS === 'web' && <Text style={styles.muted}>Browser reminders need notification permission and this tab open. Use the iOS or Android app for scheduled daily reminders.</Text>}
          <Text style={styles.policyNote}>The policy mentions both a 9-hour day including breaks and 8 recorded work hours. Defaults display 8 net hours after a fixed 1-hour deduction; adjust above until HR confirms.</Text>
        </View>
      </>}
      {tab === 'History' && <History days={days} policy={policy} />}
      {tab === 'HR' && <HRDashboard rows={hrRows} loading={busy} onRefresh={async () => { setBusy(true); const { data } = await supabase!.rpc('hr_attendance_report'); setHrRows(data ?? []); setBusy(false); }} onResolve={resolveReview} />}
      <View style={styles.footerCard}><Text style={styles.footerTitle}>A note about official attendance</Text><Text style={styles.footerText}>The supplied policy says the office biometric system is the official record. OfficeTime is a companion tracker until HR authorizes it for official use.</Text></View>
      <Text style={styles.footer}>OfficeTime · Secure attendance for your team</Text>
    </ScrollView>
  </SafeAreaView>;
}

function AuthScreen({ onContinue }: { onContinue: () => void }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false);
  async function signIn(create = false) {
    if (!supabase) return; setBusy(true);
    const result = create ? await supabase.auth.signUp({ email: email.trim(), password }) : await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (result.error) Alert.alert(create ? 'Could not create account' : 'Could not sign in', result.error.message);
    else if (create && !result.data.session) Alert.alert('Check your email', 'Confirm your email, then sign in.');
  }
  return <SafeAreaView style={styles.safe}><StatusBar style="dark"/><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.authWrap}><View style={styles.authCard}><View style={styles.avatarLarge}><Text style={styles.avatarText}>OT</Text></View><Text style={styles.title}>Welcome to OfficeTime</Text><Text style={styles.subtitle}>Sign in to securely sync attendance across devices.</Text><TextInput style={styles.input} placeholder="Work email" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail}/><TextInput style={styles.input} placeholder="Password" secureTextEntry value={password} onChangeText={setPassword}/><Pressable style={[styles.action, styles.primary]} onPress={() => void signIn()} disabled={busy}><Text style={styles.actionText}>{busy ? 'Please wait…' : 'Sign in'}</Text></Pressable><Pressable style={styles.textButton} onPress={() => void signIn(true)}><Text style={styles.outlineText}>Create employee account</Text></Pressable><Pressable style={styles.textButton} onPress={onContinue}><Text style={styles.muted}>Continue in offline mode</Text></Pressable></View></KeyboardAvoidingView></SafeAreaView>;
}

function History({ days, policy }: { days: AttendanceDay[]; policy: PolicyConfig }) {
  const [month, setMonth] = useState(localDateKey().slice(0, 7));
  const rows = days.filter(d => d.date.startsWith(month));
  const total = rows.reduce((sum, d) => sum + getAttendanceSummary(d, d.punchOutAt ? new Date(d.punchOutAt) : new Date(), policy).netWorkedMinutes, 0);
  function shiftMonth(delta: number) { const date = new Date(`${month}-01T12:00:00`); date.setMonth(date.getMonth() + delta); setMonth(localDateKey(date).slice(0, 7)); }
  return <><View style={styles.monthBar}><Pressable onPress={() => shiftMonth(-1)}><Text style={styles.monthArrow}>‹</Text></Pressable><Text style={styles.monthTitle}>{monthName(month)}</Text><Pressable onPress={() => shiftMonth(1)}><Text style={styles.monthArrow}>›</Text></Pressable></View><View style={styles.summaryStrip}><View><Text style={styles.statLabel}>DAYS RECORDED</Text><Text style={styles.monthStat}>{rows.length}</Text></View><View><Text style={styles.statLabel}>WORK HOURS</Text><Text style={styles.monthStat}>{formatDuration(total)}</Text></View><View><Text style={styles.statLabel}>LATE LOGINS</Text><Text style={styles.monthStat}>{rows.filter(d => d.punchInAt && getAttendanceSummary(d, new Date(d.punchInAt), policy).lateMinutes > 0).length}</Text></View></View>{rows.length ? rows.map(d => { const s = getAttendanceSummary(d, d.punchOutAt ? new Date(d.punchOutAt) : new Date(), policy); return <View key={d.date} style={styles.historyRow}><View style={styles.historyDate}><Text style={styles.historyDay}>{new Date(`${d.date}T12:00:00`).toLocaleDateString([], { weekday: 'short' })}</Text><Text style={styles.historyNum}>{new Date(`${d.date}T12:00:00`).getDate()}</Text></View><View style={styles.historyMain}><Text style={styles.historyTitle}>{clock(d.punchInAt)} — {d.punchOutAt ? clock(d.punchOutAt) : 'In progress'}</Text><Text style={styles.historySub}>{s.loginStatus} · {d.synced === false ? 'Waiting to sync' : 'Saved'}</Text></View><Text style={styles.historyHours}>{formatDuration(s.netWorkedMinutes)}</Text></View>; }) : <View style={styles.empty}><Text style={styles.emptyTitle}>No attendance yet</Text><Text style={styles.muted}>Punch in to start a record for {monthName(month)}.</Text></View>}</>;
}

function HRDashboard({ rows, loading, onRefresh, onResolve }: { rows: any[]; loading: boolean; onRefresh: () => void; onResolve: (id: string, status: 'approved' | 'rejected') => void }) {
  return <View style={styles.card}><View style={styles.cardHeading}><Text style={styles.sectionTitle}>HR attendance overview</Text><Pressable onPress={onRefresh}><Text style={styles.link}>Refresh</Text></Pressable></View><Text style={styles.muted}>Protected report and approval queue. Access requires an HR or manager role assigned by an administrator.</Text>{loading && <ActivityIndicator/>}{rows.length ? rows.map(row => <View key={row.review_id ?? `${row.user_id}-${row.work_date}`} style={styles.hrRow}><View style={{ flex: 1 }}><Text style={styles.historyTitle}>{row.employee_name ?? row.email ?? 'Employee'} · {row.work_date}</Text><Text style={styles.historySub}>{row.review_status ? `Late login · ${row.minutes_late} min · ${row.review_status}` : `Work: ${formatDuration(row.net_work_minutes ?? 0)}`}</Text></View>{row.review_status === 'pending' && <View style={styles.hrActions}><Pressable onPress={() => onResolve(row.review_id, 'approved')}><Text style={styles.approve}>Approve</Text></Pressable><Pressable onPress={() => onResolve(row.review_id, 'rejected')}><Text style={styles.reject}>Reject</Text></Pressable></View>}</View>) : !loading && <View style={styles.empty}><Text style={styles.emptyTitle}>No report data</Text><Text style={styles.muted}>The secure report will appear when employees have submitted attendance.</Text></View>}</View>;
}
function Stat({ label, value }: { label: string; value: string }) { return <View style={styles.statCard}><Text style={styles.statLabel}>{label}</Text><Text style={styles.statValue}>{value}</Text></View>; }
function Row({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) { return <View style={styles.row}><Text style={styles.rowLabel}>{label}</Text><Text style={[styles.rowValue, warning && { color: colors.amber }]}>{value}</Text></View>; }
function Pill({ text, warning }: { text: string; warning: boolean }) { return <View style={[styles.pill, warning && styles.pillWarn]}><Text style={[styles.pillText, warning && { color: '#B45309' }]}>{text}</Text></View>; }
function Stepper({ label, value, onMinus, onPlus }: { label: string; value: string; onMinus: () => void; onPlus: () => void }) { return <View style={styles.stepper}><Text style={styles.rowLabel}>{label}</Text><View style={styles.stepActions}><Pressable style={styles.stepButton} onPress={onMinus}><Text style={styles.stepText}>−</Text></Pressable><Text style={styles.stepValue}>{value}</Text><Pressable style={styles.stepButton} onPress={onPlus}><Text style={styles.stepText}>+</Text></Pressable></View></View>; }
function SettingChoice({ label, value, options, onSelect }: { label: string; value: string; options: string[]; onSelect: (value: string) => void }) { return <View style={styles.settingChoice}><Text style={styles.rowLabel}>{label}</Text><View style={styles.choiceRow}>{options.map(option => <Pressable key={option} onPress={() => onSelect(option)} style={[styles.choice, value === option && styles.choiceSelected]}><Text style={[styles.choiceText, value === option && styles.choiceTextSelected]}>{option}</Text></Pressable>)}</View></View>; }

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background }, page: { width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 38, gap: 16 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 7 }, eyebrow: { color: colors.blue, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 }, title: { color: colors.text, fontSize: 30, fontWeight: '800', marginTop: 4 }, subtitle: { color: colors.muted, fontSize: 14, marginTop: 4, lineHeight: 20 }, avatar: { width: 48, height: 48, borderRadius: 16, backgroundColor: '#DBEAFE', alignItems: 'center', justifyContent: 'center' }, avatarLarge: { width: 56, height: 56, borderRadius: 18, backgroundColor: '#DBEAFE', alignItems: 'center', justifyContent: 'center', alignSelf: 'center' }, avatarText: { color: colors.blue, fontWeight: '800', fontSize: 17 },
  connection: { backgroundColor: '#F0FDF4', padding: 11, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }, offline: { backgroundColor: '#FFFBEB' }, dot: { width: 7, height: 7, borderRadius: 5 }, connectionText: { fontSize: 11, color: colors.muted, flex: 1 }, link: { color: colors.blue, fontWeight: '700', fontSize: 12 }, tabs: { flexDirection: 'row', gap: 8, backgroundColor: '#E9EEF5', padding: 4, borderRadius: 14 }, tab: { flex: 1, paddingVertical: 10, borderRadius: 11, alignItems: 'center' }, tabActive: { backgroundColor: '#FFFFFF', elevation: 1 }, tabText: { fontSize: 13, fontWeight: '700', color: colors.muted }, tabTextActive: { color: colors.text },
  hero: { backgroundColor: colors.navy, borderRadius: 25, padding: 22, shadowColor: '#0F172A', shadowOffset: { width: 0, height: 9 }, shadowOpacity: 0.13, shadowRadius: 17, elevation: 3 }, heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, heroLabel: { color: '#BFDBFE', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 }, heroTime: { color: '#FFF', fontSize: 41, fontWeight: '800', marginTop: 6 }, progressBadge: { backgroundColor: '#263A56', paddingVertical: 9, paddingHorizontal: 12, borderRadius: 12 }, progressBadgeText: { color: '#DCEBFF', fontSize: 14, fontWeight: '800' }, progressTrack: { height: 8, backgroundColor: '#334155', borderRadius: 99, overflow: 'hidden', marginTop: 16 }, progressFill: { height: 8, backgroundColor: '#60A5FA', borderRadius: 99 }, progressMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 9 }, heroSmall: { color: '#CBD5E1', fontSize: 11 }, buttonRow: { flexDirection: 'row', gap: 10, marginTop: 21 }, action: { flex: 1, borderRadius: 13, paddingVertical: 14, alignItems: 'center' }, primary: { backgroundColor: colors.blue }, teal: { backgroundColor: '#0F766E' }, dim: { opacity: 0.45 }, actionText: { color: '#FFF', fontWeight: '800', fontSize: 14 }, helper: { color: '#CBD5E1', fontSize: 12, marginTop: 12, lineHeight: 18 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, statCard: { flexBasis: '47%', flexGrow: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 15, padding: 14, gap: 8 }, statLabel: { color: colors.muted, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 }, statValue: { color: colors.text, fontSize: 16, fontWeight: '800' }, card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 18, padding: 17, gap: 13 }, cardHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '800' }, row: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 }, rowLabel: { color: colors.muted, fontSize: 12, flex: 1 }, rowValue: { color: colors.text, fontSize: 12, fontWeight: '700', textAlign: 'right', flex: 1 }, pill: { backgroundColor: '#DCFCE7', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 99 }, pillWarn: { backgroundColor: '#FEF3C7' }, pillText: { color: '#15803D', fontSize: 10, fontWeight: '800' }, policyNote: { color: '#854D0E', fontSize: 11, lineHeight: 17, backgroundColor: '#FFFBEB', padding: 10, borderRadius: 10 }, outlineButton: { borderWidth: 1, borderColor: '#BFDBFE', borderRadius: 11, padding: 11, alignItems: 'center', backgroundColor: '#F8FBFF' }, outlineText: { color: colors.blue, fontSize: 12, fontWeight: '800' }, muted: { color: colors.muted, fontSize: 12, lineHeight: 18 }, stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, stepActions: { flexDirection: 'row', alignItems: 'center', gap: 10 }, stepButton: { width: 30, height: 30, borderRadius: 10, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' }, stepText: { fontSize: 20, color: colors.text }, stepValue: { minWidth: 64, textAlign: 'center', fontWeight: '800', color: colors.text, fontSize: 12 }, settingChoice: { gap: 8 }, choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, choice: { backgroundColor: '#F1F5F9', paddingVertical: 7, paddingHorizontal: 10, borderRadius: 99 }, choiceSelected: { backgroundColor: '#DBEAFE' }, choiceText: { color: colors.muted, fontSize: 10, fontWeight: '700' }, choiceTextSelected: { color: colors.blue },
  monthBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 }, monthArrow: { fontSize: 28, color: colors.blue, paddingHorizontal: 10 }, monthTitle: { color: colors.text, fontSize: 18, fontWeight: '800' }, summaryStrip: { flexDirection: 'row', justifyContent: 'space-around', backgroundColor: '#EFF6FF', borderRadius: 15, padding: 16 }, monthStat: { color: colors.text, fontSize: 18, fontWeight: '800', marginTop: 5 }, historyRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.card, borderRadius: 15, borderWidth: 1, borderColor: colors.border, padding: 12 }, historyDate: { width: 43, height: 48, borderRadius: 11, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' }, historyDay: { color: colors.blue, fontSize: 9, fontWeight: '700' }, historyNum: { color: colors.text, fontSize: 16, fontWeight: '800' }, historyMain: { flex: 1, gap: 5 }, historyTitle: { color: colors.text, fontSize: 12, fontWeight: '800' }, historySub: { color: colors.muted, fontSize: 10 }, historyHours: { color: colors.text, fontSize: 12, fontWeight: '800' }, empty: { padding: 26, alignItems: 'center', backgroundColor: '#F8FAFC', borderRadius: 15, gap: 6 }, emptyTitle: { color: colors.text, fontWeight: '800', fontSize: 14 }, hrRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, borderTopWidth: 1, borderTopColor: colors.border, gap: 10 }, hrActions: { gap: 9 }, approve: { color: '#15803D', fontWeight: '800', fontSize: 11 }, reject: { color: '#B91C1C', fontWeight: '800', fontSize: 11 },
  footerCard: { backgroundColor: '#EFF6FF', padding: 15, borderRadius: 14, gap: 5 }, footerTitle: { color: '#1D4ED8', fontSize: 12, fontWeight: '800' }, footerText: { color: '#1E40AF', fontSize: 11, lineHeight: 17 }, footer: { color: colors.muted, fontSize: 10, textAlign: 'center' }, authWrap: { flex: 1, justifyContent: 'center', padding: 20 }, authCard: { width: '100%', maxWidth: 430, alignSelf: 'center', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 22, padding: 24, gap: 14 }, input: { backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: colors.border, borderRadius: 11, padding: 13, color: colors.text, fontSize: 14 }, textButton: { alignItems: 'center', padding: 8 },
});
