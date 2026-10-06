import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Easing, Image, ImageSourcePropType, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as Notifications from 'expo-notifications';
import NetInfo from '@react-native-community/netinfo';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AttendanceDay, AttendanceSession, DEFAULT_POLICY, formatDuration, getAttendanceSummary, getDaySessions, isHalfDayDate, localDateKey, MONTHLY_LATE_LOGIN_LIMIT, monthLateCount, PolicyConfig } from './src/lib/attendance';
import { clearDay, loadDays, loadPolicy, saveDay, savePolicy, syncPending } from './src/lib/storage';
import { isSupabaseConfigured, supabase } from './src/lib/supabase';
import { cancelReminder, prepareAttendanceNotifications, scheduleDailyReminder, scheduleTimedReminder, showLateLoginWarning, showWorkHourCongratulations } from './src/lib/notifications';
import { colors } from './src/theme';
import { BUILD_ID, BUILD_SUMMARY } from './src/release';

if (Platform.OS !== 'web') Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }) });
type Tab = 'Today' | 'History' | 'Chat' | 'Games' | 'HR';
const clock = (value: string | null) => value ? new Date(value).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : '—';
const monthName = (key: string) => new Date(`${key}-01T12:00:00`).toLocaleDateString([], { month: 'long', year: 'numeric' });
const formatTimer = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safe / 3600)).padStart(2, '0')}:${String(Math.floor(safe % 3600 / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
};

export default function App() {
  return <SafeAreaProvider><OfficeTimeApp /><DeploymentUpdateNotice /></SafeAreaProvider>;
}

function PageAmbience() {
  const [width, setWidth] = useState(0);
  const spread = useRef(new Animated.Value(0.12)).current;
  const run = useRef(new Animated.Value(0)).current;
  const bounce = useRef(new Animated.Value(0)).current;
  const drift = useRef(new Animated.Value(0)).current;
  const twinkle = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const web = Animated.loop(Animated.sequence([
      Animated.timing(spread, { toValue: 1, duration: 3400, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(spread, { toValue: 0.9, duration: 2200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    const runner = Animated.loop(Animated.sequence([
      Animated.timing(run, { toValue: 1, duration: 5200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(run, { toValue: 0, duration: 5200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    const steps = Animated.loop(Animated.sequence([
      Animated.timing(bounce, { toValue: 1, duration: 160, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(bounce, { toValue: 0, duration: 160, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]));
    const drifting = Animated.loop(Animated.sequence([
      Animated.timing(drift, { toValue: 1, duration: 6500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(drift, { toValue: 0, duration: 6500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    const twinkling = Animated.loop(Animated.sequence([
      Animated.timing(twinkle, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(twinkle, { toValue: 0, duration: 1200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    web.start(); runner.start(); steps.start(); drifting.start(); twinkling.start();
    return () => { web.stop(); runner.stop(); steps.stop(); drifting.stop(); twinkling.stop(); };
  }, [spread, run, bounce, drift, twinkle]);
  const webOpacity = spread.interpolate({ inputRange: [0.12, 0.9, 1], outputRange: [0.03, 0.13, 0.2] });
  const catX = run.interpolate({ inputRange: [0, 1], outputRange: [-48, Math.max(-48, width + 48)] });
  const catY = bounce.interpolate({ inputRange: [0, 1], outputRange: [0, -7] });
  const catFlip = run.interpolate({ inputRange: [0, 0.499, 0.5, 1], outputRange: [1, 1, -1, -1] });
  const driftX = drift.interpolate({ inputRange: [0, 1], outputRange: [-18, 24] });
  const driftY = drift.interpolate({ inputRange: [0, 1], outputRange: [20, -24] });
  const sparkleOpacity = twinkle.interpolate({ inputRange: [0, 1], outputRange: [0.1, 0.65] });
  const pawX = run.interpolate({ inputRange: [0, 1], outputRange: [-22, Math.max(-22, width + 22)] });
  return <View pointerEvents="none" accessible={false} style={styles.ambienceLayer} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
    <Animated.View style={[styles.ambientGlow, styles.glowBlue, { transform: [{ translateX: driftX }, { translateY: driftY }, { scale: spread }] }]} />
    <Animated.View style={[styles.ambientGlow, styles.glowMint, { transform: [{ translateX: Animated.multiply(driftX, -1) }, { translateY: Animated.multiply(driftY, -1) }, { scale: spread }] }]} />
    <Animated.Text style={[styles.floatPaw, styles.floatPawOne, { opacity: sparkleOpacity, transform: [{ translateY: driftY }] }]}>🐾</Animated.Text>
    <Animated.Text style={[styles.floatPaw, styles.floatPawTwo, { opacity: sparkleOpacity, transform: [{ translateY: Animated.multiply(driftY, -1) }] }]}>🐾</Animated.Text>
    <Animated.Text style={[styles.firefly, styles.fireflyOne, { opacity: sparkleOpacity, transform: [{ translateY: driftY }] }]}>✦</Animated.Text>
    <Animated.Text style={[styles.firefly, styles.fireflyTwo, { opacity: sparkleOpacity, transform: [{ translateY: Animated.multiply(driftY, -1) }] }]}>✧</Animated.Text>
    <Animated.View style={[styles.spiderWeb, { opacity: webOpacity, transform: [{ scale: spread }] }]}>
      <View style={[styles.webRing, styles.webRingOuter]} /><View style={[styles.webRing, styles.webRingMiddle]} /><View style={[styles.webRing, styles.webRingInner]} />
      {[0, 45, 90, 135, 180, 225, 270, 315].map(angle => <View key={angle} style={[styles.webSpoke, { transform: [{ translateX: -62 }, { rotate: `${angle}deg` }] }]} />)}
      <Text style={styles.webSpider}>🕷️</Text>
    </Animated.View>
    <Animated.Text style={[styles.runningPawTrail, { transform: [{ translateX: pawX }] }]}>·　·　·</Animated.Text>
    <Animated.Text style={[styles.ambientRunner, { transform: [{ translateX: catX }, { translateY: catY }, { scaleX: catFlip }] }]}>🐈</Animated.Text>
  </View>;
}

function PassingGlitterGif() {
  const [width, setWidth] = useState(0);
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const walk = Animated.loop(Animated.sequence([
      Animated.timing(progress, { toValue: 1, duration: 6500, easing: Easing.linear, useNativeDriver: true }),
      Animated.timing(progress, { toValue: 0, duration: 0, useNativeDriver: true }),
      Animated.delay(3500),
    ]));
    walk.start();
    return () => walk.stop();
  }, [progress]);
  const gifWidth = Math.min(Math.max(width - 40, 260), 720);
  const gifHeight = gifWidth * 343 / 498;
  const travel = progress.interpolate({ inputRange: [0, 1], outputRange: [width + 20, -gifWidth - 20] });
  return <View pointerEvents="none" accessible={false} style={styles.passingLayer} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
    <Animated.Image source={require('./assets/walking-man.gif')} resizeMode="contain" accessibilityLabel="Animated stealth graphic walking across the app" style={[styles.passingGif, { width: gifWidth, height: gifHeight, transform: [{ translateX: travel }] }]} />
  </View>;
}


function FallingSpiderMan() {
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const progress = useRef(new Animated.Value(0)).current;
  const swing = useRef(new Animated.Value(0)).current;
  const imageWidth = Math.min(viewport.width ? viewport.width * 0.76 : 260, 320);
  const imageHeight = imageWidth * 322 / 236;
  useEffect(() => {
    const motion = Animated.loop(Animated.sequence([
      Animated.delay(6700),
      Animated.timing(progress, { toValue: 1, duration: 1200, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.delay(500),
      Animated.timing(progress, { toValue: 0, duration: 1200, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.delay(400),
    ]));
    const swinging = Animated.loop(Animated.sequence([
      Animated.timing(swing, { toValue: 1, duration: 820, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(swing, { toValue: 0, duration: 820, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    motion.start(); swinging.start();
    return () => { motion.stop(); swinging.stop(); };
  }, [progress, swing]);
  const hangDistance = 36;
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [-imageHeight, hangDistance] });
  const rotate = swing.interpolate({ inputRange: [0, 1], outputRange: ['-7deg', '7deg'] });
  const threadThreshold = imageHeight / (imageHeight + hangDistance);
  const threadScale = progress.interpolate({ inputRange: [0, threadThreshold, 1], outputRange: [0, 0, 1] });
  return <View pointerEvents="none" accessible={false} style={styles.fallLayer} onLayout={event => setViewport({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}>
    <Animated.View style={[styles.spiderThread, { left: Math.max(0, viewport.width / 2 - 1), height: hangDistance, transform: [{ scaleY: threadScale }] }]} />
    <Animated.Image source={require('./assets/spiderman-drop.png')} resizeMode="contain" accessibilityLabel="Spider-Man enters from above the screen, hangs near the top, then retracts upward" style={[styles.fallingSpider, { left: Math.max(0, (viewport.width - imageWidth) / 2), width: imageWidth, height: imageHeight, transform: [{ translateY }, { rotate }] }]} />
  </View>;
}

type ReleaseInfo = { buildId: string; summary: string; deployedAt: string };

function DeploymentUpdateNotice() {
  const [release, setRelease] = useState<ReleaseInfo | null>(null);
  const dismissedId = useRef<string | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let mounted = true;
    const check = async () => {
      try {
        const response = await fetch(`/release.json?check=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) return;
        const latest = await response.json() as ReleaseInfo;
        if (!mounted || !latest.buildId || latest.buildId === BUILD_ID) return;
        if (dismissedId.current !== latest.buildId) setRelease(latest);
      } catch { /* A failed update check leaves the current session undisturbed. */ }
    };
    void check();
    const timer = setInterval(() => { if ((globalThis as any).document?.visibilityState !== 'hidden') void check(); }, 60_000);
    const onFocus = () => void check();
    (globalThis as any).window?.addEventListener('focus', onFocus);
    return () => { mounted = false; clearInterval(timer); (globalThis as any).window?.removeEventListener('focus', onFocus); };
  }, []);

  const dismiss = () => { dismissedId.current = release?.buildId ?? null; setRelease(null); };
  const reload = () => (globalThis as any).window?.location?.reload();
  return <Modal visible={!!release} transparent animationType="fade" onRequestClose={dismiss}>
    <View style={styles.updateOverlay}><View style={styles.updateCard}>
      <View style={styles.updateBadge}><Text style={styles.updateBadgeText}>NEW VERSION</Text></View>
      <Text style={styles.updateTitle}>A new update is here</Text>
      <Text style={styles.updateSummary}>{release?.summary || BUILD_SUMMARY || 'OfficeTime has been updated.'}</Text>
      {!!release?.deployedAt && <Text style={styles.updateMeta}>Deployed {new Date(release.deployedAt).toLocaleString()}</Text>}
      <Pressable accessibilityRole="button" onPress={reload} style={styles.updatePrimary}><Text style={styles.updatePrimaryText}>Reload to update</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={dismiss} style={styles.updateLater}><Text style={styles.updateLaterText}>Later</Text></Pressable>
    </View></View>
  </Modal>;
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
  const [correctionTarget, setCorrectionTarget] = useState<{ date: string; add: boolean } | null>(null);
  const [officeOutSummary, setOfficeOutSummary] = useState<AttendanceDay | null>(null);
  const [catGreeting, setCatGreeting] = useState<'hi' | 'bye' | null>(null);
  const today = localDateKey(now);
  const day = days.find(item => item.date === today) ?? { date: today, punchInAt: null, punchOutAt: null, breakMinutes: policy.defaultBreakMinutes, managerApproval: false, synced: true };
  const summary = useMemo(() => getAttendanceSummary(day, now, policy), [day, now, policy]);
  const sessions = getDaySessions(day);
  const activeSession = sessions.slice().reverse().find(session => !session.punchOutAt) ?? null;
  const active = !!activeSession;
  const completed = sessions.length > 0 && !active;
  // The main timer and net-work total use the same calculation.
  const timerSeconds = summary.netWorkedSeconds;
  const remainingTargetSeconds = Math.max(0, policy.recordedWorkTargetMinutes * 60 - summary.netWorkedSeconds);
  const estimatedTargetTime = new Date(now.getTime() + remainingTargetSeconds * 1000)
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const breakTimerRunning = !active && !day.officeOutAt && !!sessions[sessions.length - 1]?.punchOutAt;
  const refresh = useCallback(async () => {
    setDays(await loadDays()); setPolicy(await loadPolicy());
  }, []);

  useEffect(() => {
    let mounted = true;
    const subscription = NetInfo.addEventListener(state => { setOnline(!!state.isConnected); if (state.isConnected) void syncPending().then(refresh); });
    const timer = setInterval(() => setNow(new Date()), 1_000);
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
    if (kind === 'in' && day.officeOutAt) return Alert.alert('Office day is closed', 'Clear today’s data if you need to correct and restart this workday.');
    if (kind === 'in' && active) return Alert.alert('Already punched in', 'Punch out of your current session before starting another.');
    if (kind === 'out' && !active) return Alert.alert('No active session', 'Punch in before punching out.');
    await prepareAttendanceNotifications();
    const stamp = new Date();
    if (kind === 'out' && stamp <= new Date(activeSession!.punchInAt)) return Alert.alert('Invalid time', 'Punch-out must be later than punch-in.');
    const stampText = stamp.toISOString();
    const nextSessions = kind === 'in'
      ? [...sessions, { punchInAt: stampText, punchOutAt: null }]
      : sessions.map(session => session === activeSession ? { ...session, punchOutAt: stampText } : session);
    const nextActive = nextSessions.some(session => !session.punchOutAt);
    const draft = { ...day, date: localDateKey(stamp), sessions: nextSessions,
      punchInAt: nextSessions[0]?.punchInAt ?? null,
      punchOutAt: nextActive ? null : nextSessions[nextSessions.length - 1]?.punchOutAt ?? null,
      breakMinutes: day.sessions?.length ? day.breakMinutes : policy.defaultBreakMinutes };
    const updatedSummary = getAttendanceSummary(draft, stamp, policy);
    const updated = await saveDay(draft);
    setDays(list => [updated, ...list.filter(d => d.date !== updated.date)]);
    const targetJustReached = !summary.targetReached && updatedSummary.targetReached;
    const firstLoginIsLate = kind === 'in' && sessions.length === 0 && updatedSummary.afterFlexLimit;
    if (targetJustReached) {
      await cancelNotice('work-target');
      const body = `${formatDuration(policy.recordedWorkTargetMinutes)} of recorded work reached. Congratulations — fantastic work today!`;
      if (!(await showWorkHourCongratulations('Daily work goal reached! 🎉', body))) Alert.alert('Daily work goal reached! 🎉', body);
    }
    if (kind === 'in') {
      await scheduleTimedNotice('missing-punch-out', 'Don’t forget to punch out', 'Your attendance session is still open.', 9 * 60 * 60 * 1000);
      if (!updatedSummary.targetReached) await scheduleWorkTarget(policy, updatedSummary, updated);
      if (firstLoginIsLate) {
        const monthCount = monthLateCount([updated, ...days.filter(item => item.date !== updated.date)], updated.date.slice(0, 7), policy);
        const remaining = Math.max(0, MONTHLY_LATE_LOGIN_LIMIT - monthCount);
        const body = monthCount >= MONTHLY_LATE_LOGIN_LIMIT
          ? `Late login ${monthCount} of ${MONTHLY_LATE_LOGIN_LIMIT}. No late logins remain this month. A half-day has been applied for today.`
          : `Late login ${monthCount} of ${MONTHLY_LATE_LOGIN_LIMIT}. ${remaining} late login${remaining === 1 ? '' : 's'} left this month.`;
        if (!(await showLateLoginWarning('Late login after 10:00 AM', body))) Alert.alert('Late login after 10:00 AM', body);
      }
      setCatGreeting('hi');
    } else {
      await cancelNotice('missing-punch-out');
      await cancelNotice('work-target');
      setCatGreeting('bye');
    }
  }
  async function clearAttendanceDay(date: string) {
    await clearDay(date);
    setDays(list => list.filter(item => item.date !== date));
    if (date === today) {
      await cancelNotice('missing-punch-out');
      await cancelNotice('work-target');
    }
  }
  async function officeOut() {
    if (active || !sessions.length) return;
    if (day.officeOutAt) { setOfficeOutSummary(day); return; }
    const stamp = new Date();
    const updated = await saveDay({ ...day, officeOutAt: stamp.toISOString() });
    setDays(list => [updated, ...list.filter(item => item.date !== updated.date)]);
    await cancelNotice('missing-punch-out');
    await cancelNotice('work-target');
    setOfficeOutSummary(updated);
  }
  async function undoOfficeOut() {
    const target = officeOutSummary ?? day;
    if (!target.officeOutAt) return;
    const reopened = await saveDay({ ...target, officeOutAt: null });
    setDays(list => [reopened, ...list.filter(item => item.date !== reopened.date)]);
    setOfficeOutSummary(null);
  }
  async function savePunchCorrection(date: string, correctedSessions: AttendanceSession[], addToExisting: boolean) {
    const existing = days.find(item => item.date === date);
    const base = existing ?? { date, punchInAt: null, punchOutAt: null, breakMinutes: policy.defaultBreakMinutes, managerApproval: false, synced: true };
    const allSessions = (addToExisting ? [...getDaySessions(base), ...correctedSessions] : correctedSessions)
      .slice().sort((a, b) => a.punchInAt.localeCompare(b.punchInAt));
    if (!allSessions.length) throw new Error('Add at least one punch-in and punch-out time.');
    for (let index = 0; index < allSessions.length; index++) {
      const current = allSessions[index];
      if (current.punchOutAt && new Date(current.punchOutAt) <= new Date(current.punchInAt)) throw new Error('Punch-out must be later than punch-in.');
      if (!current.punchOutAt && (date !== today || index !== allSessions.length - 1)) throw new Error('Only the final session today can be left in progress.');
      const next = allSessions[index + 1];
      if (next && (!current.punchOutAt || new Date(current.punchOutAt) > new Date(next.punchInAt))) throw new Error('Punch sessions cannot overlap. Check the times and try again.');
    }
    const hasOpenSession = allSessions.some(item => !item.punchOutAt);
    const draft: AttendanceDay = { ...base, date, sessions: allSessions,
      punchInAt: allSessions[0]?.punchInAt ?? null,
      punchOutAt: hasOpenSession ? null : allSessions[allSessions.length - 1]?.punchOutAt ?? null };
    const updated = await saveDay(draft);
    setDays(list => [updated, ...list.filter(item => item.date !== date)].sort((a, b) => b.date.localeCompare(a.date)));
    if (date === today) {
      const correctedSummary = getAttendanceSummary(updated, now, policy);
      const openSession = allSessions.some(item => !item.punchOutAt);
      if (openSession) await scheduleTimedNotice('missing-punch-out', 'Don’t forget to punch out', 'Your attendance session is still open.', 9 * 60 * 60 * 1000);
      else await cancelNotice('missing-punch-out');
      if (correctedSummary.targetReached) await cancelNotice('work-target');
      else if (allSessions.length) await scheduleWorkTarget(policy, correctedSummary, updated);
    }
  }
  async function scheduleWorkTarget(config = policy, currentSummary = summary, record = day) {
    const ms = Math.max(60_000, currentSummary.remainingMinutes * 60_000);
      await scheduleTimedNotice('work-target', 'Daily work goal reached! 🎉', `Congratulations! You reached ${formatDuration(config.recordedWorkTargetMinutes)} of recorded work today. Fantastic work!`, ms);
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
      login_at: sessions[0]?.punchInAt ?? day.punchInAt, minutes_late: summary.lateMinutes, after_flex_limit: summary.afterFlexLimit, review_status: 'pending' }, { onConflict: 'user_id,work_date' });
    if (error) Alert.alert('Request not sent', error.message); else Alert.alert('Request submitted', 'Your manager can review this late-arrival request.');
  }
  async function changePolicy(key: keyof PolicyConfig, value: any) {
    const next = { ...policy, [key]: value }; setPolicy(next); await savePolicy(next);
    if (day.punchInAt && ['recordedWorkTargetMinutes', 'defaultBreakMinutes', 'breakDeductionMode'].includes(key))
      await scheduleWorkTarget(next, getAttendanceSummary(day, now, next), day);
  }
  async function resolveReview(reviewId: string, status: 'approved' | 'rejected') {
    if (!supabase) return;
    const { error } = await supabase.rpc('resolve_late_arrival', { review_id: reviewId, decision: status });
    if (error) Alert.alert('Could not update approval', error.message);
    else { setHrRows(rows => rows.map(row => row.review_id === reviewId ? { ...row, review_status: status } : row)); }
  }

  async function signOut() {
    if (!supabase || !session) return;
    if (session.user?.is_anonymous) {
      const { data: mediaRows, error: listError } = await supabase.rpc('list_my_guest_group_media_paths');
      if (listError) return Alert.alert('Could not clean up guest groups', `${listError.message}\nRun the latest chat-schema.sql in Supabase, then try signing out again.`);
      const mediaPaths = ((mediaRows ?? []) as { media_path: string }[]).map(row => row.media_path);
      for (let offset = 0; offset < mediaPaths.length; offset += 100) {
        const { error } = await supabase.storage.from('chat-media').remove(mediaPaths.slice(offset, offset + 100));
        if (error) return Alert.alert('Could not clean up guest groups', `Some group media could not be deleted: ${error.message}. You are still signed in; retry when online.`);
      }
      const { error: cleanupError } = await supabase.rpc('delete_my_guest_groups');
      if (cleanupError) return Alert.alert('Could not clean up guest groups', `${cleanupError.message}\nYou are still signed in; try again after the database is updated.`);
    }
    const { error } = await supabase.auth.signOut();
    if (error) Alert.alert('Could not sign out', error.message);
  }

  if (booting) return <SafeAreaView style={styles.safe}><View style={styles.center}><ActivityIndicator color={colors.blue} /><Text style={styles.muted}>Loading OfficeTime…</Text></View></SafeAreaView>;
  if (!session && isSupabaseConfigured && !offlineContinue) return <AuthScreen onContinue={() => setOfflineContinue(true)} onJoinChat={async name => {
    const guestUsername = `guest_${Math.random().toString(36).slice(2, 12)}`;
    const { error } = await supabase!.auth.signInAnonymously({ options: { data: { full_name: name, username: guestUsername } } });
    if (error) return error.message;
    setOfflineContinue(true);
    return null;
  }} />;

  const lateDays = days.filter(d => d.date.startsWith(today.slice(0, 7)) && d.punchInAt && getAttendanceSummary(d, new Date(d.punchInAt), policy).afterFlexLimit);
  const halfDayToday = isHalfDayDate(days, today, policy);
  const showPageAnimations = tab !== 'Chat' && tab !== 'Games';
  return <SafeAreaView style={styles.safe}>
    {showPageAnimations && <PageAmbience />}
    <StatusBar style="dark" />
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.header}><View><Text style={styles.eyebrow}>ATTENDANCE, MADE SIMPLE</Text><Text style={styles.title}>OfficeTime</Text><Text style={styles.subtitle}>{now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}</Text></View><View style={styles.avatar}><Text style={styles.avatarText}>{session?.user?.email?.[0]?.toUpperCase() ?? 'OT'}</Text></View></View>
      <View style={[styles.connection, !online && styles.offline]}><View style={[styles.dot, { backgroundColor: online ? '#16A34A' : '#D97706' }]} /><Text style={styles.connectionText}>{online ? (session ? 'Connected · changes sync automatically' : 'Local mode · sign in to sync') : 'Offline · punches saved on this device'}</Text><Pressable onPress={() => { if (session) void signOut(); }}><Text style={styles.link}>{session ? 'Sign out' : ''}</Text></Pressable></View>
      <View style={styles.tabs}>{(['Today', 'History', 'Chat', 'Games', ...(role !== 'employee' ? ['HR'] : [])] as Tab[]).map(item => <Pressable key={item} onPress={() => setTab(item)} style={[styles.tab, tab === item && styles.tabActive]}><Text style={[styles.tabText, tab === item && styles.tabTextActive]}>{item}</Text></Pressable>)}</View>
      {tab === 'Today' && <WalkingCat />}
      {tab === 'Today' && <>
        <View style={styles.hero}>
          <CatCardGreeting kind={catGreeting} onDone={() => setCatGreeting(null)} />
          <View style={styles.heroTop}><View style={{ flex: 1 }}><Text style={styles.heroLabel}>NET WORK TIMER · {active ? 'RUNNING' : 'STOPPED'}</Text><Text style={styles.timerHero}>{formatTimer(timerSeconds)}</Text><Text style={styles.heroSmall}>Net recorded work: {formatDuration(summary.netWorkedMinutes)}</Text>{active && <Text style={styles.shiftEstimate}>{remainingTargetSeconds > 0 ? `Estimated ${formatDuration(policy.recordedWorkTargetMinutes)} target at ${estimatedTargetTime} · if you stay punched in` : '8-hour work target reached 🎉'}</Text>}</View>{catGreeting ? <View style={styles.greetingPill}><Text style={styles.greetingPillText}>{catGreeting === 'hi' ? 'Hi! 👋' : 'Bye! 👋'}</Text></View> : <View style={styles.progressBadge}><Text style={styles.progressBadgeText}>{summary.progressPercent}%</Text></View>}</View>
          {sessions.length > 0 && <View style={styles.breakTimerCard}><Text style={styles.breakTimerLabel}>BREAK TIMER · {breakTimerRunning ? 'RUNNING' : 'STOPPED'}</Text><Text style={styles.breakTimerValue}>{formatTimer(summary.takenBreakSeconds)}</Text><Text style={styles.breakTimerHint}>Taken break · {formatDuration(summary.takenBreakMinutes)}</Text></View>}
          <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${summary.progressPercent}%` }]} /></View>
          <View style={styles.progressMeta}><Text style={styles.heroSmall}>{summary.targetStatus}</Text><Text style={styles.heroSmall}>Target {formatDuration(policy.recordedWorkTargetMinutes)}</Text></View>
          <View style={styles.buttonRow}><Pressable style={[styles.action, styles.primary, (active || !!day.officeOutAt) && styles.dim]} onPress={() => void punch('in')} disabled={active || !!day.officeOutAt}><Text style={styles.actionText}>↗  Punch in</Text></Pressable><Pressable style={[styles.action, styles.teal, !active && styles.dim]} onPress={() => void punch('out')} disabled={!active}><Text style={styles.actionText}>↙  Punch out</Text></Pressable></View>
          {!active && sessions.length > 0 && (day.officeOutAt
            ? <View style={styles.officeOutActions}><Pressable accessibilityRole="button" style={[styles.officeOutButton, { flex: 1, marginTop: 0 }]} onPress={() => void officeOut()}><Text style={styles.officeOutText}>✓ Office out · View summary</Text></Pressable><Pressable accessibilityRole="button" style={styles.undoOfficeOutButton} onPress={() => void undoOfficeOut()}><Text style={styles.undoOfficeOutText}>Undo office out</Text></Pressable></View>
            : <Pressable accessibilityRole="button" style={styles.officeOutButton} onPress={() => void officeOut()}><Text style={styles.officeOutText}>Office out · finish today</Text></Pressable>)}
          <Text style={styles.helper}>{active ? `Started at ${clock(activeSession!.punchInAt)} · don’t forget to punch out` : day.officeOutAt ? `Office day finished at ${clock(day.officeOutAt)}.` : completed ? 'Off the clock · punch in again to add more time or finish the day.' : 'Tap once when you begin your workday.'}</Text>
        </View>
        <View style={styles.statGrid}><Stat label="Punch in" value={clock(sessions[0]?.punchInAt ?? null)} /><Stat label="Punch out" value={active ? 'In progress' : clock(sessions[sessions.length - 1]?.punchOutAt ?? null)} /><Stat label={active ? 'Net work · running' : 'Net work · stopped'} value={formatTimer(timerSeconds)} /><Stat label="Break taken" value={formatDuration(summary.takenBreakMinutes)} /></View>
        <View style={styles.card}><View style={styles.cardHeading}><Text style={styles.sectionTitle}>Policy check</Text><Pill text={halfDayToday ? 'Half-day' : summary.afterFlexLimit ? 'Late login' : summary.lateMinutes ? 'Late before flex limit' : day.punchInAt ? 'On time' : 'Awaiting punch'} warning={halfDayToday || summary.lateMinutes > 0} /></View>
          <Row label="Standard start" value="9:00 AM" /><Row label="Flexible login limit" value="10:00 AM" /><Row label="Login status" value={summary.loginStatus} warning={summary.lateMinutes > 0} />
          <Row label="Sessions today" value={`${sessions.length}${active ? ' · active' : ''}`} />
          <Row label="Late logins after 10 AM this month" value={`${lateDays.length} of ${MONTHLY_LATE_LOGIN_LIMIT} · ${Math.max(0, MONTHLY_LATE_LOGIN_LIMIT - lateDays.length)} left`} warning={lateDays.length >= MONTHLY_LATE_LOGIN_LIMIT} />
          {halfDayToday && <Row label="Today's attendance" value="Half-day applied" warning />}
          {summary.lateMinutes > 0 && day.punchInAt && <Pressable style={styles.outlineButton} onPress={() => void submitLateApproval()}><Text style={styles.outlineText}>Request manager approval</Text></Pressable>}
          <Text style={styles.policyNote}>After-10 AM first punch-ins count toward the four-login monthly limit. The fourth and later qualifying days are marked as half-days.</Text>
        </View>
        <View style={styles.card}><Text style={styles.sectionTitle}>Your workday settings</Text><Text style={styles.muted}>Editable defaults pending HR confirmation</Text>
          <Stepper label="Recorded work target" value={formatDuration(policy.recordedWorkTargetMinutes)} onMinus={() => void changePolicy('recordedWorkTargetMinutes', Math.max(60, policy.recordedWorkTargetMinutes - 30))} onPlus={() => void changePolicy('recordedWorkTargetMinutes', policy.recordedWorkTargetMinutes + 30)} />
          <Stepper label="Expected break" value={`${policy.defaultBreakMinutes} min`} onMinus={() => void changePolicy('defaultBreakMinutes', Math.max(0, policy.defaultBreakMinutes - 15))} onPlus={() => void changePolicy('defaultBreakMinutes', Math.min(240, policy.defaultBreakMinutes + 15))} />
          <Pressable style={styles.outlineButton} onPress={() => void scheduleWorkTarget()}><Text style={styles.outlineText}>Remind me when target is reached</Text></Pressable>
          {Platform.OS === 'web' && <Text style={styles.muted}>Browser reminders need notification permission and this tab open. Use the iOS or Android app for scheduled daily reminders.</Text>}
          <Text style={styles.policyNote}>Punch-in sessions count as recorded work. Each punch-out starts a break timer that stops at the next punch-in. The policy mentions both a 9-hour day including breaks and 8 recorded work hours; confirm the expected break duration with HR.</Text>
        </View>
      </>}
      {tab === 'Today' && <><Pressable style={styles.outlineButton} onPress={() => setCorrectionTarget({ date: today, add: !days.some(item => item.date === today) })}><Text style={styles.outlineText}>{sessions.length ? 'Adjust or add punch times' : 'Add a missed punch'}</Text></Pressable><WorkTimeCalculator targetMinutes={policy.recordedWorkTargetMinutes} />{sessions.length > 0 && <ClearDayControl date={today} onClear={clearAttendanceDay} />}</>}
      {tab === 'History' && <History days={days} policy={policy} onClear={clearAttendanceDay} onCorrect={date => setCorrectionTarget({ date, add: false })} onAddMissed={date => setCorrectionTarget({ date, add: true })} />}
      {tab === 'Chat' && <TeamChat session={session} onJoin={async name => {
        if (!supabase) return 'Configure Supabase to enable shared chat.';
        const { error } = await supabase.auth.signInAnonymously({ options: { data: { full_name: name } } });
        return error?.message ?? null;
      }} />}
      {tab === 'Games' && <MemoryMatchGame />}
      {tab === 'HR' && <HRDashboard rows={hrRows} loading={busy} onRefresh={async () => { setBusy(true); const { data } = await supabase!.rpc('hr_attendance_report'); setHrRows(data ?? []); setBusy(false); }} onResolve={resolveReview} />}
      <View style={styles.footerCard}><Text style={styles.footerTitle}>A note about official attendance</Text><Text style={styles.footerText}>The supplied policy says the office biometric system is the official record. OfficeTime is a companion tracker until HR authorizes it for official use.</Text></View>
      <Text style={styles.footer}>OfficeTime · Secure attendance for your team</Text>
    </ScrollView>
    {showPageAnimations && <PassingGlitterGif />}
    {showPageAnimations && <FallingSpiderMan />}
    {correctionTarget && <PunchCorrectionModal key={`${correctionTarget.date}-${correctionTarget.add}`} date={correctionTarget.date} day={days.find(item => item.date === correctionTarget.date)} addToExisting={correctionTarget.add} onClose={() => setCorrectionTarget(null)} onSave={savePunchCorrection} />}
    {officeOutSummary && <OfficeOutSummaryModal day={officeOutSummary} policy={policy} onClose={() => { setOfficeOutSummary(null); setCatGreeting('bye'); }} onUndo={undoOfficeOut} />}
  </SafeAreaView>;
}

function WalkingCat() {
  const [sceneWidth, setSceneWidth] = useState(0);
  const walk = useRef(new Animated.Value(0)).current;
  const bounce = useRef(new Animated.Value(0)).current;
  const sparkle = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (sceneWidth < 80) return;
    const walking = Animated.loop(Animated.timing(walk, { toValue: 1, duration: 8200, easing: Easing.linear, useNativeDriver: true }));
    const steps = Animated.loop(Animated.sequence([
      Animated.timing(bounce, { toValue: 1, duration: 230, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(bounce, { toValue: 0, duration: 230, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]));
    const twinkle = Animated.loop(Animated.sequence([
      Animated.timing(sparkle, { toValue: 1, duration: 1000, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(sparkle, { toValue: 0, duration: 1000, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    walking.start(); steps.start(); twinkle.start();
    return () => { walking.stop(); steps.stop(); twinkle.stop(); };
  }, [sceneWidth, walk, bounce, sparkle]);
  const translateX = walk.interpolate({ inputRange: [0, 1], outputRange: [4, Math.max(4, sceneWidth - 54)] });
  const pawTrailX = walk.interpolate({ inputRange: [0, 1], outputRange: [0, Math.max(0, sceneWidth - 114)] });
  const translateY = bounce.interpolate({ inputRange: [0, 1], outputRange: [0, -3] });
  const pawOpacity = sparkle.interpolate({ inputRange: [0, 1], outputRange: [0.2, 0.8] });
  return <View accessibilityLabel="An animated cat walking across a sunny garden" style={styles.catScene} onLayout={event => setSceneWidth(event.nativeEvent.layout.width)}>
    <View style={styles.catSun}/><Text style={styles.catCloud}>☁️</Text><Text style={styles.catTitle}>OFFICE COMPANION</Text><Text style={styles.catCaption}>Milo is making the rounds</Text>
    <View style={styles.catHorizon}/><View style={styles.catGrassLeft}/><View style={styles.catGrassRight}/>
    <Animated.Text style={[styles.catPaws, { opacity: pawOpacity, transform: [{ translateX: pawTrailX }] }]}>🐾　🐾　🐾</Animated.Text>
    <Animated.View style={[styles.walkingCat, { transform: [{ translateX }, { translateY }, { scaleX: -1 }] }]}><Text style={styles.catEmoji}>🐈</Text></Animated.View>
  </View>;
}

function CatCardGreeting({ kind, onDone }: { kind: 'hi' | 'bye' | null; onDone: () => void }) {
  const breathe = useRef(new Animated.Value(0)).current;
  const blink = useRef(new Animated.Value(0)).current;
  const greetingIn = useRef(new Animated.Value(0)).current;
  const reveal = useRef(new Animated.Value(0)).current;
  const pawWave = useRef(new Animated.Value(0)).current;
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    const breathing = Animated.loop(Animated.sequence([
      Animated.timing(breathe, { toValue: 1, duration: 5200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(breathe, { toValue: 0, duration: 5200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    const blinking = Animated.loop(Animated.sequence([
      Animated.delay(2100), Animated.timing(blink, { toValue: 1, duration: 90, useNativeDriver: true }),
      Animated.timing(blink, { toValue: 0, duration: 160, useNativeDriver: true }), Animated.delay(110),
      Animated.timing(blink, { toValue: 1, duration: 90, useNativeDriver: true }), Animated.timing(blink, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]));
    breathing.start(); blinking.start();
    return () => { breathing.stop(); blinking.stop(); };
  }, [breathe, blink]);
  useEffect(() => {
    if (!kind) { greetingIn.setValue(0); return; }
    greetingIn.setValue(0);
    reveal.setValue(0);
    pawWave.setValue(0);
    Animated.parallel([
      Animated.timing(reveal, { toValue: 1, duration: 360, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.spring(greetingIn, { toValue: 1, damping: 12, stiffness: 140, useNativeDriver: true }),
    ]).start();
    const waving = Animated.loop(Animated.sequence([
      Animated.timing(pawWave, { toValue: 1, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(pawWave, { toValue: 0, duration: 220, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]), { iterations: 5 });
    waving.start();
    const timer = setTimeout(() => {
      Animated.timing(reveal, { toValue: 0, duration: 460, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => doneRef.current());
    }, 1850);
    return () => { clearTimeout(timer); waving.stop(); };
  }, [kind, greetingIn, reveal, pawWave]);
  const scale = breathe.interpolate({ inputRange: [0, 1], outputRange: [1.03, 1.12] });
  const shadeOpacity = reveal.interpolate({ inputRange: [0, 1], outputRange: [1, 0.08] });
  const pawRotate = pawWave.interpolate({ inputRange: [0, 1], outputRange: ['-24deg', '20deg'] });
  const pawLift = greetingIn.interpolate({ inputRange: [0, 1], outputRange: [90, 0] });
  return <View pointerEvents="none" accessibilityLabel="Milo reveals the full timer card, raises a paw, blinks, and greets you" style={styles.heroCatLayer}>
    <Animated.Image source={require('./assets/milo-cat.png')} resizeMode="cover" style={[styles.heroCatImage, { transform: [{ scale }] }]} />
    <Animated.View style={[styles.heroCatShade, { opacity: shadeOpacity }]} />
    <Animated.View style={[styles.heroCatBlink, { opacity: blink }]}><View style={styles.heroCatBlinkLine} /></Animated.View>
    {kind && <Animated.View style={[styles.heroCatPaw, { opacity: reveal, transform: [{ translateY: pawLift }, { rotate: pawRotate }] }]}>
      <View style={styles.heroCatPawArm} /><View style={styles.heroCatPawPalm} />
      <View style={[styles.heroCatToe, styles.heroCatToeOne]} /><View style={[styles.heroCatToe, styles.heroCatToeTwo]} /><View style={[styles.heroCatToe, styles.heroCatToeThree]} />
    </Animated.View>}
  </View>;
}

type ChatRoom = { room_id: string; room_name: string; creator_name: string; created_at: string; member_count: number; password_protected: boolean; joined: boolean; is_creator: boolean; room_type: 'group' | 'direct' };
type ChatRoomMember = { member_id: string; member_name: string; joined_at: string };
type DirectChat = { room_id: string; room_name: string; peer_username: string; created_at: string };
type ChatMessage = { id: string; room_id: string; sender_id: string; sender_name: string; body: string; media_path: string | null; media_type: 'image' | 'video' | 'audio' | null; view_once: boolean; sent_at: string; reply_to?: string | null };
type ChatReaction = { message_id: string; user_id: string; emoji: string };
const QUICK_EMOJIS = ['😊', '❤️', '👍', '😂', '🎉', '🙏'];

function uploadExtension(file: File) {
  return file.name?.split('.').pop()?.toLowerCase() ?? '';
}

function getUploadMediaType(file: File): ChatMessage['media_type'] {
  const mime = file.type?.toLowerCase() ?? '';
  const extension = uploadExtension(file);
  if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'avif'].includes(extension)) return 'image';
  if (mime.startsWith('video/') || ['mp4', 'mov', 'webm', 'm4v'].includes(extension)) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return null;
}

function defaultUploadExtension(mime: string, mediaType: NonNullable<ChatMessage['media_type']>) {
  if (mediaType === 'image') return mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : mime === 'image/heic' ? 'heic' : 'jpg';
  if (mediaType === 'video') return mime === 'video/quicktime' ? 'mov' : mime === 'video/webm' ? 'webm' : 'mp4';
  return mime === 'audio/mp4' ? 'm4a' : mime === 'audio/mpeg' ? 'mp3' : 'webm';
}

function inferredUploadMime(extension: string, mediaType: NonNullable<ChatMessage['media_type']>) {
  const mimeByExtension: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', avif: 'image/avif',
    mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4a: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
  };
  return mimeByExtension[extension] || `${mediaType}/octet-stream`;
}

function TeamChat({ session, onJoin }: { session: any; onJoin: (name: string) => Promise<string | null> }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [directChats, setDirectChats] = useState<DirectChat[]>([]);
  const [myUsername, setMyUsername] = useState('');
  const [selectedRoom, setSelectedRoom] = useState<ChatRoom | null>(null);
  const [roomName, setRoomName] = useState('');
  const [roomPassword, setRoomPassword] = useState('');
  const [joinRoomId, setJoinRoomId] = useState<string | null>(null);
  const [joinPassword, setJoinPassword] = useState('');
  const [showCreateRoom, setShowCreateRoom] = useState(false);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [roomBusy, setRoomBusy] = useState(false);
  const [roomError, setRoomError] = useState('');
  const [roomMembers, setRoomMembers] = useState<ChatRoomMember[]>([]);
  const [showRoomSettings, setShowRoomSettings] = useState(false);
  const [updatedRoomPassword, setUpdatedRoomPassword] = useState('');
  const [roomSettingsBusy, setRoomSettingsBusy] = useState(false);
  const [kickConfirmId, setKickConfirmId] = useState<string | null>(null);
  const [deleteRoomConfirm, setDeleteRoomConfirm] = useState(false);
  const [roomNotice, setRoomNotice] = useState('');
  const [inviteUsername, setInviteUsername] = useState('');
  const [directUsername, setDirectUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState('');
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [reactions, setReactions] = useState<ChatReaction[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [viewOnce, setViewOnce] = useState(false);
  const [sending, setSending] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteAllTarget, setDeleteAllTarget] = useState<ChatMessage | null>(null);
  const [chatError, setChatError] = useState('');
  const [recording, setRecording] = useState(false);
  const [mediaView, setMediaView] = useState<{ url: string; type: string; once: boolean } | null>(null);
  const [viewed, setViewed] = useState<string[]>([]);
  const recorder = useRef<MediaRecorder | null>(null);
  const mediaStream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const messageScroll = useRef<ScrollView>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const isJoined = !!session?.user?.id;
  const isAnonymous = !!session?.user?.is_anonymous;
  const myName = session?.user?.user_metadata?.full_name || session?.user?.email?.split('@')[0] || 'Guest';

  const refreshRooms = useCallback(async () => {
    if (!supabase || !isJoined) return [] as ChatRoom[];
    setRoomsLoading(true);
    const [{ data, error }, { data: directData, error: directError }, { data: usernameData }] = await Promise.all([
      supabase.rpc('list_chat_rooms'), supabase.rpc('list_direct_chats'), supabase.rpc('my_chat_username'),
    ]);
    setRoomsLoading(false);
    if (error) { setRoomError(`Chat rooms need the latest database setup: ${error.message}`); return [] as ChatRoom[]; }
    if (directError) setRoomError(`Private chats need the latest database setup: ${directError.message}`);
    const nextRooms = (data ?? []) as ChatRoom[];
    setRooms(nextRooms);
    setDirectChats((directData ?? []) as DirectChat[]);
    setMyUsername((usernameData as string | null) ?? '');
    return nextRooms;
  }, [isJoined]);

  useEffect(() => { if (isJoined) void refreshRooms(); }, [isJoined, refreshRooms]);

  useEffect(() => {
    if (!supabase || !isJoined || !session?.user?.id) return;
    const channel = supabase.channel(`officetime-room-membership-${session.user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_room_members', filter: `user_id=eq.${session.user.id}` }, () => { void refreshRooms(); })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'chat_room_members' }, payload => {
        const removed = payload.old as { user_id?: string; room_id?: string };
        if (removed.user_id !== session.user.id) return;
        if (selectedRoom?.room_id === removed.room_id) {
          setSelectedRoom(null); setMessages([]); setReactions([]); setReplyTo(null);
          setRoomNotice('You were removed from that group.');
        }
        void refreshRooms();
      })
      .subscribe();
    return () => { void supabase?.removeChannel(channel); };
  }, [isJoined, session?.user?.id, selectedRoom?.room_id, refreshRooms]);

  async function createRoom() {
    if (!supabase || !roomName.trim() || !roomPassword || roomBusy) return;
    setRoomBusy(true); setRoomError('');
    const { data, error } = await supabase.rpc('create_chat_room', { name_in: roomName.trim(), password_in: roomPassword });
    if (error) setRoomError(error.message);
    else {
      const nextRooms = await refreshRooms();
      const created = nextRooms.find(room => room.room_id === data);
      if (created) setSelectedRoom(created);
      setRoomName(''); setRoomPassword(''); setShowCreateRoom(false);
    }
    setRoomBusy(false);
  }

  async function enterRoom(room: ChatRoom, password = '') {
    if (!supabase || roomBusy) return;
    setRoomBusy(true); setRoomError(''); setRoomNotice('');
    if (!room.joined) {
      const { data, error } = await supabase.rpc('join_chat_room', { room_id_in: room.room_id, password_in: password });
      if (error || !data) {
        setRoomError(error?.message || 'That password is incorrect, or there have been too many attempts. Try again later.');
        setRoomBusy(false); return;
      }
    }
    const nextRooms = await refreshRooms();
    setSelectedRoom(nextRooms.find(item => item.room_id === room.room_id) ?? { ...room, joined: true });
    setJoinRoomId(null); setJoinPassword(''); setRoomError(''); setMessages([]); setReactions([]);
    setShowRoomSettings(false); setRoomMembers([]); setKickConfirmId(null);
    setRoomBusy(false);
  }

  async function addMemberByUsername() {
    if (!supabase || !selectedRoom?.is_creator || !inviteUsername.trim() || roomSettingsBusy) return;
    setRoomSettingsBusy(true); setRoomError(''); setRoomNotice('');
    const { data, error } = await supabase.rpc('add_chat_room_member_by_username', { room_id_in: selectedRoom.room_id, username_in: inviteUsername.trim() });
    if (error) setRoomError(error.message);
    else {
      const invited = (data?.[0] ?? null) as { member_name: string; username: string } | null;
      setInviteUsername('');
      await loadRoomMembers(selectedRoom);
      const nextRooms = await refreshRooms();
      const updatedRoom = nextRooms.find(room => room.room_id === selectedRoom.room_id);
      if (updatedRoom) setSelectedRoom(updatedRoom);
      setRoomNotice(invited ? `@${invited.username} was added to the room.` : 'The user was added to the room.');
    }
    setRoomSettingsBusy(false);
  }

  async function startDirectChat() {
    if (!supabase || !directUsername.trim() || roomBusy) return;
    setRoomBusy(true); setRoomError(''); setRoomNotice('');
    const { data, error } = await supabase.rpc('open_direct_chat', { username_in: directUsername.trim() });
    if (error) setRoomError(error.message);
    else {
      const opened = (data?.[0] ?? null) as { room_id: string; room_name: string; peer_username: string } | null;
      if (opened) {
        setSelectedRoom({ room_id: opened.room_id, room_name: opened.room_name, creator_name: opened.peer_username, created_at: new Date().toISOString(), member_count: 2, password_protected: false, joined: true, is_creator: false, room_type: 'direct' });
        setMessages([]); setReactions([]); setDirectUsername(''); void refreshRooms();
      }
    }
    setRoomBusy(false);
  }

  async function loadRoomMembers(room: ChatRoom) {
    if (!supabase) return;
    const { data, error } = await supabase.rpc('list_chat_room_members', { room_id_in: room.room_id });
    if (error) setRoomError(`Could not load room members: ${error.message}`);
    else setRoomMembers((data ?? []) as ChatRoomMember[]);
  }

  async function saveRoomPassword() {
    if (!supabase || !selectedRoom || !selectedRoom.is_creator || roomSettingsBusy) return;
    setRoomSettingsBusy(true); setRoomError(''); setRoomNotice('');
    const { error } = await supabase.rpc('set_chat_room_password', { room_id_in: selectedRoom.room_id, password_in: updatedRoomPassword });
    if (error) setRoomError(error.message);
    else {
      const nextRooms = await refreshRooms();
      const updatedRoom = nextRooms.find(room => room.room_id === selectedRoom.room_id);
      if (updatedRoom) setSelectedRoom(updatedRoom);
      setUpdatedRoomPassword('');
      setRoomNotice(updatedRoomPassword ? 'Room password updated.' : 'Room password removed; anyone can join this room.');
    }
    setRoomSettingsBusy(false);
  }

  async function kickRoomMember(member: ChatRoomMember) {
    if (!supabase || !selectedRoom || !selectedRoom.is_creator || roomSettingsBusy) return;
    if (kickConfirmId !== member.member_id) { setKickConfirmId(member.member_id); return; }
    setRoomSettingsBusy(true); setRoomError('');
    const { data, error } = await supabase.rpc('kick_chat_room_member', { room_id_in: selectedRoom.room_id, member_id_in: member.member_id });
    if (error) setRoomError(error.message);
    else if (!data) setRoomError('That member is no longer in this room.');
    else {
      setRoomMembers(current => current.filter(item => item.member_id !== member.member_id));
      const nextRooms = await refreshRooms();
      const updatedRoom = nextRooms.find(room => room.room_id === selectedRoom.room_id);
      if (updatedRoom) setSelectedRoom(updatedRoom);
      setRoomNotice(`${member.member_name} was removed from this room.`);
    }
    setKickConfirmId(null); setRoomSettingsBusy(false);
  }

  async function deleteRoom() {
    if (!supabase || !selectedRoom?.is_creator || roomSettingsBusy) return;
    if (!deleteRoomConfirm) { setDeleteRoomConfirm(true); return; }
    setRoomSettingsBusy(true); setRoomError('');
    try {
      const { data: mediaRows, error: pathsError } = await supabase.rpc('list_chat_room_media_paths', { room_id_in: selectedRoom.room_id });
      if (pathsError) throw pathsError;
      const paths = ((mediaRows ?? []) as { media_path: string }[]).map(row => row.media_path);
      for (let offset = 0; offset < paths.length; offset += 100) {
        const { error: mediaError } = await supabase.storage.from('chat-media').remove(paths.slice(offset, offset + 100));
        if (mediaError) throw new Error(`Could not remove room media: ${mediaError.message}`);
      }
      const { error } = await supabase.rpc('delete_chat_room', { room_id_in: selectedRoom.room_id });
      if (error) throw error;
      const deletedName = selectedRoom.room_name;
      setSelectedRoom(null); setMessages([]); setReactions([]); setReplyTo(null); setDraft(''); setFile(null);
      setRoomMembers([]); setShowRoomSettings(false); setDeleteRoomConfirm(false); setKickConfirmId(null);
      setRooms(current => current.filter(room => room.room_id !== selectedRoom.room_id));
      setRoomNotice(`“${deletedName}” and its messages were deleted.`);
    } catch (error: any) {
      setRoomError(error?.message || 'Could not delete this room.');
      setDeleteRoomConfirm(false);
    } finally { setRoomSettingsBusy(false); }
  }

  function backToLobby() {
    setSelectedRoom(null); setMessages([]); setReactions([]); setReplyTo(null); setDraft(''); setFile(null); setChatError(''); setRoomError(''); setRoomMembers([]); setShowRoomSettings(false); setDeleteRoomConfirm(false); setRoomNotice('');
    void refreshRooms();
  }

  useEffect(() => {
    if (!supabase || !isJoined || !selectedRoom) return;
    let alive = true;
    void (async () => {
      const { data: hidden, error: hideError } = await supabase.from('chat_message_hides').select('message_id').eq('viewer_id', session.user.id);
      if (!alive) return;
      const hiddenIds = new Set((hidden ?? []).map(row => row.message_id as string));
      if (hideError) setChatError(`Delete controls need the latest chat database setup: ${hideError.message}`);
      const { data, error } = await supabase.from('chat_messages').select('*').eq('room_id', selectedRoom.room_id).order('sent_at', { ascending: true }).limit(100);
      if (!alive) return;
      if (error) setChatError(error.message);
      else {
        const visibleMessages = ((data ?? []) as ChatMessage[]).filter(message => !hiddenIds.has(message.id));
        setMessages(visibleMessages);
        if (!hideError) setChatError('');
        if (visibleMessages.length) {
          const { data: reactionRows, error: reactionError } = await supabase.from('chat_message_reactions').select('message_id,user_id,emoji').in('message_id', visibleMessages.map(message => message.id));
          if (!alive) return;
          if (reactionError) setChatError(`Reactions need the latest chat database setup: ${reactionError.message}`);
          else setReactions((reactionRows ?? []) as ChatReaction[]);
        } else setReactions([]);
      }
    })();
    const channel = supabase.channel(`officetime-chat-${selectedRoom.room_id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${selectedRoom.room_id}` }, payload => {
        if (!alive) return;
        const incoming = payload.new as ChatMessage;
        setMessages(current => current.some(item => item.id === incoming.id) ? current : [...current, incoming].slice(-100));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'chat_messages' }, payload => {
        if (!alive) return;
        const deletedId = (payload.old as Partial<ChatMessage>).id;
        if (deletedId) setMessages(current => current.filter(item => item.id !== deletedId));
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_message_hides', filter: `viewer_id=eq.${session.user.id}` }, payload => {
        if (!alive) return;
        const hiddenId = (payload.new as { message_id: string }).message_id;
        setMessages(current => current.filter(item => item.id !== hiddenId));
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_message_reactions' }, payload => {
        if (!alive) return;
        const incoming = payload.new as ChatReaction;
        setReactions(current => current.some(item => item.message_id === incoming.message_id && item.user_id === incoming.user_id && item.emoji === incoming.emoji) ? current : [...current, incoming]);
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'chat_message_reactions' }, payload => {
        if (!alive) return;
        const removed = payload.old as ChatReaction;
        setReactions(current => current.filter(item => !(item.message_id === removed.message_id && item.user_id === removed.user_id && item.emoji === removed.emoji)));
      }).subscribe();
    return () => { alive = false; void supabase?.removeChannel(channel); };
  }, [isJoined, session?.user?.id, selectedRoom?.room_id]);

  useEffect(() => () => {
    recorder.current?.stop();
    mediaStream.current?.getTracks().forEach(track => track.stop());
  }, []);

  function chooseFile() {
    if (Platform.OS !== 'web') return Alert.alert('Use the website', 'Photo and video upload is available in the web chat.');
    // Safari (especially iOS Safari) may ignore click() on a detached file input.
    // Keep a real input in the document and open it directly from the user gesture.
    fileInput.current?.click();
  }

  function handleFileSelection(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const selected = input.files?.[0];
    // Reset so selecting the same photo again fires change in Safari too.
    input.value = '';
    if (!selected) return;
    if (selected.size > 50 * 1024 * 1024) return Alert.alert('File too large', 'Choose a photo or video under 50 MB.');
    const mediaType = getUploadMediaType(selected);
    if (!mediaType || mediaType === 'audio') return Alert.alert('Unsupported file', 'Choose an image or video.');
    setFile(selected); setViewOnce(false);
  }

  async function startVoiceRecording() {
    try {
      if (Platform.OS !== 'web' || !(globalThis as any).navigator?.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined')
        return Alert.alert('Voice recording unavailable', 'Use a supported browser and allow microphone access.');
      const stream = await (globalThis as any).navigator.mediaDevices.getUserMedia({ audio: true }) as MediaStream;
      mediaStream.current = stream; chunks.current = [];
      const audioRecorder = new MediaRecorder(stream);
      recorder.current = audioRecorder;
      audioRecorder.ondataavailable = event => { if (event.data.size) chunks.current.push(event.data); };
      audioRecorder.onstop = () => {
        stream.getTracks().forEach(track => track.stop()); mediaStream.current = null;
        const blob = new Blob(chunks.current, { type: audioRecorder.mimeType || 'audio/webm' });
        if (blob.size) {
          const audioFile = new File([blob], `voice-${Date.now()}.${blob.type.includes('mp4') ? 'm4a' : 'webm'}`, { type: blob.type });
          void sendMessage('', audioFile);
        }
      };
      audioRecorder.start(); setRecording(true);
    } catch { Alert.alert('Microphone unavailable', 'Allow microphone access in your browser settings, then try again.'); }
  }

  function stopVoiceRecording() { recorder.current?.stop(); recorder.current = null; setRecording(false); }

  async function sendMessage(text = draft, attachment = file) {
    if (!supabase || !session?.user?.id || !selectedRoom || sending) return;
    const body = text.trim();
    if (!body && !attachment) return;
    if (body.length > 1000) return Alert.alert('Message too long', 'Keep chat messages under 1,000 characters.');
    setSending(true);
    try {
      let mediaPath: string | null = null;
      let mediaType: ChatMessage['media_type'] = null;
      if (attachment) {
        if (attachment.size > 50 * 1024 * 1024) throw new Error('Media files must be under 50 MB.');
        mediaType = getUploadMediaType(attachment);
        if (!mediaType) throw new Error('This file type is not supported.');
        const extension = attachment.name?.split('.').pop()?.replace(/[^a-z0-9]/gi, '').slice(0, 8) || defaultUploadExtension(attachment.type, mediaType);
        const contentType = attachment.type && attachment.type !== 'application/octet-stream' ? attachment.type : inferredUploadMime(extension, mediaType);
        mediaPath = `${session.user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
        const { error: uploadError } = await supabase.storage.from('chat-media').upload(mediaPath, attachment, { contentType, upsert: false });
        if (uploadError) throw uploadError;
      }
      const { error } = await supabase.from('chat_messages').insert({ room_id: selectedRoom.room_id, sender_id: session.user.id, sender_name: myName.slice(0, 40), body, media_path: mediaPath, media_type: mediaType, view_once: !!(viewOnce && mediaType === 'image'), reply_to: replyTo?.id ?? null });
      if (error) throw error;
      setDraft(''); setFile(null); setViewOnce(false); setReplyTo(null);
    } catch (error: any) { Alert.alert('Message not sent', error?.message || 'Check your connection and try again.'); }
    finally { setSending(false); }
  }

  async function toggleReaction(message: ChatMessage, emoji: string) {
    if (!supabase || !session?.user?.id) return;
    const existing = reactions.some(item => item.message_id === message.id && item.user_id === session.user.id && item.emoji === emoji);
    const query = supabase.from('chat_message_reactions');
    const { error } = existing
      ? await query.delete().eq('message_id', message.id).eq('user_id', session.user.id).eq('emoji', emoji)
      : await query.insert({ message_id: message.id, user_id: session.user.id, emoji });
    if (error) setChatError(`Could not update reaction: ${error.message}`);
    else setReactions(current => existing
      ? current.filter(item => !(item.message_id === message.id && item.user_id === session.user.id && item.emoji === emoji))
      : [...current, { message_id: message.id, user_id: session.user.id, emoji }]);
  }

  async function deleteForMe(message: ChatMessage) {
    if (!supabase || !session?.user?.id || deletingId) return;
    setDeletingId(message.id); setChatError('');
    try {
      const { error } = await supabase.from('chat_message_hides').insert({ message_id: message.id, viewer_id: session.user.id });
      if (error) throw error;
      setMessages(current => current.filter(item => item.id !== message.id));
    } catch (error: any) { setChatError(error?.message || 'Could not hide this message for you.'); }
    finally { setDeletingId(null); }
  }

  async function deleteForEveryone(message: ChatMessage) {
    if (!supabase || !session?.user?.id || (message.sender_id !== session.user.id && !selectedRoom?.is_creator) || deletingId) return;
    setDeletingId(message.id); setChatError('');
    try {
      const { data, error } = await supabase.from('chat_messages').delete().eq('id', message.id).eq('sender_id', session.user.id).select('id').maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('You do not have permission to remove this message.');
      setMessages(current => current.filter(item => item.id !== message.id));
      setDeleteAllTarget(null);
      if (message.media_path) {
        const { error: mediaError } = await supabase.storage.from('chat-media').remove([message.media_path]);
        if (mediaError) setChatError(`Message removed, but its attachment could not be cleaned up: ${mediaError.message}`);
      }
    } catch (error: any) { setChatError(error?.message || 'Could not delete this message.'); }
    finally { setDeletingId(null); }
  }

  async function openMedia(message: ChatMessage) {
    if (!supabase || !message.media_type) return;
    if (message.view_once && viewed.includes(message.id)) return Alert.alert('Already opened', 'This photo can only be viewed once on this account.');
    const { data, error } = await supabase.functions.invoke('chat-media-url', { body: { messageId: message.id } });
    if (error || !data?.url) return Alert.alert('Media unavailable', error?.message || 'Could not open this attachment.');
    if (message.view_once) setViewed(current => [...current, message.id]);
    setMediaView({ url: data.url, type: message.media_type, once: message.view_once });
  }

  if (!supabase) return <View style={styles.card}><Text style={styles.sectionTitle}>Team chat</Text><Text style={styles.muted}>Shared chat needs Supabase configured. Set up the chat schema and media function using the README instructions.</Text></View>;

  return <View style={styles.chatCard}>
    <View style={styles.chatHeading}><View style={styles.chatAvatar}><Text style={styles.chatAvatarText}>✦</Text></View><View style={{ flex: 1 }}><Text style={styles.sectionTitle}>{selectedRoom?.room_name ?? (isJoined ? 'Chat Lobby' : 'Office chat')}</Text><Text style={styles.chatPresence}>{selectedRoom ? `${selectedRoom.member_count} members · private group · live` : 'Find a group or create your own'}</Text></View>{selectedRoom ? <Pressable onPress={backToLobby}><Text style={styles.link}>← Lobby</Text></Pressable> : <Text style={styles.onlineBadge}>● LIVE</Text>}</View>
    {!!roomError && <Text accessibilityRole="alert" style={{ color: '#B91C1C', fontSize: 12, lineHeight: 18 }}>{roomError}</Text>}
    {!!roomNotice && <Text style={{ color: '#15803D', fontSize: 12, lineHeight: 18 }}>{roomNotice}</Text>}
    {!!chatError && <Text accessibilityRole="alert" style={{ color: '#B91C1C', fontSize: 12, lineHeight: 18 }}>{chatError}</Text>}
    {!isJoined ? <View style={styles.chatJoin}><Text style={styles.chatWelcome}>Enter the chat lobby</Text><Text style={styles.muted}>Set a display name to browse groups. You’ll need a room password to enter private groups.</Text><TextInput style={styles.input} value={displayName} onChangeText={value => { setDisplayName(value); setJoinError(''); }} placeholder="Your name" maxLength={40} /><Pressable style={[styles.action, styles.primary, joining && styles.dim]} disabled={!displayName.trim() || joining} onPress={() => { setJoining(true); setJoinError(''); void onJoin(displayName.trim()).then(message => setJoinError(message ?? '')).catch(error => setJoinError(error instanceof Error ? error.message : 'Could not connect to Supabase. Check your internet connection and try again.')).finally(() => setJoining(false)); }}><Text style={styles.actionText}>{joining ? 'Please wait…' : 'Enter chat lobby'}</Text></Pressable>{!!joinError && <Text accessibilityRole="alert" style={{ color: '#B91C1C', fontSize: 12, lineHeight: 18 }}>{joinError}</Text>}</View> : !selectedRoom ? <>
      <View style={styles.chatIdentity}><Text style={styles.chatIdentityText}>Browsing as {myName}{isAnonymous ? ' · guest' : ''}</Text>{!!myUsername && <Text style={{ color: colors.blue, fontSize: 10, fontWeight: '800', marginTop: 4 }}>Your username: @{myUsername}</Text>}</View>
      {!isAnonymous && <View style={{ gap: 8, padding: 12, backgroundColor: '#EFF6FF', borderRadius: 14 }}><Text style={styles.chatWelcome}>Start a personal chat</Text><Text style={styles.chatPresence}>Enter someone’s username to open your private conversation.</Text><View style={{ flexDirection: 'row', gap: 8 }}><TextInput style={[styles.input, { flex: 1 }]} value={directUsername} onChangeText={setDirectUsername} placeholder="Username" autoCapitalize="none" autoCorrect={false} onSubmitEditing={() => void startDirectChat()}/><Pressable disabled={roomBusy || !directUsername.trim()} onPress={() => void startDirectChat()} style={[styles.action, styles.primary, (roomBusy || !directUsername.trim()) && styles.dim]}><Text style={styles.actionText}>{roomBusy ? 'Opening…' : 'Chat'}</Text></Pressable></View>
        {directChats.length > 0 && <View style={{ gap: 6, marginTop: 5 }}><Text style={styles.historyTitle}>Your personal chats</Text>{directChats.map(chat => <Pressable key={chat.room_id} onPress={() => setSelectedRoom({ room_id: chat.room_id, room_name: chat.room_name, creator_name: chat.peer_username, created_at: chat.created_at, member_count: 2, password_protected: false, joined: true, is_creator: false, room_type: 'direct' })} style={{ padding: 9, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.border, borderRadius: 10 }}><Text style={styles.historyTitle}>{chat.room_name}</Text><Text style={styles.chatPresence}>@{chat.peer_username}</Text></Pressable>)}</View>}
      </View>}
      <Pressable onPress={() => { setShowCreateRoom(value => !value); setRoomError(''); }} style={[styles.action, styles.primary]}><Text style={styles.actionText}>{showCreateRoom ? 'Cancel room creation' : '+ Create a chat room'}</Text></Pressable>
      {showCreateRoom && <View style={{ gap: 9, padding: 12, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: colors.border, borderRadius: 14 }}><Text style={styles.chatWelcome}>Create a private group</Text><TextInput style={styles.input} value={roomName} onChangeText={setRoomName} placeholder="Room name" maxLength={50}/><TextInput style={styles.input} value={roomPassword} onChangeText={setRoomPassword} placeholder="Create a password (4+ characters)" secureTextEntry maxLength={72}/><Pressable disabled={roomBusy || !roomName.trim() || roomPassword.length < 4} onPress={() => void createRoom()} style={[styles.action, styles.primary, (roomBusy || !roomName.trim() || roomPassword.length < 4) && styles.dim]}><Text style={styles.actionText}>{roomBusy ? 'Creating…' : 'Create room'}</Text></Pressable></View>}
      <View style={{ gap: 9 }}><Text style={styles.chatWelcome}>Available groups</Text>{roomsLoading && rooms.length === 0 ? <Text style={styles.muted}>Loading groups…</Text> : rooms.map(room => <View key={room.room_id} style={{ gap: 8, padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 14, backgroundColor: '#FFFFFF' }}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><View style={{ flex: 1 }}><Text style={styles.historyTitle}>{room.room_name}</Text><Text style={styles.chatPresence}>{room.creator_name} · {room.member_count} {room.member_count === 1 ? 'member' : 'members'} · {room.password_protected ? '🔒 Password protected' : 'Open room'}</Text></View>{room.joined && <Text style={styles.onlineBadge}>JOINED</Text>}</View>{room.joined ? <Pressable onPress={() => void enterRoom(room)} style={[styles.action, styles.primary]}><Text style={styles.actionText}>Enter room</Text></Pressable> : joinRoomId === room.room_id ? null : <Pressable onPress={() => { setJoinRoomId(room.room_id); setJoinPassword(''); setRoomError(''); }} style={styles.outlineButton}><Text style={styles.outlineText}>{room.password_protected ? 'Enter password' : 'Join room'}</Text></Pressable>}{!room.joined && joinRoomId === room.room_id && <View style={{ flexDirection: 'row', gap: 7, alignItems: 'center' }}>{room.password_protected && <TextInput style={[styles.input, { flex: 1 }]} value={joinPassword} onChangeText={setJoinPassword} placeholder="Room password" secureTextEntry onSubmitEditing={() => void enterRoom(room, joinPassword)}/>}<Pressable disabled={roomBusy || (room.password_protected && !joinPassword)} onPress={() => void enterRoom(room, joinPassword)} style={[styles.action, styles.primary, (roomBusy || (room.password_protected && !joinPassword)) && styles.dim]}><Text style={styles.actionText}>{roomBusy ? 'Checking…' : 'Enter'}</Text></Pressable><Pressable onPress={() => { setJoinRoomId(null); setJoinPassword(''); }}><Text style={styles.link}>Cancel</Text></Pressable></View>}</View>)}</View>
    </> : <>
      <View style={styles.chatIdentity}><Text style={styles.chatIdentityText}>Chatting as {myName}{isAnonymous ? ' · guest' : ''}</Text>{selectedRoom.is_creator && <Text style={{ color: colors.blue, fontSize: 10, fontWeight: '800', marginTop: 4 }}>Room creator</Text>}</View>
      {selectedRoom.is_creator && <Pressable onPress={() => { const opening = !showRoomSettings; setShowRoomSettings(opening); setRoomError(''); if (opening) void loadRoomMembers(selectedRoom); }} style={styles.outlineButton}><Text style={styles.outlineText}>{showRoomSettings ? 'Hide room management' : 'Manage password and members'}</Text></Pressable>}
      {showRoomSettings && selectedRoom.is_creator && <View style={{ gap: 10, padding: 12, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: colors.border, borderRadius: 14 }}>
        <Text style={styles.chatWelcome}>Room management</Text>
        {selectedRoom.room_type === 'group' && <View style={{ gap: 8, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}><Text style={styles.historyTitle}>Add a member by username</Text><View style={{ flexDirection: 'row', gap: 8 }}><TextInput style={[styles.input, { flex: 1 }]} value={inviteUsername} onChangeText={setInviteUsername} placeholder="Username" autoCapitalize="none" autoCorrect={false}/><Pressable disabled={roomSettingsBusy || !inviteUsername.trim()} onPress={() => void addMemberByUsername()} style={[styles.action, styles.primary, (roomSettingsBusy || !inviteUsername.trim()) && styles.dim]}><Text style={styles.actionText}>Add</Text></Pressable></View><Text style={styles.chatPresence}>They need an OfficeTime account. They’ll be added to this room immediately.</Text></View>}
        <Text style={styles.muted}>{selectedRoom.password_protected ? 'This room currently requires a password.' : 'This room is open to anyone who enters the lobby.'} Enter a new password, or leave it empty to remove password protection.</Text>
        <TextInput style={styles.input} value={updatedRoomPassword} onChangeText={setUpdatedRoomPassword} placeholder="New password (4+ characters)" secureTextEntry maxLength={72}/>
        <Pressable disabled={roomSettingsBusy || (!!updatedRoomPassword && updatedRoomPassword.length < 4) || (!updatedRoomPassword && !selectedRoom.password_protected)} onPress={() => void saveRoomPassword()} style={[styles.action, styles.primary, (roomSettingsBusy || (!!updatedRoomPassword && updatedRoomPassword.length < 4) || (!updatedRoomPassword && !selectedRoom.password_protected)) && styles.dim]}><Text style={styles.actionText}>{roomSettingsBusy ? 'Saving…' : updatedRoomPassword ? 'Update room password' : 'Remove password'}</Text></Pressable>
        <Text style={styles.historyTitle}>Members ({roomMembers.length})</Text>
        {roomMembers.map(member => <View key={member.member_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 }}><Text style={{ flex: 1, color: colors.text, fontSize: 12 }}>{member.member_name}{member.member_id === session.user.id ? ' · you (creator)' : ''}</Text>{member.member_id !== session.user.id && <Pressable disabled={roomSettingsBusy} onPress={() => void kickRoomMember(member)}><Text style={{ color: kickConfirmId === member.member_id ? '#B91C1C' : colors.muted, fontWeight: '800', fontSize: 11 }}>{kickConfirmId === member.member_id ? 'Confirm remove' : 'Remove'}</Text></Pressable>}</View>)}
        {roomMembers.length === 0 && <Text style={styles.muted}>Loading members…</Text>}
        <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10, gap: 8 }}><Text style={{ color: '#B91C1C', fontSize: 11, lineHeight: 16 }}>Deleting this room permanently removes its messages and shared media for everyone.</Text><View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><Pressable disabled={roomSettingsBusy} onPress={() => void deleteRoom()} style={[styles.action, { backgroundColor: '#B91C1C', flex: 1 }, roomSettingsBusy && styles.dim]}><Text style={styles.actionText}>{roomSettingsBusy ? 'Deleting…' : deleteRoomConfirm ? 'Confirm delete room' : 'Delete this room'}</Text></Pressable>{deleteRoomConfirm && <Pressable onPress={() => setDeleteRoomConfirm(false)}><Text style={styles.link}>Cancel</Text></Pressable>}</View></View>
      </View>}
      <ScrollView ref={messageScroll} onContentSizeChange={() => messageScroll.current?.scrollToEnd({ animated: true })} style={styles.chatMessages} contentContainerStyle={styles.chatMessagesContent} nestedScrollEnabled>
        {messages.length === 0 ? <View style={styles.chatEmpty}><Text style={styles.chatEmptyIcon}>☕</Text><Text style={styles.emptyTitle}>Start the conversation</Text><Text style={styles.muted}>Send a message, photo, video, or voice note.</Text></View> : messages.map(message => {
          const mine = message.sender_id === session.user.id;
          const repliedMessage = messages.find(item => item.id === message.reply_to);
          return <View key={message.id} style={[styles.chatBubble, mine ? styles.chatBubbleMine : styles.chatBubbleOther]}>
            {!mine && <Text style={styles.chatSender}>{message.sender_name}</Text>}
            {message.reply_to && <View style={{ borderLeftWidth: 3, borderLeftColor: colors.blue, backgroundColor: '#EFF6FF', padding: 7, borderRadius: 7, marginBottom: 6 }}><Text style={{ color: colors.blue, fontSize: 9, fontWeight: '800' }}>Replying to {repliedMessage?.sender_name ?? 'message'}</Text><Text numberOfLines={2} style={{ color: colors.muted, fontSize: 10 }}>{repliedMessage?.body || (repliedMessage?.media_type ? ` ${repliedMessage.media_type} attachment` : 'Original message hidden or unavailable')}</Text></View>}
            {!!message.body && <Text style={styles.chatBody}>{message.body}</Text>}
            {message.media_path && <Pressable onPress={() => void openMedia(message)} style={styles.mediaButton}><Text style={styles.mediaIcon}>{message.view_once ? '◉' : message.media_type === 'video' ? '▶' : message.media_type === 'audio' ? '♫' : '▧'}</Text><View style={{ flex: 1 }}><Text style={styles.mediaTitle}>{message.view_once ? 'View-once photo' : message.media_type === 'video' ? 'Video' : message.media_type === 'audio' ? 'Voice message' : 'Photo'}</Text><Text style={styles.mediaHint}>{message.view_once && viewed.includes(message.id) ? 'Already opened' : 'Tap to open'}</Text></View><Text style={styles.mediaChevron}>›</Text></Pressable>}
            <Text style={styles.chatTime}>{new Date(message.sent_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 5, marginTop: 6 }}>{QUICK_EMOJIS.map(emoji => { const count = reactions.filter(item => item.message_id === message.id && item.emoji === emoji).length; const selected = reactions.some(item => item.message_id === message.id && item.user_id === session.user.id && item.emoji === emoji); return <Pressable key={emoji} accessibilityLabel={`${selected ? 'Remove' : 'Add'} ${emoji} reaction${count ? `, ${count} total` : ''}`} onPress={() => void toggleReaction(message, emoji)} style={{ borderRadius: 99, borderWidth: 1, borderColor: selected ? colors.blue : colors.border, backgroundColor: selected ? '#DBEAFE' : '#FFFFFF', paddingHorizontal: 6, paddingVertical: 3 }}><Text style={{ fontSize: 11 }}>{emoji}{count ? ` ${count}` : ''}</Text></Pressable>; })}</View>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 7 }}>
              <Pressable onPress={() => setReplyTo(message)}><Text style={{ color: colors.blue, fontSize: 10, fontWeight: '700' }}>Reply</Text></Pressable>
              <Pressable disabled={deletingId === message.id} onPress={() => void deleteForMe(message)}><Text style={{ color: '#64748B', fontSize: 10, fontWeight: '700' }}>Delete for me</Text></Pressable>
              {(mine || selectedRoom.is_creator) && <Pressable disabled={deletingId === message.id} onPress={() => setDeleteAllTarget(message)}><Text style={{ color: '#B91C1C', fontSize: 10, fontWeight: '700' }}>{mine ? 'Delete for everyone' : 'Remove message'}</Text></Pressable>}
            </View>
          </View>;
        })}
      </ScrollView>
      {file && <View style={styles.attachmentPreview}><Text style={styles.attachmentText}>▧  {file.name}</Text><Pressable onPress={() => { setFile(null); setViewOnce(false); }}><Text style={styles.link}>Remove</Text></Pressable></View>}
      {file?.type.startsWith('image/') && <Pressable onPress={() => setViewOnce(value => !value)} style={styles.onceToggle}><Text style={styles.onceCheckbox}>{viewOnce ? '✓' : ''}</Text><Text style={styles.onceText}>View once (each person can open this photo once)</Text></Pressable>}
      <View style={styles.chatComposer}>{!!replyTo && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#EFF6FF', borderRadius: 10, padding: 9 }}><View style={{ flex: 1 }}><Text style={{ color: colors.blue, fontSize: 10, fontWeight: '800' }}>Replying to {replyTo.sender_name}</Text><Text numberOfLines={1} style={styles.muted}>{replyTo.body || (replyTo.media_type ? `${replyTo.media_type} attachment` : '')}</Text></View><Pressable accessibilityLabel="Cancel reply" onPress={() => setReplyTo(null)}><Text style={styles.link}>×</Text></Pressable></View>}<View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>{QUICK_EMOJIS.map(emoji => <Pressable key={emoji} accessibilityLabel={`Insert ${emoji}`} onPress={() => setDraft(current => `${current}${emoji}`)} style={{ paddingHorizontal: 5, paddingVertical: 3 }}><Text style={{ fontSize: 18 }}>{emoji}</Text></Pressable>)}</View><View style={styles.chatTools}><Pressable accessibilityLabel="Add photo or video" onPress={chooseFile} style={styles.chatTool}><Text style={styles.chatToolText}>＋ Media</Text></Pressable><Pressable accessibilityLabel={recording ? 'Stop voice recording' : 'Record voice message'} onPress={recording ? stopVoiceRecording : () => void startVoiceRecording()} style={[styles.chatTool, recording && styles.recordingTool]}><Text style={[styles.chatToolText, recording && styles.recordingText]}>{recording ? '■ Stop' : '● Voice'}</Text></Pressable></View>{Platform.OS === 'web' && <input ref={fileInput} type="file" accept="image/*,video/*" onChange={handleFileSelection} aria-label="Choose a photo or video" style={{ position: 'fixed', width: 1, height: 1, opacity: 0, overflow: 'hidden', left: -100, bottom: 0 }} />}<View style={styles.chatInputRow}><TextInput style={styles.chatInput} multiline maxLength={1000} value={draft} onChangeText={setDraft} placeholder="Message the team…"/><Pressable accessibilityLabel="Send message" disabled={sending || (!draft.trim() && !file)} onPress={() => void sendMessage()} style={[styles.sendButton, (sending || (!draft.trim() && !file)) && styles.dim]}><Text style={styles.sendButtonText}>{sending ? '…' : '↑'}</Text></Pressable></View></View>
    </>}
    <Modal visible={!!mediaView} transparent animationType="fade" onRequestClose={() => setMediaView(null)}><View style={styles.mediaOverlay}><View style={styles.mediaModal}><View style={styles.cardHeading}><Text style={styles.sectionTitle}>{mediaView?.once ? 'View-once photo' : 'Shared media'}</Text><Pressable onPress={() => setMediaView(null)}><Text style={styles.link}>Close</Text></Pressable></View>{mediaView?.type === 'image' ? <Image source={{ uri: mediaView.url }} resizeMode="contain" style={styles.mediaImage}/> : Platform.OS === 'web' && mediaView ? React.createElement(mediaView.type === 'video' ? 'video' : 'audio', { src: mediaView.url, controls: true, playsInline: true, style: { width: '100%', maxHeight: 420 } }) : <Text style={styles.muted}>Open this media in the web app to play it.</Text>}{mediaView?.once && <Text style={styles.onceFootnote}>This view is now used. Close this window to hide the photo.</Text>}</View></View></Modal>
    <Modal visible={!!deleteAllTarget} transparent animationType="fade" onRequestClose={() => setDeleteAllTarget(null)}><View style={styles.mediaOverlay}><View style={styles.mediaModal}><Text style={styles.sectionTitle}>{deleteAllTarget?.sender_id === session?.user?.id ? 'Delete for everyone?' : 'Remove this message?'}</Text><Text style={styles.muted}>{deleteAllTarget?.sender_id === session?.user?.id ? 'This removes your message from the shared chat for all participants.' : 'As the room creator, you can remove this message for everyone in the room.'}</Text><View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }}><Pressable style={styles.outlineButton} onPress={() => setDeleteAllTarget(null)}><Text style={styles.outlineText}>Cancel</Text></Pressable><Pressable disabled={!!deletingId} onPress={() => deleteAllTarget && void deleteForEveryone(deleteAllTarget)} style={[styles.action, { backgroundColor: '#B91C1C', paddingHorizontal: 14 }]}><Text style={styles.actionText}>{deletingId === deleteAllTarget?.id ? 'Deleting…' : 'Remove for everyone'}</Text></Pressable></View></View></View></Modal>
  </View>;
}

function AuthScreen({ onContinue, onJoinChat }: { onContinue: () => void; onJoinChat: (name: string) => Promise<string | null> }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [username, setUsername] = useState(''); const [authMode, setAuthMode] = useState<'login' | 'signup'>('login'); const [authMessage, setAuthMessage] = useState(''); const [guestName, setGuestName] = useState(''); const [busy, setBusy] = useState(false); const [guestError, setGuestError] = useState('');
  async function submitAccount() {
    if (!supabase) return;
    const normalizedUsername = username.trim().toLowerCase();
    if (authMode === 'signup' && !/^[a-z0-9_]{3,24}$/.test(normalizedUsername)) { setAuthMessage('Username must be 3–24 characters using letters, numbers, or underscores.'); return; }
    setBusy(true); setAuthMessage('');
    const result = authMode === 'signup'
      ? await supabase.auth.signUp({ email: email.trim(), password, options: { data: { username: normalizedUsername, full_name: normalizedUsername } } })
      : await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (result.error) setAuthMessage(result.error.message);
    else if (authMode === 'signup' && !result.data.session) setAuthMessage('Account created. Check your email to confirm it, then sign in.');
  }
  async function joinGuestChat() {
    setBusy(true); setGuestError('');
    try { setGuestError((await onJoinChat(guestName.trim())) ?? ''); }
    catch (error) { setGuestError(error instanceof Error ? error.message : 'Could not connect to Supabase. Check your internet connection and try again.'); }
    finally { setBusy(false); }
  }
  return <SafeAreaView style={styles.safe}><StatusBar style="dark"/><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.authWrap}><View style={styles.authCard}><View style={styles.avatarLarge}><Text style={styles.avatarText}>OT</Text></View><Text style={styles.title}>{authMode === 'signup' ? 'Create your account' : 'Welcome to OfficeTime'}</Text><Text style={styles.subtitle}>{authMode === 'signup' ? 'Sign up with your email, password, and a username others can use to find you.' : 'Log in with your email and password.'}</Text>{authMode === 'signup' && <TextInput style={styles.input} placeholder="Username (3–24 characters)" autoCapitalize="none" autoCorrect={false} value={username} onChangeText={value => { setUsername(value); setAuthMessage(''); }} maxLength={24}/>}<TextInput style={styles.input} placeholder="Email address (Gmail is supported)" autoCapitalize="none" keyboardType="email-address" autoComplete="email" value={email} onChangeText={value => { setEmail(value); setAuthMessage(''); }}/><TextInput style={styles.input} placeholder="Password" secureTextEntry autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'} value={password} onChangeText={value => { setPassword(value); setAuthMessage(''); }}/><Pressable style={[styles.action, styles.primary]} onPress={() => void submitAccount()} disabled={busy || !email.trim() || !password || (authMode === 'signup' && !username.trim())}><Text style={styles.actionText}>{busy ? 'Please wait…' : authMode === 'signup' ? 'Sign up' : 'Log in'}</Text></Pressable><Pressable style={styles.textButton} onPress={() => { setAuthMode(current => current === 'login' ? 'signup' : 'login'); setAuthMessage(''); }}><Text style={styles.outlineText}>{authMode === 'signup' ? 'Already have an account? Log in' : 'New here? Create an account'}</Text></Pressable>{!!authMessage && <Text accessibilityRole="alert" style={{ color: authMessage.startsWith('Account created') ? '#15803D' : '#B91C1C', fontSize: 12, lineHeight: 18 }}>{authMessage}</Text>}<View style={styles.chatJoinDivider}><View style={styles.chatDividerLine}/><Text style={styles.muted}>OR CHAT AS A GUEST</Text><View style={styles.chatDividerLine}/></View><TextInput style={styles.input} placeholder="Chat display name" autoCapitalize="words" value={guestName} onChangeText={value => { setGuestName(value); setGuestError(''); }} maxLength={40}/><Pressable style={[styles.action, styles.guestAction]} disabled={busy || !guestName.trim()} onPress={() => void joinGuestChat()}><Text style={styles.guestActionText}>{busy ? 'Please wait…' : 'Join office chat'}</Text></Pressable>{!!guestError && <Text accessibilityRole="alert" style={{ color: '#B91C1C', fontSize: 12, lineHeight: 18 }}>{guestError}</Text>}<Pressable style={styles.textButton} onPress={onContinue}><Text style={styles.muted}>Continue in offline mode</Text></Pressable></View></KeyboardAvoidingView></SafeAreaView>;
}

type MemoryTile = { id: number; pairKey: string; symbol?: string; faceSource?: ImageSourcePropType; matched: boolean };
const gameFaceImages: ImageSourcePropType[] = [
  require('./assets/game-faces/face-01.jpeg'), require('./assets/game-faces/face-02.jpeg'),
  require('./assets/game-faces/face-03.jpeg'), require('./assets/game-faces/face-04.jpeg'),
  require('./assets/game-faces/face-05.jpg'), require('./assets/game-faces/face-06.jpg'),
  require('./assets/game-faces/face-07.jpeg'),
];
const memoryAnimals = ['🐼', '🦊', '🐸', '🐳', '🦁', '🐵', '🐧', '🐢', '🐨', '🦉', '🐰', '🦒', '🦋', '🐙', '🦓', '🐝', '🐬'];
function newMemoryDeck(pairCount: number): MemoryTile[] {
  const pairs = [
    ...gameFaceImages.map((faceSource, index) => ({ pairKey: `face-${index}`, faceSource })),
    ...memoryAnimals.map(symbol => ({ pairKey: `animal-${symbol}`, symbol })),
  ].slice(0, pairCount);
  const deck = pairs.flatMap((pair, index) => [
    { ...pair, id: index * 2, matched: false }, { ...pair, id: index * 2 + 1, matched: false },
  ]);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function MemoryMatchGame() {
  const [pairCount, setPairCount] = useState(8);
  const [tiles, setTiles] = useState<MemoryTile[]>(() => newMemoryDeck(8));
  const [opened, setOpened] = useState<number[]>([]);
  const [scores, setScores] = useState<[number, number]>([0, 0]);
  const [turn, setTurn] = useState<0 | 1>(0);
  const [names, setNames] = useState<[string, string]>(['Player 1', 'Player 2']);
  const locked = useRef(false);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finished = tiles.every(tile => tile.matched);
  const winner = scores[0] === scores[1] ? null : scores[0] > scores[1] ? 0 : 1;

  useEffect(() => () => { if (timeout.current) clearTimeout(timeout.current); }, []);

  function resetGame() {
    if (timeout.current) clearTimeout(timeout.current);
    locked.current = false;
    setTiles(newMemoryDeck(pairCount)); setOpened([]); setScores([0, 0]); setTurn(0);
  }

  function choosePairCount(count: number) {
    if (timeout.current) clearTimeout(timeout.current);
    locked.current = false;
    setPairCount(count); setTiles(newMemoryDeck(count)); setOpened([]); setScores([0, 0]); setTurn(0);
  }

  function reveal(index: number) {
    if (locked.current || tiles[index].matched || opened.includes(index)) return;
    const nextOpened = [...opened, index];
    setOpened(nextOpened);
    if (nextOpened.length === 1) return;

    locked.current = true;
    const firstIndex = nextOpened[0];
    if (tiles[firstIndex].pairKey === tiles[index].pairKey) {
      const nextTiles = tiles.map((tile, tileIndex) => tileIndex === firstIndex || tileIndex === index ? { ...tile, matched: true } : tile);
      setTiles(nextTiles); setScores(current => current.map((score, player) => player === turn ? score + 1 : score) as [number, number]);
      setOpened([]); locked.current = false;
    } else {
      timeout.current = setTimeout(() => {
        setOpened([]); setTurn(current => current === 0 ? 1 : 0); locked.current = false; timeout.current = null;
      }, 850);
    }
  }

  const winnerText = winner === null ? 'It’s a tie!' : `${names[winner].trim() || `Player ${winner + 1}`} wins!`;
  return <View style={styles.gameCard}>
    <View style={styles.gameHeader}><View style={{ flex: 1 }}><Text style={styles.gameEyebrow}>QUICK BREAK</Text><Text style={styles.gameTitle}>Memory Match</Text></View><Text style={styles.gameIcon}>🧠</Text></View>
    <Text style={styles.gameDescription}>Match the same team face or animal twice. A match scores a point and keeps your turn; a miss passes the turn. Most pairs wins.</Text>
    <View style={styles.difficultyRow}><Text style={styles.difficultyLabel}>Board size</Text>{[8, 16, 24].map(count => <Pressable key={count} onPress={() => choosePairCount(count)} style={[styles.difficultyButton, pairCount === count && styles.difficultySelected]}><Text style={[styles.difficultyText, pairCount === count && styles.difficultyTextSelected]}>{count} pairs</Text></Pressable>)}</View>
    <View style={styles.playerRow}>{([0, 1] as const).map(player => <View key={player} style={[styles.playerCard, turn === player && !finished && styles.playerTurn]}>
      <TextInput accessibilityLabel={`Player ${player + 1} name`} style={styles.playerName} value={names[player]} onChangeText={value => setNames(current => current.map((name, index) => index === player ? value : name) as [string, string])} maxLength={16} />
      <Text style={styles.playerScore}>{scores[player]}</Text><Text style={styles.playerPairs}>pairs</Text>
    </View>)}</View>
    <Text style={styles.turnLabel}>{finished ? winnerText : `${names[turn].trim() || `Player ${turn + 1}`}’s turn`}</Text>
    <View style={styles.memoryBoard}>{Array.from({ length: Math.ceil(tiles.length / 4) }, (_, row) => <View key={row} style={styles.memoryRow}>{tiles.slice(row * 4, row * 4 + 4).map((tile, column) => {
      const index = row * 4 + column; const faceUp = tile.matched || opened.includes(index);
      return <Pressable key={tile.id} accessibilityRole="button" accessibilityLabel={faceUp ? `Tile ${tile.symbol ? `animal ${tile.symbol}` : 'face'}` : 'Hidden tile'} onPress={() => reveal(index)} style={[styles.memoryTile, faceUp && styles.memoryTileOpen, tile.matched && styles.memoryTileMatched]}>
        {faceUp && tile.faceSource ? <Image source={tile.faceSource} style={styles.memoryFaceImage} resizeMode="cover" /> : <Text style={[styles.memoryTileText, !faceUp && styles.memoryTileHidden]}>{faceUp ? tile.symbol : '?'}</Text>}
      </Pressable>;
    })}</View>)}</View>
    <View style={styles.gameFooter}><Text style={styles.gameHint}>{finished ? 'Play another round and see who takes the lead.' : `${tiles.filter(tile => tile.matched).length / 2} of ${pairCount} pairs found`}</Text><Pressable style={styles.newGameButton} onPress={resetGame}><Text style={styles.newGameText}>{finished ? 'Play again' : 'New game'}</Text></Pressable></View>
  </View>;
}

type PunchTimeDraft = { punchIn: string; punchOut: string; breakHours: string; breakMinutes: string };

function WorkTimeCalculator({ targetMinutes }: { targetMinutes: number }) {
  const [punchIn, setPunchIn] = useState('');
  const [punchOut, setPunchOut] = useState('');
  const [breakHours, setBreakHours] = useState('');
  const [breakMinutesInput, setBreakMinutesInput] = useState('');
  const [calculated, setCalculated] = useState(false);
  const validClock = (value: string) => /^(0?[1-9]|1[0-2]):[0-5]\d\s*(AM|PM)$/i.test(value.trim());
  const validBreakField = (value: string, max: number) => value === '' || (/^\d{1,2}$/.test(value) && Number(value) <= max);
  const complete = validClock(punchIn) && validClock(punchOut)
    && validBreakField(breakHours, 23) && validBreakField(breakMinutesInput, 59);
  const toMinutes = (value: string) => {
    const [, rawHour, rawMinute, meridiem] = value.trim().match(/^(0?[1-9]|1[0-2]):([0-5]\d)\s*(AM|PM)$/i)!;
    return (Number(rawHour) % 12 + (meridiem.toUpperCase() === 'PM' ? 12 : 0)) * 60 + Number(rawMinute);
  };
  const span = complete ? (toMinutes(punchOut) - toMinutes(punchIn) + 1440) % 1440 : 0;
  const breakMinutes = Number(breakHours || 0) * 60 + Number(breakMinutesInput || 0);
  const valid = complete && span > 0 && breakMinutes <= span;
  const workedMinutes = valid ? span - breakMinutes : 0;
  const difference = workedMinutes - targetMinutes;
  return <View style={styles.card}>
    <Text style={styles.sectionTitle}>Work-hours calculator</Text>
    <Text style={styles.muted}>Enter your punch times and total break to check your net work hours.</Text>
    <View style={styles.calcFields}>
      <View style={styles.calcField}><Text style={styles.rowLabel}>Punch in</Text><TextInput accessibilityLabel="Calculator punch-in time" style={styles.input} value={punchIn} onChangeText={value => { setPunchIn(value); setCalculated(false); }} placeholder="HH:MM AM/PM" keyboardType="default" autoCapitalize="characters" maxLength={8}/></View>
      <View style={styles.calcField}><Text style={styles.rowLabel}>Punch out</Text><TextInput accessibilityLabel="Calculator punch-out time" style={styles.input} value={punchOut} onChangeText={value => { setPunchOut(value); setCalculated(false); }} placeholder="HH:MM AM/PM" keyboardType="default" autoCapitalize="characters" maxLength={8}/></View>
      <View style={styles.calcField}><Text style={styles.rowLabel}>Break hours</Text><TextInput accessibilityLabel="Taken break hours" style={styles.input} value={breakHours} onChangeText={value => { setBreakHours(value.replace(/\D/g, '').slice(0, 2)); setCalculated(false); }} placeholder="0" keyboardType="number-pad" maxLength={2}/></View>
      <View style={styles.calcField}><Text style={styles.rowLabel}>Break minutes</Text><TextInput accessibilityLabel="Taken break minutes" style={styles.input} value={breakMinutesInput} onChangeText={value => { setBreakMinutesInput(value.replace(/\D/g, '').slice(0, 2)); setCalculated(false); }} placeholder="0" keyboardType="number-pad" maxLength={2}/></View>
    </View>
    <Pressable accessibilityRole="button" style={[styles.action, styles.primary, styles.calcButton]} onPress={() => setCalculated(true)}><Text style={styles.actionText}>Calculate work hours</Text></Pressable>
    {calculated && valid
      ? <View style={styles.calcResult}><Text style={styles.calcWorked}>{formatDuration(workedMinutes)} net work</Text><Text style={[styles.calcStatus, difference >= 0 ? styles.calcMet : styles.calcPending]}>{difference >= 0 ? `${formatDuration(targetMinutes)} target met${difference ? ` · ${formatDuration(difference)} extra` : ''}` : `${formatDuration(targetMinutes - workedMinutes)} more to reach ${formatDuration(targetMinutes)}`}</Text></View>
      : <Text style={styles.calcHint}>{calculated ? 'Check the time format and break duration. Break minutes must be 0–59 and break time must fit within the shift.' : 'Enter both times and any break hours/minutes, then tap Calculate.'}</Text>}
  </View>;
}

function toLocalClock(value: string | null) {
  return value ? new Date(value).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : '';
}

function fromLocalClock(date: string, time: string) {
  const [year, month, day] = date.split('-').map(Number);
  const match = time.trim().match(/^(0?[1-9]|1[0-2]):([0-5]\d)\s*(AM|PM)$/i);
  if (!match) throw new Error('Enter time in h:mm AM/PM format.');
  const [, rawHour, rawMinute, meridiem] = match;
  const hour = (Number(rawHour) % 12) + (meridiem.toUpperCase() === 'PM' ? 12 : 0);
  return new Date(year, month - 1, day, hour, Number(rawMinute), 0, 0).toISOString();
}

function shiftClock(time: string, delta: number) {
  const match = time.trim().match(/^(0?[1-9]|1[0-2]):([0-5]\d)\s*(AM|PM)$/i);
  if (!match) return time;
  const hour = Number(match[1]) % 12 + (match[3].toUpperCase() === 'PM' ? 12 : 0);
  const total = ((hour * 60 + Number(match[2]) + delta) % 1440 + 1440) % 1440;
  const hour24 = Math.floor(total / 60);
  return `${hour24 % 12 || 12}:${String(total % 60).padStart(2, '0')} ${hour24 < 12 ? 'AM' : 'PM'}`;
}

function PunchCorrectionModal({ date: initialDate, day, addToExisting, onClose, onSave }: {
  date: string; day?: AttendanceDay; addToExisting: boolean; onClose: () => void;
  onSave: (date: string, sessions: AttendanceSession[], addToExisting: boolean) => Promise<void>;
}) {
  const [date, setDate] = useState(initialDate);
  const [rows, setRows] = useState<PunchTimeDraft[]>(() => {
    const existing = addToExisting ? [] : getDaySessions(day ?? { date: initialDate, punchInAt: null, punchOutAt: null, breakMinutes: DEFAULT_POLICY.defaultBreakMinutes, managerApproval: false });
    return existing.length ? existing.map(session => ({ punchIn: toLocalClock(session.punchInAt), punchOut: toLocalClock(session.punchOutAt), breakHours: session.breakMinutes ? String(Math.floor(session.breakMinutes / 60)) : '', breakMinutes: session.breakMinutes ? String(session.breakMinutes % 60) : '' })) : [{ punchIn: '', punchOut: '', breakHours: '', breakMinutes: '' }];
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  function updateRow(index: number, field: keyof PunchTimeDraft, value: string) {
    setRows(current => current.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row));
    setError('');
  }
  async function save() {
    setError('');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || localDateKey(new Date(`${date}T12:00:00`)) !== date) {
      setError('Enter a valid date in YYYY-MM-DD format.'); return;
    }
    const entered = rows.filter(row => row.punchIn || row.punchOut);
    if (!entered.length) { setError('Enter at least one missed punch session.'); return; }
    const timePattern = /^(0?[1-9]|1[0-2]):[0-5]\d\s*(AM|PM)$/i;
    const sessions: AttendanceSession[] = [];
    for (const row of entered) {
      if (!timePattern.test(row.punchIn.trim())) { setError('Enter punch-in time in HH:MM AM/PM format.'); return; }
      if (row.punchOut && !timePattern.test(row.punchOut.trim())) { setError('Enter punch-out time in HH:MM AM/PM format.'); return; }
      const punchInAt = fromLocalClock(date, row.punchIn);
      const punchOutAt = row.punchOut ? fromLocalClock(date, row.punchOut) : null;
      if (punchOutAt && new Date(punchOutAt) <= new Date(punchInAt)) { setError('Punch-out must be later than punch-in.'); return; }
      const breakHours = row.breakHours === '' ? 0 : Number(row.breakHours);
      const breakMinutes = row.breakMinutes === '' ? 0 : Number(row.breakMinutes);
      if (!/^\d{0,2}$/.test(row.breakHours) || breakHours > 23 || !/^\d{0,2}$/.test(row.breakMinutes) || breakMinutes > 59) { setError('Enter break as hours and minutes. Minutes must be from 0 to 59.'); return; }
      const totalBreakMinutes = breakHours * 60 + breakMinutes;
      const sessionEnd = punchOutAt ? new Date(punchOutAt) : new Date();
      const sessionDurationMinutes = Math.max(0, Math.floor((sessionEnd.getTime() - new Date(punchInAt).getTime()) / 60_000));
      if (totalBreakMinutes > sessionDurationMinutes) { setError('A session’s break cannot be longer than that session.'); return; }
      sessions.push({ punchInAt, punchOutAt, ...(totalBreakMinutes ? { breakMinutes: totalBreakMinutes } : {}) });
    }
    sessions.sort((a, b) => a.punchInAt.localeCompare(b.punchInAt));
    for (let index = 0; index < sessions.length; index++) {
      if (!sessions[index].punchOutAt && (date !== localDateKey() || index !== sessions.length - 1)) {
        setError('Only the final session today can have an empty punch-out.'); return;
      }
      const currentEnd = sessions[index].punchOutAt;
      if (index < sessions.length - 1 && (!currentEnd || new Date(currentEnd) > new Date(sessions[index + 1].punchInAt))) {
        setError('Punch sessions cannot overlap. Check the times and try again.'); return;
      }
    }
    setSaving(true);
    try {
      await onSave(date, sessions, addToExisting);
      onClose();
      if (addToExisting) Alert.alert('Missed punches saved', `Attendance for ${date} was updated with ${sessions.length} session${sessions.length === 1 ? '' : 's'}.`);
    }
    catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Could not save corrected punches.'); }
    finally { setSaving(false); }
  }
  const field = (index: number, kind: 'punchIn' | 'punchOut', label: string) => <View style={{ flex: 1, gap: 5 }}><Text style={styles.rowLabel}>{label}</Text><View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Pressable accessibilityLabel={`Subtract 15 minutes from ${label}`} onPress={() => updateRow(index, kind, shiftClock(rows[index][kind], -15))} style={{ paddingHorizontal: 5, paddingVertical: 9 }}><Text style={styles.link}>−15</Text></Pressable><TextInput accessibilityLabel={`${label} time`} style={[styles.input, { flex: 1, minWidth: 60, padding: 9, textAlign: 'center' }]} value={rows[index][kind]} onChangeText={value => updateRow(index, kind, value.toUpperCase())} placeholder="HH:MM AM/PM" keyboardType="default" autoCapitalize="characters" maxLength={8}/><Pressable accessibilityLabel={`Add 15 minutes to ${label}`} onPress={() => updateRow(index, kind, shiftClock(rows[index][kind], 15))} style={{ paddingHorizontal: 5, paddingVertical: 9 }}><Text style={styles.link}>+15</Text></Pressable></View></View>;
  return <Modal visible transparent animationType="fade" onRequestClose={onClose}>
    <View style={styles.correctionOverlay}>
      <View style={styles.correctionModal}>
        <View style={styles.cardHeading}>
          <Text style={styles.sectionTitle}>{addToExisting ? 'Add missed punches' : 'Correct punch times'}</Text>
          <Pressable accessibilityRole="button" onPress={onClose}><Text style={styles.link}>Close</Text></Pressable>
        </View>
        <ScrollView style={styles.correctionScroll} contentContainerStyle={styles.correctionContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.muted}>Enter local times like 9:00 AM or 2:30 PM. Add optional break hours and minutes to a session; that time is deducted from its net work.</Text>
          {addToExisting
            ? <TextInput accessibilityLabel="Attendance date" style={styles.input} value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" />
            : <Text style={styles.historySub}>Date: {date}</Text>}
          {rows.map((row, index) => <View key={index} style={styles.correctionRow}>
            <View style={styles.cardHeading}>
              <Text style={styles.historyTitle}>Session {index + 1}</Text>
              {rows.length > 1 && <Pressable accessibilityRole="button" onPress={() => setRows(current => current.filter((_, rowIndex) => rowIndex !== index))}><Text style={styles.clearDanger}>Remove</Text></Pressable>}
            </View>
            <View style={styles.correctionFields}>{field(index, 'punchIn', 'Punch in')}{field(index, 'punchOut', 'Punch out')}</View>
            <View style={styles.sessionBreakEditor}><Text style={styles.rowLabel}>Break during this session · optional</Text><View style={styles.sessionBreakFields}><View style={styles.sessionBreakField}><Text style={styles.historySub}>Hours</Text><TextInput accessibilityLabel={`Session ${index + 1} break hours`} style={styles.input} value={row.breakHours} onChangeText={value => updateRow(index, 'breakHours', value.replace(/\D/g, '').slice(0, 2))} placeholder="0" keyboardType="number-pad" maxLength={2}/></View><View style={styles.sessionBreakField}><Text style={styles.historySub}>Minutes</Text><TextInput accessibilityLabel={`Session ${index + 1} break minutes`} style={styles.input} value={row.breakMinutes} onChangeText={value => updateRow(index, 'breakMinutes', value.replace(/\D/g, '').slice(0, 2))} placeholder="0" keyboardType="number-pad" maxLength={2}/></View></View></View>
          </View>)}
          <Pressable style={styles.outlineButton} onPress={() => setRows(current => [...current, { punchIn: '', punchOut: '', breakHours: '', breakMinutes: '' }])}><Text style={styles.outlineText}>＋ Add missed session</Text></Pressable>
          {!!error && <Text accessibilityRole="alert" style={{ color: '#B91C1C', fontSize: 12, lineHeight: 18 }}>{error}</Text>}
        </ScrollView>
        <View style={styles.correctionFooter}>
          <Pressable accessibilityRole="button" disabled={saving} style={[styles.action, styles.primary, styles.correctionSave, saving && styles.dim]} onPress={() => void save()}><Text style={styles.actionText}>{saving ? 'Saving…' : 'Save corrected punches'}</Text></Pressable>
        </View>
      </View>
    </View>
  </Modal>;
}

function History({ days, policy, onClear, onCorrect, onAddMissed }: { days: AttendanceDay[]; policy: PolicyConfig; onClear: (date: string) => Promise<void>; onCorrect: (date: string) => void; onAddMissed: (date: string) => void }) {
  const [month, setMonth] = useState(localDateKey().slice(0, 7));
  const [expandedDates, setExpandedDates] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  const rows = days.filter(d => d.date.startsWith(month));
  const lateDates = rows.filter(d => d.punchInAt && getAttendanceSummary(d, new Date(d.punchInAt), policy).afterFlexLimit)
    .map(d => d.date).sort();
  const halfDayDates = new Set(lateDates.slice(MONTHLY_LATE_LOGIN_LIMIT - 1));
  const total = rows.reduce((sum, d) => sum + getAttendanceSummary(d, d.punchOutAt ? new Date(d.punchOutAt) : new Date(), policy).netWorkedMinutes, 0);
  function shiftMonth(delta: number) { const date = new Date(`${month}-01T12:00:00`); date.setMonth(date.getMonth() + delta); setMonth(localDateKey(date).slice(0, 7)); }
  const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char));
  async function exportPdf() {
    if (!rows.length) { Alert.alert('Nothing to export', 'There are no attendance records for this month yet.'); return; }
    setExporting(true);
    try {
      const reportRows = [...rows].sort((a, b) => a.date.localeCompare(b.date)).map(d => {
        const sessions = getDaySessions(d);
        const summary = getAttendanceSummary(d, d.punchOutAt ? new Date(d.punchOutAt) : new Date(), policy);
        const punches = sessions.map((session, index) => { const end = session.punchOutAt ?? d.officeOutAt ?? new Date().toISOString(); const gross = Math.max(0, Math.floor((new Date(end).getTime() - new Date(session.punchInAt).getTime()) / 60000)); const sessionBreak = Math.min(gross, session.breakMinutes ?? 0); return `<div class="session">Session ${index + 1}: ${escapeHtml(clock(session.punchInAt))} → ${session.punchOutAt ? escapeHtml(clock(session.punchOutAt)) : 'In progress'} · ${escapeHtml(formatDuration(gross - sessionBreak))} work${sessionBreak ? ` · ${escapeHtml(formatDuration(sessionBreak))} break` : ''}</div>`; }).join('');
        return `<tr><td>${escapeHtml(d.date)}</td><td>${punches || '—'}</td><td>${escapeHtml(formatDuration(summary.takenBreakMinutes))}</td><td><strong>${escapeHtml(formatDuration(summary.netWorkedMinutes))}</strong></td><td>${halfDayDates.has(d.date) ? 'Half-day applied' : escapeHtml(summary.loginStatus)}</td></tr>`;
      }).join('');
      const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:-apple-system,BlinkMacSystemFont,Arial,sans-serif;color:#172033;padding:28px}h1{font-size:24px;margin:0 0 6px}.meta{color:#64748b;margin:0 0 22px}.summary{display:flex;gap:32px;background:#eff6ff;padding:14px 18px;border-radius:10px;margin-bottom:20px}.summary strong{display:block;font-size:18px;margin-top:4px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:left;vertical-align:top;padding:10px 8px;border-bottom:1px solid #e2e8f0}th{background:#f8fafc}.session{margin-bottom:5px}.foot{margin-top:20px;color:#64748b;font-size:10px}@media print{body{padding:0}tr{break-inside:avoid}}</style></head><body><h1>Attendance report</h1><p class="meta">${escapeHtml(monthName(month))} · Generated ${escapeHtml(new Date().toLocaleString())}</p><div class="summary"><div>Days recorded<strong>${rows.length}</strong></div><div>Net work hours<strong>${escapeHtml(formatDuration(total))}</strong></div><div>Late logins<strong>${lateDates.length}</strong></div></div><table><thead><tr><th>Date</th><th>Punch history</th><th>Break taken</th><th>Worked</th><th>Status</th></tr></thead><tbody>${reportRows}</tbody></table><p class="foot">Only punch-in sessions count as net work. Time between punch-out and the next punch-in is reported as break time.</p></body></html>`;
      if (Platform.OS === 'web') await Print.printAsync({ html });
      else {
        const file = await Print.printToFileAsync({ html });
        if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: `Attendance ${monthName(month)}` });
        else await Print.printAsync({ html });
      }
    } catch { Alert.alert('Export failed', 'The attendance PDF could not be created. Please try again.'); }
    finally { setExporting(false); }
  }
  return <><View style={styles.monthBar}><Pressable onPress={() => shiftMonth(-1)}><Text style={styles.monthArrow}>‹</Text></Pressable><Text style={styles.monthTitle}>{monthName(month)}</Text><Pressable onPress={() => shiftMonth(1)}><Text style={styles.monthArrow}>›</Text></Pressable></View><Pressable accessibilityRole="button" onPress={() => onAddMissed(`${month}-01`)} style={styles.outlineButton}><Text style={styles.outlineText}>＋ Add missed attendance</Text></Pressable><Pressable accessibilityRole="button" disabled={exporting || !rows.length} onPress={() => void exportPdf()} style={[styles.exportButton, (!rows.length || exporting) && styles.exportDisabled]}><Text style={styles.exportButtonText}>{exporting ? 'Preparing PDF…' : 'Export month as PDF'}</Text></Pressable><View style={styles.summaryStrip}><View><Text style={styles.statLabel}>DAYS RECORDED</Text><Text style={styles.monthStat}>{rows.length}</Text></View><View><Text style={styles.statLabel}>WORK HOURS</Text><Text style={styles.monthStat}>{formatDuration(total)}</Text></View><View><Text style={styles.statLabel}>LATE LOGINS</Text><Text style={styles.monthStat}>{lateDates.length}</Text></View></View>{rows.length ? [...rows].sort((a, b) => b.date.localeCompare(a.date)).map(d => { const s = getAttendanceSummary(d, d.punchOutAt ? new Date(d.punchOutAt) : new Date(), policy); const daySessions = getDaySessions(d); const lastSession = daySessions[daySessions.length - 1]; const expanded = expandedDates.includes(d.date); return <View key={d.date} style={styles.historyDayCard}><View style={styles.historyRow}><View style={styles.historyDate}><Text style={styles.historyDay}>{new Date(`${d.date}T12:00:00`).toLocaleDateString([], { weekday: 'short' })}</Text><Text style={styles.historyNum}>{new Date(`${d.date}T12:00:00`).getDate()}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={`${expanded ? 'Hide' : 'Show'} punches for ${d.date}`} onPress={() => setExpandedDates(current => expanded ? current.filter(date => date !== d.date) : [...current, d.date])} style={styles.historyMain}><Text style={styles.historyTitle}>{clock(daySessions[0]?.punchInAt ?? null)} — {lastSession?.punchOutAt ? clock(lastSession.punchOutAt) : 'In progress'}</Text><Text style={styles.historySub}>{halfDayDates.has(d.date) ? 'Half-day applied · ' : ''}{s.loginStatus} · {daySessions.length} session{daySessions.length === 1 ? '' : 's'} · Break {formatDuration(s.takenBreakMinutes)} · {d.synced === false ? 'Waiting to sync' : 'Saved'}</Text><Text style={styles.sessionToggle}>{expanded ? 'Hide punch details' : 'View punch details'}</Text></Pressable><Text style={styles.historyHours}>{formatDuration(s.netWorkedMinutes)}</Text><ClearDayControl date={d.date} onClear={onClear} compact /></View>{expanded && <View style={styles.sessionList}>{daySessions.map((session, index) => { const end = session.punchOutAt ? new Date(session.punchOutAt) : new Date(); const elapsed = Math.max(0, Math.floor((end.getTime() - new Date(session.punchInAt).getTime()) / 60000)); const sessionBreak = Math.min(elapsed, session.breakMinutes ?? 0); return <View key={`${session.punchInAt}-${index}`} style={styles.sessionEntry}><Text style={styles.sessionLabel}>Session {index + 1}</Text><Text style={styles.sessionTime}>{clock(session.punchInAt)} → {session.punchOutAt ? clock(session.punchOutAt) : 'In progress'}</Text><Text style={styles.sessionDuration}>{formatDuration(elapsed - sessionBreak)} work{sessionBreak ? ` · ${formatDuration(sessionBreak)} break` : ''}</Text></View>; })}<Pressable style={styles.outlineButton} onPress={() => onCorrect(d.date)}><Text style={styles.outlineText}>Correct punch times</Text></Pressable></View>}</View>; }) : <View style={styles.empty}><Text style={styles.emptyTitle}>No attendance yet</Text><Text style={styles.muted}>Punch in to start a record for {monthName(month)}.</Text></View>}</>;
}

function ClearDayControl({ date, onClear, compact = false }: { date: string; onClear: (date: string) => Promise<void>; compact?: boolean }) {
  const [confirm, setConfirm] = useState(false);
  return <View style={compact ? styles.clearCompact : styles.clearCard}>
    {confirm ? <><Text style={styles.clearText}>Clear all punches and hours for {date}?</Text><View style={styles.clearActions}><Pressable onPress={() => setConfirm(false)}><Text style={styles.link}>Cancel</Text></Pressable><Pressable onPress={() => void onClear(date).then(() => setConfirm(false))}><Text style={styles.clearDanger}>Clear day</Text></Pressable></View></> : <Pressable onPress={() => setConfirm(true)}><Text style={styles.clearDanger}>{compact ? 'Clear' : 'Clear today’s data'}</Text></Pressable>}
  </View>;
}

function OfficeOutSummaryModal({ day, policy, onClose, onUndo }: { day: AttendanceDay; policy: PolicyConfig; onClose: () => void; onUndo: () => void }) {
  const sessions = getDaySessions(day);
  const finishedAt = day.officeOutAt ? new Date(day.officeOutAt) : new Date();
  const summary = getAttendanceSummary(day, finishedAt, policy);
  const intervalMinutes = (from: string, to: string) => Math.max(0, Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 60_000));
  return <Modal visible transparent animationType="fade" onRequestClose={onClose}>
    <View style={styles.mediaOverlay}><View style={styles.officeSummaryModal}>
      <View style={styles.cardHeading}><View><Text style={styles.sectionTitle}>Office out summary</Text><Text style={styles.muted}>Finished at {clock(day.officeOutAt ?? null)}</Text></View><Pressable onPress={onClose}><Text style={styles.link}>Close</Text></Pressable></View>
      <View style={styles.officeSummaryTotals}><View style={{ flex: 1 }}><Text style={styles.statLabel}>NET WORKED</Text><Text style={styles.officeSummaryWork}>{formatDuration(summary.netWorkedMinutes)}</Text></View><View style={{ flex: 1 }}><Text style={styles.statLabel}>BREAK TAKEN</Text><Text style={styles.officeSummaryBreak}>{formatDuration(summary.takenBreakMinutes)}</Text></View></View>
      <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ gap: 8 }}>
        {sessions.map((item, index) => {
          const grossMinutes = intervalMinutes(item.punchInAt, item.punchOutAt ?? day.officeOutAt ?? new Date().toISOString());
          const sessionBreakMinutes = Math.min(grossMinutes, item.breakMinutes ?? 0);
          return <React.Fragment key={`${item.punchInAt}-${index}`}>
          <View style={styles.officeSummaryRow}><Text style={styles.sessionLabel}>WORK {index + 1}</Text><View style={{ flex: 1 }}><Text style={styles.officeSummaryText}>{clock(item.punchInAt)} → {clock(item.punchOutAt)}</Text><Text style={styles.historySub}>{formatDuration(grossMinutes - sessionBreakMinutes)} net work{sessionBreakMinutes ? ` · ${formatDuration(sessionBreakMinutes)} break` : ''}</Text></View></View>
          {!!item.punchOutAt && (() => {
            const breakEnd = sessions[index + 1]?.punchInAt ?? day.officeOutAt;
            if (!breakEnd) return null;
            return <View style={styles.officeSummaryRow}><Text style={[styles.sessionLabel, { color: '#B91C1C' }]}>BREAK {index + 1}</Text><View style={{ flex: 1 }}><Text style={[styles.officeSummaryText, { color: '#B91C1C' }]}>{clock(item.punchOutAt)} → {clock(breakEnd)}</Text><Text style={styles.historySub}>{formatDuration(intervalMinutes(item.punchOutAt!, breakEnd))} taken</Text></View></View>;
          })()}
        </React.Fragment>;
        })}
      </ScrollView>
      <View style={{ flexDirection: 'row', gap: 9 }}><Pressable style={[styles.outlineButton, { flex: 1 }]} onPress={onUndo}><Text style={styles.outlineText}>Undo Office out</Text></Pressable><Pressable style={[styles.action, styles.primary]} onPress={onClose}><Text style={styles.actionText}>Done</Text></Pressable></View>
    </View></View>
  </Modal>;
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
  safe: { flex: 1, backgroundColor: colors.background }, ambienceLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden', zIndex: 0 }, correctionOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.58)', alignItems: 'center', justifyContent: 'center', padding: 12 }, correctionModal: { width: '100%', maxWidth: 620, height: '92%', maxHeight: 780, backgroundColor: colors.card, borderRadius: 18, padding: 15, gap: 12, overflow: 'hidden' }, correctionScroll: { flex: 1, minHeight: 0 }, correctionContent: { gap: 12, paddingBottom: 8 }, correctionRow: { gap: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 }, correctionFields: { flexDirection: 'row', gap: 8 }, sessionBreakEditor: { gap: 6, backgroundColor: '#F8FAFC', padding: 9, borderRadius: 10 }, sessionBreakFields: { flexDirection: 'row', gap: 8 }, sessionBreakField: { flex: 1, gap: 4 }, correctionFooter: { flexShrink: 0, paddingTop: 2, backgroundColor: colors.card }, correctionSave: { flex: 0, alignSelf: 'stretch', height: 46, justifyContent: 'center' }, passingLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50, overflow: 'hidden' }, fallLayer: { position: 'absolute', top: -36, left: 0, right: 0, bottom: 0, zIndex: 51, overflow: 'hidden' }, spiderThread: { position: 'absolute', top: 0, width: 2, backgroundColor: '#E2E8F0', opacity: 0.95, transformOrigin: 'top center' }, fallingSpider: { position: 'absolute', top: 0 }, passingGif: { position: 'absolute', top: '42%', left: 0 }, ambientGlow: { position: 'absolute', width: 260, height: 260, borderRadius: 140, opacity: 0.16 }, glowBlue: { top: '18%', left: -140, backgroundColor: '#BFDBFE' }, glowMint: { top: '54%', right: -145, backgroundColor: '#A7F3D0' }, floatPaw: { position: 'absolute', fontSize: 21, opacity: 0.15 }, floatPawOne: { top: '26%', left: '12%' }, floatPawTwo: { top: '66%', right: '14%' }, firefly: { position: 'absolute', color: '#F59E0B', fontSize: 23, fontWeight: '900' }, fireflyOne: { top: '38%', right: '23%' }, fireflyTwo: { top: '72%', left: '28%' }, runningPawTrail: { position: 'absolute', left: 0, bottom: 14, fontSize: 22, color: '#60A5FA', opacity: 0.25 }, spiderWeb: { position: 'absolute', width: 142, height: 142, top: -42, right: -42, borderRadius: 100 }, webRing: { position: 'absolute', borderWidth: 1, borderColor: '#60A5FA', borderRadius: 100 }, webRingOuter: { width: 128, height: 128, left: 7, top: 7 }, webRingMiddle: { width: 88, height: 88, left: 27, top: 27 }, webRingInner: { width: 48, height: 48, left: 47, top: 47 }, webSpoke: { position: 'absolute', width: 124, height: 1, top: 70, left: 70, backgroundColor: '#60A5FA' }, webSpider: { position: 'absolute', left: 57, top: 55, fontSize: 18 }, ambientRunner: { position: 'absolute', left: 0, bottom: 13, fontSize: 28, opacity: 0.38 }, page: { width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 38, gap: 16 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  catScene: { height: 88, width: '100%', borderRadius: 18, overflow: 'hidden', backgroundColor: '#DFF4F3', borderWidth: 1, borderColor: '#C5E8E5' }, catSun: { position: 'absolute', right: 24, top: 13, width: 25, height: 25, borderRadius: 20, backgroundColor: '#FDE68A' }, catCloud: { position: 'absolute', right: 56, top: 9, fontSize: 15, opacity: 0.75 }, catTitle: { position: 'absolute', left: 13, top: 12, color: '#0F766E', fontSize: 8, fontWeight: '900', letterSpacing: 1.1 }, catCaption: { position: 'absolute', left: 13, top: 26, color: '#365F66', fontSize: 11, fontWeight: '700' }, catHorizon: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 20, backgroundColor: '#A7D9AC' }, catGrassLeft: { position: 'absolute', left: '30%', bottom: 8, height: 13, width: 55, borderTopLeftRadius: 35, borderTopRightRadius: 20, backgroundColor: '#86C694', transform: [{ rotate: '-5deg' }] }, catGrassRight: { position: 'absolute', right: '8%', bottom: 6, height: 16, width: 70, borderTopLeftRadius: 40, borderTopRightRadius: 25, backgroundColor: '#8BCB9A', transform: [{ rotate: '4deg' }] }, catPaws: { position: 'absolute', left: '42%', bottom: 13, fontSize: 11, letterSpacing: 4 }, walkingCat: { position: 'absolute', left: 0, bottom: 7 }, catEmoji: { fontSize: 31, lineHeight: 37 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 7 }, eyebrow: { color: colors.blue, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 }, title: { color: colors.text, fontSize: 30, fontWeight: '800', marginTop: 4 }, subtitle: { color: colors.muted, fontSize: 14, marginTop: 4, lineHeight: 20 }, avatar: { width: 48, height: 48, borderRadius: 16, backgroundColor: '#DBEAFE', alignItems: 'center', justifyContent: 'center' }, avatarLarge: { width: 56, height: 56, borderRadius: 18, backgroundColor: '#DBEAFE', alignItems: 'center', justifyContent: 'center', alignSelf: 'center' }, avatarText: { color: colors.blue, fontWeight: '800', fontSize: 17 },
  connection: { backgroundColor: '#F0FDF4', padding: 11, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }, offline: { backgroundColor: '#FFFBEB' }, dot: { width: 7, height: 7, borderRadius: 5 }, connectionText: { fontSize: 11, color: colors.muted, flex: 1 }, link: { color: colors.blue, fontWeight: '700', fontSize: 12 }, tabs: { flexDirection: 'row', gap: 8, backgroundColor: '#E9EEF5', padding: 4, borderRadius: 14 }, tab: { flex: 1, paddingVertical: 10, borderRadius: 11, alignItems: 'center' }, tabActive: { backgroundColor: '#FFFFFF', elevation: 1 }, tabText: { fontSize: 13, fontWeight: '700', color: colors.muted }, tabTextActive: { color: colors.text },
  hero: { position: 'relative', zIndex: 52, overflow: 'hidden', backgroundColor: colors.navy, borderRadius: 25, padding: 22, shadowColor: '#0F172A', shadowOffset: { width: 0, height: 9 }, shadowOpacity: 0.13, shadowRadius: 17, elevation: 3 }, heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }, heroLabel: { color: '#BFDBFE', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 }, timerHero: { color: '#FFF', fontSize: 44, fontWeight: '800', fontVariant: ['tabular-nums'], letterSpacing: 1, marginTop: 5, marginBottom: 5 }, breakTimerCard: { marginTop: 12, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#451A1A', borderRadius: 12, borderWidth: 1, borderColor: '#7F1D1D' }, breakTimerLabel: { color: '#FCA5A5', fontSize: 9, fontWeight: '900', letterSpacing: 1 }, breakTimerValue: { color: '#F87171', fontSize: 23, fontWeight: '900', fontVariant: ['tabular-nums'], marginTop: 3 }, breakTimerHint: { color: '#FECACA', fontSize: 10, marginTop: 2 }, progressBadge: { backgroundColor: '#263A56', paddingVertical: 9, paddingHorizontal: 12, borderRadius: 12 }, progressBadgeText: { color: '#DCEBFF', fontSize: 14, fontWeight: '800' }, progressTrack: { height: 8, backgroundColor: '#334155', borderRadius: 99, overflow: 'hidden', marginTop: 16 }, progressFill: { height: 8, backgroundColor: '#60A5FA', borderRadius: 99 }, progressMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 9 }, heroSmall: { color: '#CBD5E1', fontSize: 11 }, shiftEstimate: { color: '#BFDBFE', fontSize: 11, fontWeight: '700', marginTop: 5 }, buttonRow: { flexDirection: 'row', gap: 10, marginTop: 21 }, action: { flex: 1, borderRadius: 13, paddingVertical: 14, alignItems: 'center' }, primary: { backgroundColor: colors.blue }, teal: { backgroundColor: '#0F766E' }, dim: { opacity: 0.45 }, actionText: { color: '#FFF', fontWeight: '800', fontSize: 14 }, helper: { color: '#CBD5E1', fontSize: 12, marginTop: 12, lineHeight: 18 },
  calcFields: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 }, calcButton: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto', width: '100%', minHeight: 46, marginTop: 2, justifyContent: 'center' }, calcField: { flex: 1, minWidth: 90, gap: 6 }, calcResult: { backgroundColor: '#EFF6FF', borderRadius: 12, padding: 13, gap: 4 }, calcWorked: { color: colors.text, fontSize: 19, fontWeight: '800' }, calcStatus: { fontSize: 12, fontWeight: '700' }, calcMet: { color: '#15803D' }, calcPending: { color: colors.blue }, calcHint: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, statCard: { flexBasis: '47%', flexGrow: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 15, padding: 14, gap: 8 }, statLabel: { color: colors.muted, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 }, statValue: { color: colors.text, fontSize: 16, fontWeight: '800' }, card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 18, padding: 17, gap: 13 }, cardHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '800' }, row: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 }, rowLabel: { color: colors.muted, fontSize: 12, flex: 1 }, rowValue: { color: colors.text, fontSize: 12, fontWeight: '700', textAlign: 'right', flex: 1 }, pill: { backgroundColor: '#DCFCE7', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 99 }, pillWarn: { backgroundColor: '#FEF3C7' }, pillText: { color: '#15803D', fontSize: 10, fontWeight: '800' }, policyNote: { color: '#854D0E', fontSize: 11, lineHeight: 17, backgroundColor: '#FFFBEB', padding: 10, borderRadius: 10 }, outlineButton: { borderWidth: 1, borderColor: '#BFDBFE', borderRadius: 11, padding: 11, alignItems: 'center', backgroundColor: '#F8FBFF' }, outlineText: { color: colors.blue, fontSize: 12, fontWeight: '800' }, muted: { color: colors.muted, fontSize: 12, lineHeight: 18 }, stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, stepActions: { flexDirection: 'row', alignItems: 'center', gap: 10 }, stepButton: { width: 30, height: 30, borderRadius: 10, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' }, stepText: { fontSize: 20, color: colors.text }, stepValue: { minWidth: 64, textAlign: 'center', fontWeight: '800', color: colors.text, fontSize: 12 }, settingChoice: { gap: 8 }, choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, choice: { backgroundColor: '#F1F5F9', paddingVertical: 7, paddingHorizontal: 10, borderRadius: 99 }, choiceSelected: { backgroundColor: '#DBEAFE' }, choiceText: { color: colors.muted, fontSize: 10, fontWeight: '700' }, choiceTextSelected: { color: colors.blue },
  gameCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 22, padding: 18, gap: 15 }, gameHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, gameEyebrow: { color: colors.blue, fontWeight: '800', fontSize: 10, letterSpacing: 1.2 }, gameTitle: { color: colors.text, fontSize: 24, fontWeight: '800', marginTop: 3 }, gameIcon: { fontSize: 34 }, gameDescription: { color: colors.muted, fontSize: 12, lineHeight: 18 }, difficultyRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7 }, difficultyLabel: { color: colors.muted, fontSize: 11, fontWeight: '700', marginRight: 3 }, difficultyButton: { borderRadius: 99, paddingVertical: 7, paddingHorizontal: 10, backgroundColor: '#F1F5F9' }, difficultySelected: { backgroundColor: '#DBEAFE' }, difficultyText: { color: colors.muted, fontSize: 10, fontWeight: '700' }, difficultyTextSelected: { color: colors.blue }, playerRow: { flexDirection: 'row', gap: 10 }, playerCard: { flex: 1, alignItems: 'center', backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: colors.border, borderRadius: 15, padding: 10 }, playerTurn: { borderColor: colors.blue, backgroundColor: '#EFF6FF' }, playerName: { width: '100%', color: colors.text, textAlign: 'center', fontWeight: '700', fontSize: 12, paddingVertical: 4 }, playerScore: { color: colors.blue, fontWeight: '800', fontSize: 25, marginTop: 4 }, playerPairs: { color: colors.muted, fontSize: 10 }, turnLabel: { textAlign: 'center', color: colors.text, fontWeight: '800', fontSize: 14 }, memoryBoard: { width: '100%', maxWidth: 460, alignSelf: 'center', gap: 8 }, memoryRow: { flexDirection: 'row', gap: 8 }, memoryTile: { flex: 1, aspectRatio: 1, borderRadius: 13, borderWidth: 1, borderColor: '#CBD5E1', backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }, memoryFaceImage: { width: '100%', height: '100%' }, memoryTileOpen: { backgroundColor: '#EFF6FF', borderColor: '#93C5FD' }, memoryTileMatched: { backgroundColor: '#DCFCE7', borderColor: '#86EFAC' }, memoryTileText: { fontSize: 29, fontWeight: '800' }, memoryTileHidden: { color: '#BFDBFE', fontSize: 31 }, gameFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, gameHint: { flex: 1, color: colors.muted, fontSize: 11 }, newGameButton: { backgroundColor: colors.blue, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 11 }, newGameText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  exportButton: { backgroundColor: colors.blue, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' }, exportDisabled: { opacity: 0.45 }, exportButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' }, historyDayCard: { backgroundColor: colors.card, borderRadius: 15, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }, sessionToggle: { color: colors.blue, fontSize: 10, fontWeight: '700' }, sessionList: { borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#F8FAFC' }, sessionEntry: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }, sessionLabel: { color: colors.muted, fontSize: 10, fontWeight: '700', width: 58 }, sessionTime: { color: colors.text, fontSize: 11, fontWeight: '700', flex: 1 }, sessionDuration: { color: colors.muted, fontSize: 10 },
  chatJoinDivider: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }, chatDividerLine: { flex: 1, height: 1, backgroundColor: colors.border }, guestAction: { backgroundColor: '#0F766E' }, guestActionText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  heroCatLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }, heroCatImage: { position: 'absolute', width: '100%', height: '100%' }, heroCatShade: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.navy }, heroCatPaw: { position: 'absolute', left: '55%', bottom: '15%', width: 45, height: 88, transformOrigin: 'bottom center' }, heroCatPawArm: { position: 'absolute', left: 15, bottom: 0, width: 15, height: 62, borderRadius: 10, backgroundColor: '#E8953D', borderWidth: 2, borderColor: '#FFD17A' }, heroCatPawPalm: { position: 'absolute', left: 3, top: 8, width: 40, height: 34, borderRadius: 20, backgroundColor: '#E8953D', borderWidth: 2, borderColor: '#FFD17A' }, heroCatToe: { position: 'absolute', top: 2, width: 12, height: 17, borderRadius: 9, backgroundColor: '#E8953D', borderWidth: 1, borderColor: '#FFD17A' }, heroCatToeOne: { left: 5 }, heroCatToeTwo: { left: 17, top: -1 }, heroCatToeThree: { left: 29 }, heroCatBlink: { position: 'absolute', left: '31%', top: '24%', width: '9%', height: '4%', borderRadius: 99, backgroundColor: '#EAA34B', alignItems: 'center', justifyContent: 'center' }, heroCatBlinkLine: { width: '72%', height: 1.5, borderRadius: 2, backgroundColor: '#60351E', transform: [{ rotate: '-5deg' }] }, greetingPill: { backgroundColor: 'rgba(15, 118, 110, 0.92)', paddingVertical: 9, paddingHorizontal: 12, borderRadius: 12 }, greetingPillText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' }, catGreetingCard: { width: '100%', maxWidth: 420, backgroundColor: '#FFFFFF', borderRadius: 26, paddingHorizontal: 24, paddingVertical: 27, alignItems: 'center', gap: 10, borderWidth: 1, borderColor: '#CFECE8' }, catSpeech: { backgroundColor: '#DCFCE7', paddingHorizontal: 18, paddingVertical: 9, borderRadius: 16, borderBottomLeftRadius: 4 }, catSpeechText: { color: '#166534', fontSize: 15, fontWeight: '900' }, catGreetingTitle: { color: colors.text, fontSize: 23, fontWeight: '900', textAlign: 'center' }, catGreetingBody: { color: colors.muted, fontSize: 13, lineHeight: 19, textAlign: 'center', maxWidth: 280 }, actionPrimarySmall: { backgroundColor: colors.blue, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 20, marginTop: 7 }, officeByeRow: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: '#F0FDF4', borderRadius: 13, padding: 10 }, officeOutActions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 }, officeOutButton: { backgroundColor: '#B91C1C', borderRadius: 13, paddingVertical: 12, paddingHorizontal: 9, alignItems: 'center', marginTop: 12 }, officeOutText: { color: '#FFFFFF', fontWeight: '900', fontSize: 12, textAlign: 'center' }, undoOfficeOutButton: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#B91C1C', borderRadius: 13, paddingVertical: 11, paddingHorizontal: 12 }, undoOfficeOutText: { color: '#B91C1C', fontWeight: '800', fontSize: 11 }, officeSummaryModal: { width: '100%', maxWidth: 560, maxHeight: '90%', backgroundColor: colors.card, borderRadius: 18, padding: 16, gap: 13 }, officeSummaryTotals: { flexDirection: 'row', gap: 10, padding: 12, backgroundColor: '#F1F5F9', borderRadius: 12 }, officeSummaryWork: { color: colors.blue, fontSize: 18, fontWeight: '900', marginTop: 5 }, officeSummaryBreak: { color: '#B91C1C', fontSize: 18, fontWeight: '900', marginTop: 5 }, officeSummaryRow: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: '#F8FAFC', borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 10 }, officeSummaryText: { color: colors.text, fontSize: 12, fontWeight: '800' },
  chatCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 22, padding: 16, gap: 13 }, chatHeading: { flexDirection: 'row', alignItems: 'center', gap: 11 }, chatAvatar: { width: 43, height: 43, borderRadius: 15, backgroundColor: '#DBEAFE', alignItems: 'center', justifyContent: 'center' }, chatAvatarText: { color: colors.blue, fontSize: 22, fontWeight: '800' }, chatPresence: { color: colors.muted, fontSize: 10, marginTop: 3 }, onlineBadge: { color: '#15803D', fontSize: 9, fontWeight: '900', backgroundColor: '#DCFCE7', overflow: 'hidden', borderRadius: 99, paddingHorizontal: 8, paddingVertical: 6 }, chatJoin: { gap: 12, paddingVertical: 12 }, chatWelcome: { color: colors.text, fontSize: 17, fontWeight: '800' }, chatIdentity: { borderRadius: 10, backgroundColor: '#F8FAFC', padding: 9 }, chatIdentityText: { color: colors.muted, fontSize: 10, fontWeight: '700' }, chatMessages: { maxHeight: 430, minHeight: 220, backgroundColor: '#F8FAFC', borderRadius: 16 }, chatMessagesContent: { flexGrow: 1, justifyContent: 'flex-end', padding: 12, gap: 9 }, chatEmpty: { flex: 1, minHeight: 190, alignItems: 'center', justifyContent: 'center', gap: 7 }, chatEmptyIcon: { fontSize: 30 }, chatBubble: { maxWidth: '88%', borderRadius: 15, paddingHorizontal: 12, paddingVertical: 9, gap: 5 }, chatBubbleMine: { alignSelf: 'flex-end', backgroundColor: '#DBEAFE', borderBottomRightRadius: 5 }, chatBubbleOther: { alignSelf: 'flex-start', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: 5 }, chatSender: { color: colors.blue, fontSize: 10, fontWeight: '800' }, chatBody: { color: colors.text, fontSize: 13, lineHeight: 19 }, chatTime: { color: colors.muted, fontSize: 9, alignSelf: 'flex-end' }, mediaButton: { minWidth: 185, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 11, padding: 10, backgroundColor: 'rgba(255,255,255,0.75)', borderWidth: 1, borderColor: colors.border }, mediaIcon: { color: colors.blue, fontSize: 19, fontWeight: '800' }, mediaTitle: { color: colors.text, fontSize: 11, fontWeight: '800' }, mediaHint: { color: colors.muted, fontSize: 9, marginTop: 2 }, mediaChevron: { color: colors.blue, fontSize: 21 }, chatComposer: { gap: 9 }, chatTools: { flexDirection: 'row', gap: 8 }, chatTool: { backgroundColor: '#F1F5F9', borderRadius: 10, paddingHorizontal: 11, paddingVertical: 8 }, chatToolText: { color: colors.blue, fontSize: 10, fontWeight: '800' }, recordingTool: { backgroundColor: '#FEE2E2' }, recordingText: { color: '#B91C1C' }, chatInputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 }, chatInput: { flex: 1, maxHeight: 110, minHeight: 43, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: colors.border, borderRadius: 13, paddingHorizontal: 12, paddingVertical: 11, color: colors.text, fontSize: 13 }, sendButton: { width: 43, height: 43, borderRadius: 13, backgroundColor: colors.blue, alignItems: 'center', justifyContent: 'center' }, sendButtonText: { color: '#FFFFFF', fontSize: 24, lineHeight: 28, fontWeight: '800' }, attachmentPreview: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#EFF6FF', borderRadius: 10, padding: 10 }, attachmentText: { color: colors.text, fontSize: 10, fontWeight: '700', flex: 1 }, onceToggle: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 3 }, onceCheckbox: { width: 18, height: 18, borderRadius: 5, borderWidth: 1, borderColor: colors.blue, backgroundColor: '#EFF6FF', textAlign: 'center', overflow: 'hidden', color: colors.blue, fontSize: 12, fontWeight: '900' }, onceText: { color: colors.muted, fontSize: 10, flex: 1 }, mediaOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(15, 23, 42, 0.82)', padding: 18 }, mediaModal: { width: '100%', maxWidth: 620, maxHeight: '90%', backgroundColor: colors.card, borderRadius: 18, padding: 15, gap: 12 }, mediaImage: { width: '100%', height: 420 }, onceFootnote: { color: colors.muted, fontSize: 10, textAlign: 'center' },
  updateOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.58)', alignItems: 'center', justifyContent: 'center', padding: 22 }, updateCard: { width: '100%', maxWidth: 420, backgroundColor: colors.card, borderRadius: 24, padding: 25, gap: 13, borderWidth: 1, borderColor: colors.border, shadowColor: '#0F172A', shadowOpacity: 0.2, shadowRadius: 24, elevation: 8 }, updateBadge: { alignSelf: 'flex-start', backgroundColor: '#DBEAFE', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 6 }, updateBadgeText: { color: colors.blue, fontSize: 10, fontWeight: '900', letterSpacing: 1 }, updateTitle: { color: colors.text, fontSize: 24, lineHeight: 30, fontWeight: '900' }, updateSummary: { color: colors.muted, fontSize: 14, lineHeight: 21 }, updateMeta: { color: colors.muted, fontSize: 11 }, updatePrimary: { backgroundColor: colors.blue, paddingVertical: 14, borderRadius: 13, alignItems: 'center', marginTop: 4 }, updatePrimaryText: { color: '#FFFFFF', fontWeight: '800', fontSize: 13 }, updateLater: { paddingVertical: 9, alignItems: 'center' }, updateLaterText: { color: colors.muted, fontWeight: '700', fontSize: 12 },
  monthBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 }, monthArrow: { fontSize: 28, color: colors.blue, paddingHorizontal: 10 }, monthTitle: { color: colors.text, fontSize: 18, fontWeight: '800' }, summaryStrip: { flexDirection: 'row', justifyContent: 'space-around', backgroundColor: '#EFF6FF', borderRadius: 15, padding: 16 }, monthStat: { color: colors.text, fontSize: 18, fontWeight: '800', marginTop: 5 }, historyRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.card, borderRadius: 15, borderWidth: 1, borderColor: colors.border, padding: 12 }, historyDate: { width: 43, height: 48, borderRadius: 11, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' }, historyDay: { color: colors.blue, fontSize: 9, fontWeight: '700' }, historyNum: { color: colors.text, fontSize: 16, fontWeight: '800' }, historyMain: { flex: 1, gap: 5 }, historyTitle: { color: colors.text, fontSize: 12, fontWeight: '800' }, historySub: { color: colors.muted, fontSize: 10 }, historyHours: { color: colors.text, fontSize: 12, fontWeight: '800' }, clearCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 14, flexDirection: 'row', justifyContent: 'flex-end' }, clearCompact: { alignItems: 'flex-end', gap: 5 }, clearText: { color: colors.text, fontSize: 12, flex: 1 }, clearActions: { flexDirection: 'row', gap: 14, alignItems: 'center' }, clearDanger: { color: '#B91C1C', fontWeight: '800', fontSize: 12 }, empty: { padding: 26, alignItems: 'center', backgroundColor: '#F8FAFC', borderRadius: 15, gap: 6 }, emptyTitle: { color: colors.text, fontWeight: '800', fontSize: 14 }, hrRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, borderTopWidth: 1, borderTopColor: colors.border, gap: 10 }, hrActions: { gap: 9 }, approve: { color: '#15803D', fontWeight: '800', fontSize: 11 }, reject: { color: '#B91C1C', fontWeight: '800', fontSize: 11 },
  footerCard: { backgroundColor: '#EFF6FF', padding: 15, borderRadius: 14, gap: 5 }, footerTitle: { color: '#1D4ED8', fontSize: 12, fontWeight: '800' }, footerText: { color: '#1E40AF', fontSize: 11, lineHeight: 17 }, footer: { color: colors.muted, fontSize: 10, textAlign: 'center' }, authWrap: { flex: 1, justifyContent: 'center', padding: 20 }, authCard: { width: '100%', maxWidth: 430, alignSelf: 'center', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 22, padding: 24, gap: 14 }, input: { backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: colors.border, borderRadius: 11, padding: 13, color: colors.text, fontSize: 14 }, textButton: { alignItems: 'center', padding: 8 },
});
