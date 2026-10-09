import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ActivityIndicator, Alert, Animated, Easing, Image, ImageSourcePropType, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as Notifications from 'expo-notifications';
import NetInfo from '@react-native-community/netinfo';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AttendanceDay, AttendanceSession, DEFAULT_POLICY, formatDuration, getAttendanceSummary, getDaySessions, isHalfDayDate, localDateKey, MONTHLY_LATE_LOGIN_LIMIT, monthLateCount, PolicyConfig } from './src/lib/attendance';
import { clearDay, loadDays, loadPolicy, migrateDeviceAttendanceToAccount, saveDay, savePolicy, syncPending } from './src/lib/storage';
import { isSupabaseConfigured, supabase } from './src/lib/supabase';
import { cancelReminder, prepareAttendanceNotifications, scheduleDailyReminder, scheduleTimedReminder, showChatNotification, showLateLoginWarning, showWorkHourCongratulations } from './src/lib/notifications';
import { colors } from './src/theme';
import { BUILD_ID, BUILD_SUMMARY } from './src/release';

if (Platform.OS !== 'web') Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }) });
type Tab = 'Today' | 'History' | 'Games' | 'Calls' | 'Chat' | 'HR';
const clock = (value: string | null) => value ? new Date(value).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : '—';
const monthName = (key: string) => new Date(`${key}-01T12:00:00`).toLocaleDateString([], { month: 'long', year: 'numeric' });
const formatTimer = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safe / 3600)).padStart(2, '0')}:${String(Math.floor(safe % 3600 / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
};

export default function App() {
  return <SafeAreaProvider><OfficeTimeApp /><DeploymentUpdateNotice /></SafeAreaProvider>;
}

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

function PwaInstallPrompt() {
  const [platform, setPlatform] = useState<'ios' | 'android' | 'desktop'>('desktop');
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [showInstallSteps, setShowInstallSteps] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const iosDevice = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const androidDevice = /android/i.test(navigator.userAgent);
    setPlatform(iosDevice ? 'ios' : androidDevice ? 'android' : 'desktop');
    setInstalled(standalone);
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as InstallPromptEvent);
    };
    const onInstalled = () => { setInstalled(true); setInstallEvent(null); };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  return <View style={styles.installCard}>
    <View style={styles.installCopy}><Text style={styles.installTitle}>{installed ? 'Milo is installed' : 'Install Milo'}</Text><Text style={styles.installDescription}>{installed ? 'Launch Milo from your Home Screen or app list.' : 'Add Milo to your device for quick, app-like access.'}</Text>{showInstallSteps && <Text style={styles.installDescription}>{platform === 'ios' ? 'In Safari, tap Share, then choose “Add to Home Screen”.' : platform === 'android' ? 'In Chrome, open ⋮ and choose “Install app” or “Add to Home screen”.' : 'Use your browser menu and choose “Install Milo” or “Install app”.'}</Text>}</View>
    <Pressable accessibilityRole="button" onPress={() => {
      if (installed) { setShowInstallSteps(value => !value); return; }
      if (installEvent) {
        const pending = installEvent;
        void pending.prompt().then(() => pending.userChoice).then(choice => {
          setInstallEvent(null);
          if (choice.outcome === 'accepted') setInstalled(true);
          setShowInstallSteps(choice.outcome !== 'accepted');
        });
        return;
      }
      setShowInstallSteps(value => !value);
    }} style={styles.installButton}><Text style={styles.installButtonText}>{installed ? 'Install info' : installEvent ? 'Install' : 'How to install'}</Text></Pressable>
  </View>;
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

function FireworksCelebration({ onDone }: { onDone: () => void }) {
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const message = useRef(new Animated.Value(0)).current;
  const doneRef = useRef(onDone);
  useEffect(() => { doneRef.current = onDone; }, [onDone]);
  useEffect(() => {
    Animated.sequence([
      Animated.spring(message, { toValue: 1, damping: 11, stiffness: 115, useNativeDriver: true }),
      Animated.delay(4900),
      Animated.timing(message, { toValue: 0, duration: 650, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]).start(({ finished }) => { if (finished) doneRef.current(); });
    return () => message.stopAnimation();
  }, [message]);
  const textOpacity = message.interpolate({ inputRange: [0, 0.18, 0.8, 1], outputRange: [0, 1, 1, 0] });
  const textScale = message.interpolate({ inputRange: [0, 0.55, 1], outputRange: [0.72, 1, 0.92] });
  return <View pointerEvents="none" accessible={false} style={styles.fireworksLayer} onLayout={event => setViewport({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}>
    {viewport.width > 0 && viewport.height > 0 && [
      [0.12, 0.12], [0.48, 0.1], [0.86, 0.13], [0.27, 0.28], [0.7, 0.32],
      [0.08, 0.48], [0.91, 0.49], [0.38, 0.62], [0.64, 0.67], [0.19, 0.82], [0.82, 0.85], [0.5, 0.91],
    ].map(([x, y], index) => <FireworkBurst key={index} x={viewport.width * x} y={viewport.height * y} delay={index * 340} seed={index + 1} />)}
    <Animated.View style={[styles.fireworksMessage, { opacity: textOpacity, transform: [{ scale: textScale }] }]}>
      <Text style={styles.fireworksEmoji}>🎆 🎉 🎆</Text>
      <Text style={styles.fireworksTitle}>8 hours complete!</Text>
      <Text style={styles.fireworksSubtitle}>Fantastic work today</Text>
    </Animated.View>
  </View>;
}

function FireworkBurst({ x, y, delay, seed }: { x: number; y: number; delay: number; seed: number }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.sequence([
      Animated.delay(delay),
      Animated.timing(progress, { toValue: 1, duration: 1500, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [delay, progress]);
  const palette = ['#FBBF24', '#FB7185', '#60A5FA', '#A78BFA', '#34D399', '#FFFFFF'];
  const radius = 74 + (seed % 3) * 18;
  return <View style={{ position: 'absolute', left: x, top: y, width: 1, height: 1 }}>
    {Array.from({ length: 18 }, (_, index) => {
      const angle = (Math.PI * 2 * index) / 18 + seed * 0.34;
      const distance = radius * (index % 3 === 0 ? 1 : 0.76);
      const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(angle) * distance] });
      const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(angle) * distance] });
      const opacity = progress.interpolate({ inputRange: [0, 0.12, 0.72, 1], outputRange: [0, 1, 0.9, 0] });
      const scale = progress.interpolate({ inputRange: [0, 0.16, 1], outputRange: [0.2, 1, 0.35] });
      return <Animated.View key={index} style={[styles.fireworkParticle, { backgroundColor: palette[(index + seed) % palette.length], opacity, transform: [{ translateX }, { translateY }, { rotate: `${(angle * 180) / Math.PI + 90}deg` }, { scale }] }]} />;
    })}
    <Animated.View style={[styles.fireworkFlash, { opacity: progress.interpolate({ inputRange: [0, 0.08, 0.28, 1], outputRange: [0, 0.9, 0.18, 0] }), transform: [{ scale: progress.interpolate({ inputRange: [0, 0.1, 1], outputRange: [0.1, 1.4, 0.2] }) }] }]} />
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
      <Text style={styles.updateSummary}>{release?.summary || BUILD_SUMMARY || 'Milo has been updated.'}</Text>
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
  const [tab, setTab] = useState<Tab>(() => typeof window !== 'undefined' && (new URL(window.location.href).searchParams.has('match') || new URL(window.location.href).searchParams.has('ludo')) ? 'Games' : 'Today');
  const [online, setOnline] = useState(true);
  const [offlineContinue, setOfflineContinue] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(new Date());
  const [hrRows, setHrRows] = useState<any[]>([]);
  const [policyUploadBusy, setPolicyUploadBusy] = useState(false);
  const [policyUploadedName, setPolicyUploadedName] = useState('');
  const [miloModalOpen, setMiloModalOpen] = useState(false);
  const [miloFabHovered, setMiloFabHovered] = useState(false);
  const [correctionTarget, setCorrectionTarget] = useState<{ date: string; add: boolean } | null>(null);
  const [officeOutSummary, setOfficeOutSummary] = useState<AttendanceDay | null>(null);
  const [catGreeting, setCatGreeting] = useState<'hi' | 'bye' | null>(null);
  const [fireworksId, setFireworksId] = useState(0);
  const [breakReminderEnabled, setBreakReminderEnabled] = useState(true);
  const previousTargetState = useRef<{ date: string; reached: boolean } | null>(null);
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
  const breakStartedAt = breakTimerRunning ? sessions[sessions.length - 1]?.punchOutAt ?? null : null;

  useEffect(() => {
    if (!breakReminderEnabled || !breakStartedAt || day.officeOutAt) { void cancelReminder('break-reminder'); return; }
    const reminderAfterMs = Math.max(15, policy.defaultBreakMinutes) * 60_000;
    const remainingMs = reminderAfterMs - Math.max(0, now.getTime() - new Date(breakStartedAt).getTime());
    if (remainingMs > 0) void scheduleTimedReminder('break-reminder', 'Break time', `Your expected ${formatDuration(policy.defaultBreakMinutes)} break is up. Ready to punch back in?`, remainingMs).catch(() => undefined);
    else void cancelReminder('break-reminder');
  }, [breakReminderEnabled, breakStartedAt, day.officeOutAt, policy.defaultBreakMinutes]);

  useEffect(() => {
    if (booting) return;
    const previous = previousTargetState.current;
    previousTargetState.current = { date: today, reached: summary.targetReached };
    if (!previous || previous.date !== today || previous.reached || !summary.targetReached) return;
    setFireworksId(id => id + 1);
    void (async () => {
      await cancelNotice('work-target');
      const body = `${formatDuration(policy.recordedWorkTargetMinutes)} of recorded work reached. Congratulations — fantastic work today!`;
      if (!(await showWorkHourCongratulations('Daily work goal reached! 🎉', body))) Alert.alert('Daily work goal reached! 🎉', body);
    })();
  }, [booting, today, summary.targetReached, policy.recordedWorkTargetMinutes]);

  const refresh = useCallback(async () => {
    setDays(await loadDays()); setPolicy(await loadPolicy());
  }, []);

  useEffect(() => {
    let mounted = true;
    const subscription = NetInfo.addEventListener(state => { setOnline(!!state.isConnected); if (state.isConnected) void syncPending().then(refresh); });
    const timer = setInterval(() => setNow(new Date()), 1_000);
    void AsyncStorage.getItem('milo.break-reminders.v1').then(value => { if (value !== null) setBreakReminderEnabled(value === 'true'); });
    void Promise.all([refresh(), scheduleDailyReminder()]).finally(() => { if (mounted) setBooting(false); });
    if (supabase) {
      void supabase.auth.getSession().then(async ({ data }) => {
        if (!mounted) return;
        if (data.session?.user && !data.session.user.is_anonymous) await migrateDeviceAttendanceToAccount(data.session.user.id);
        if (mounted) { setSession(data.session); await refresh(); }
      });
      const { data: { subscription: authSubscription } } = supabase.auth.onAuthStateChange((_event, next) => {
        setSession(next);
        if (next?.user && !next.user.is_anonymous) {
          setTimeout(() => { void migrateDeviceAttendanceToAccount(next.user.id).then(refresh); }, 0);
        } else setTimeout(() => { void refresh(); }, 0);
      });
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
    const firstLoginIsLate = kind === 'in' && sessions.length === 0 && updatedSummary.afterFlexLimit;
    if (kind === 'in') {
      await cancelNotice('break-reminder');
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
      if (breakReminderEnabled) await scheduleTimedNotice('break-reminder', 'Break time', `Your expected ${formatDuration(policy.defaultBreakMinutes)} break is up. Ready to punch back in?`, Math.max(15, policy.defaultBreakMinutes) * 60_000);
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
    await cancelNotice('break-reminder');
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

  async function uploadMiloPolicy(file: File): Promise<string | null> {
    if (!supabase || !session) return 'Sign in with an HR administrator account to upload the policy.';
    if (!file.name.toLowerCase().endsWith('.pdf') || file.size > 5 * 1024 * 1024) return 'Choose a PDF smaller than 5 MB.';
    setPolicyUploadBusy(true);
    try {
      const form = new FormData();
      form.set('file', file);
      const { data, error } = await supabase.functions.invoke('milo-policy-ingest', {
        body: form,
      });
      if (error || data?.error) throw new Error(data?.error || await edgeFunctionErrorMessage(error, 'Policy upload failed.'));
      setPolicyUploadedName(data.documentName ?? file.name);
      return null;
    } catch (error: any) {
      return error?.message || 'Policy upload failed. Check your connection and try again.';
    } finally { setPolicyUploadBusy(false); }
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

  if (booting) return <SafeAreaView style={styles.safe}><View style={styles.center}><ActivityIndicator color={colors.blue} /><Text style={styles.muted}>Loading Milo…</Text></View></SafeAreaView>;
  if (!session && isSupabaseConfigured && !offlineContinue) return <AuthScreen onContinue={() => setOfflineContinue(true)} onJoinChat={async name => {
    const guestUsername = `guest_${Math.random().toString(36).slice(2, 12)}`;
    const { error } = await supabase!.auth.signInAnonymously({ options: { data: { full_name: name, username: guestUsername } } });
    if (error) return error.message;
    setOfflineContinue(true);
    return null;
  }} />;

  const lateDays = days.filter(d => d.date.startsWith(today.slice(0, 7)) && d.punchInAt && getAttendanceSummary(d, new Date(d.punchInAt), policy).afterFlexLimit);
  const halfDayToday = isHalfDayDate(days, today, policy);
  const showPageAnimations = tab !== 'Chat' && tab !== 'Games' && tab !== 'Calls';
  return <SafeAreaView style={styles.safe}>
    {showPageAnimations && <PageAmbience />}
    <StatusBar style="dark" />
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.header}><View><Text style={styles.eyebrow}>YOUR OFFICE COMPANION</Text><Text style={styles.title}>Milo</Text><Text style={styles.subtitle}>{now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}</Text></View><MiloControlPanel now={now} onNavigate={nextTab => setTab(nextTab)} /></View>
      <View style={[styles.connection, !online && styles.offline]}><View style={[styles.dot, { backgroundColor: online ? '#16A34A' : '#D97706' }]} /><Text style={styles.connectionText}>{online ? (session ? 'Connected · changes sync automatically' : 'Local mode · sign in to sync') : 'Offline · punches saved on this device'}</Text><Pressable onPress={() => { if (session) void signOut(); }}><Text style={styles.link}>{session ? 'Sign out' : ''}</Text></Pressable></View>
      {Platform.OS === 'web' && <PwaInstallPrompt />}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}><>{(['Today', 'History', 'Games', 'Calls', 'Chat', ...(role !== 'employee' ? ['HR'] : [])] as Tab[]).map(item => <Pressable key={item} onPress={() => setTab(item)} style={[styles.tab, tab === item && styles.tabActive]}><Text style={[styles.tabText, tab === item && styles.tabTextActive]}>{item}</Text></Pressable>)}</></ScrollView>
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
          <Pressable accessibilityRole="switch" accessibilityState={{ checked: breakReminderEnabled }} onPress={() => { const next = !breakReminderEnabled; setBreakReminderEnabled(next); void AsyncStorage.setItem('milo.break-reminders.v1', String(next)); if (!next) void cancelNotice('break-reminder'); }} style={styles.outlineButton}><Text style={styles.outlineText}>{breakReminderEnabled ? '✓ Break-end reminder on' : '＋ Turn on break-end reminder'}</Text></Pressable>
          <Pressable style={styles.outlineButton} onPress={() => void scheduleWorkTarget()}><Text style={styles.outlineText}>Remind me when target is reached</Text></Pressable>
          {Platform.OS === 'web' && <Text style={styles.muted}>Browser reminders need notification permission and this tab open. Use the iOS or Android app for scheduled daily reminders.</Text>}
          <Text style={styles.policyNote}>Punch-in sessions count as recorded work. Each punch-out starts a break timer that stops at the next punch-in. The policy mentions both a 9-hour day including breaks and 8 recorded work hours; confirm the expected break duration with HR.</Text>
        </View>
      </>}
      {tab === 'Today' && <><Pressable style={styles.outlineButton} onPress={() => setCorrectionTarget({ date: today, add: !days.some(item => item.date === today) })}><Text style={styles.outlineText}>{sessions.length ? 'Adjust or add punch times' : 'Add a missed punch'}</Text></Pressable><WorkTimeCalculator targetMinutes={policy.recordedWorkTargetMinutes} />{sessions.length > 0 && <ClearDayControl date={today} onClear={clearAttendanceDay} />}</>}
      {tab === 'Today' && <TeamAvailability session={session} today={today} />}
      {tab === 'History' && <History days={days} policy={policy} onClear={clearAttendanceDay} onCorrect={date => setCorrectionTarget({ date, add: false })} onAddMissed={date => setCorrectionTarget({ date, add: true })} />}
      {tab === 'Chat' && <TeamChat session={session} onJoin={async name => {
        if (!supabase) return 'Configure Supabase to enable shared chat.';
        const { error } = await supabase.auth.signInAnonymously({ options: { data: { full_name: name } } });
        return error?.message ?? null;
      }} />}
      {tab === 'Games' && <GamesHub session={session} />}
      <CallsHub session={session} active={tab === 'Calls'} />
      {tab === 'HR' && <HRDashboard rows={hrRows} loading={busy} role={role} policyUploadBusy={policyUploadBusy} policyUploadedName={policyUploadedName} onUploadPolicy={uploadMiloPolicy} onRefresh={async () => { setBusy(true); const { data } = await supabase!.rpc('hr_attendance_report'); setHrRows(data ?? []); setBusy(false); }} onResolve={resolveReview} />}
      <View style={styles.footerCard}><Text style={styles.footerTitle}>A note about official attendance</Text><Text style={styles.footerText}>The supplied policy says the office biometric system is the official record. Milo is a companion tracker until HR authorizes it for official use.</Text></View>
      <Text style={styles.footer}>Milo · Your office companion</Text>
    </ScrollView>
    {showPageAnimations && <PassingGlitterGif />}
    {showPageAnimations && <FallingSpiderMan />}
    {Platform.OS === 'web' && <Pressable accessibilityRole="button" accessibilityLabel="Chat with Milo, your office companion" onHoverIn={() => setMiloFabHovered(true)} onHoverOut={() => setMiloFabHovered(false)} onPress={() => setMiloModalOpen(true)} style={[styles.miloFab, miloFabHovered && styles.miloFabHovered]}><View style={styles.miloFabAvatar}><Text style={styles.miloFabEmoji}>🐱</Text></View>{miloFabHovered && <View style={styles.miloFabCopy}><Text style={styles.miloFabName}>Milo</Text><Text style={styles.miloFabCaption}>Your office companion</Text></View>}</Pressable>}
    <Modal visible={miloModalOpen} transparent animationType="fade" onRequestClose={() => setMiloModalOpen(false)}>
      <View style={styles.miloOverlay}>
        <View style={styles.miloModalCard}>
          <View style={styles.cardHeading}><View><Text style={styles.sectionTitle}>Ask Milo</Text><Text style={styles.chatPresence}>Company policy assistant</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Close Milo assistant" hitSlop={10} onPress={() => setMiloModalOpen(false)}><Text style={styles.link}>Close</Text></Pressable></View>
          <MiloPolicyAssistant session={session} compact />
        </View>
      </View>
    </Modal>
    {correctionTarget && <PunchCorrectionModal key={`${correctionTarget.date}-${correctionTarget.add}`} date={correctionTarget.date} day={days.find(item => item.date === correctionTarget.date)} addToExisting={correctionTarget.add} onClose={() => setCorrectionTarget(null)} onSave={savePunchCorrection} />}
    {officeOutSummary && <OfficeOutSummaryModal day={officeOutSummary} policy={policy} onClose={() => { setOfficeOutSummary(null); setCatGreeting('bye'); }} onUndo={undoOfficeOut} />}
    {fireworksId > 0 && <FireworksCelebration key={fireworksId} onDone={() => setFireworksId(0)} />}
  </SafeAreaView>;
}

function MiloControlPanel({ now, onNavigate }: { now: Date; onNavigate: (tab: Tab) => void }) {
  const [open, setOpen] = useState(false);
  const shortcuts: { label: string; icon: string; tab: Tab }[] = [
    { label: 'Games', icon: '🎮', tab: 'Games' },
    { label: 'History', icon: '🕘', tab: 'History' },
    { label: 'Today', icon: '⏱️', tab: 'Today' },
    { label: 'Chat', icon: '💬', tab: 'Chat' },
  ];
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel="Open Milo control panel" onPress={() => setOpen(true)} style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: '#F8C9D0', borderWidth: 2, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', shadowColor: '#47218C', shadowOpacity: 0.18, shadowRadius: 8, elevation: 6 }}>
      <Text style={{ fontSize: 22 }}>🎛️</Text>
    </Pressable>
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <View style={{ flex: 1, backgroundColor: 'rgba(32, 20, 70, 0.28)' }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close control panel" onPress={() => setOpen(false)} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }} />
        <View style={{ position: 'absolute', top: Platform.OS === 'web' ? 16 : 48, right: 12, width: '92%', maxWidth: 450, padding: 18, borderRadius: 34, backgroundColor: '#EAF5FF', borderWidth: 1, borderColor: '#FFFFFF', shadowColor: '#241052', shadowOpacity: 0.28, shadowRadius: 18, elevation: 12, gap: 14 }}>
          <View style={{ height: 158, borderRadius: 28, backgroundColor: '#F8CDD1', paddingHorizontal: 22, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', overflow: 'hidden' }}>
            <View><Text style={{ color: '#FFFFFF', fontSize: 42, lineHeight: 50, fontWeight: '900' }}>{now.toLocaleDateString([], { day: 'numeric' })} ♡</Text><Text style={{ color: '#FFFFFF', fontSize: 24, fontWeight: '800', letterSpacing: 1 }}>{now.toLocaleDateString([], { month: 'long' })}</Text></View>
            <View style={{ alignItems: 'center' }}><Text style={{ fontSize: 52 }}>☁️</Text><Text style={{ color: '#FFFFFF', fontSize: 20, letterSpacing: 3 }}>˙ ˙ ˙ ˙</Text></View>
          </View>
          <View style={{ flexDirection: 'row', gap: 12, height: 178 }}>
            <View style={{ flex: 1, gap: 10 }}>
              {[shortcuts.slice(0, 2), shortcuts.slice(2, 4)].map((row, rowIndex) => <View key={rowIndex} style={{ flex: 1, flexDirection: 'row', gap: 10 }}>
                {row.map(item => <Pressable key={item.tab} accessibilityRole="button" accessibilityLabel={item.label} onPress={() => { setOpen(false); onNavigate(item.tab); }} style={{ flex: 1, minWidth: 0, borderRadius: 22, backgroundColor: '#F7C2C8', borderWidth: 1, borderColor: '#FFE8EA', alignItems: 'center', justifyContent: 'center', shadowColor: '#783C61', shadowOpacity: 0.16, shadowRadius: 6, elevation: 4 }}><Text style={{ fontSize: 34 }}>{item.icon}</Text></Pressable>)}
              </View>)}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Open calls" onPress={() => { setOpen(false); onNavigate('Calls'); }} style={{ flex: 0.9, borderRadius: 28, backgroundColor: '#F7C2C8', borderWidth: 1, borderColor: '#FFE8EA', alignItems: 'center', justifyContent: 'center', shadowColor: '#783C61', shadowOpacity: 0.16, shadowRadius: 6, elevation: 4 }}><Text style={{ fontSize: 76 }}>📞</Text></Pressable>
          </View>
          <Text style={{ textAlign: 'center', color: '#65517F', fontSize: 11, fontWeight: '700', letterSpacing: 1 }}>MILO · YOUR OFFICE COMPANION</Text>
        </View>
      </View>
    </Modal>
  </>;
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
type ChatRoomMember = { member_id: string; member_name: string; joined_at: string; username?: string };
type DirectChat = { room_id: string; room_name: string; peer_username: string; created_at: string };
type ChatMessage = { id: string; room_id: string; sender_id: string; sender_name: string; body: string; media_path: string | null; media_type: 'image' | 'video' | 'audio' | null; view_once: boolean; sent_at: string; reply_to?: string | null };
type ChatReaction = { message_id: string; user_id: string; emoji: string };
type CallMode = 'voice' | 'video';
type IncomingCall = { callId: string; roomId: string; fromId: string; fromName: string; toId?: string; mode: CallMode; group?: boolean; offer?: RTCSessionDescriptionInit };
type ActiveCall = { callId: string; peerId: string; peerName: string; mode: CallMode; direction: 'incoming' | 'outgoing'; status: string; group: boolean; hostId: string };
type CallPeer = { id: string; name: string };
const QUICK_EMOJIS = ['😊', '❤️', '👍', '😂', '🎉', '🙏'];

async function edgeFunctionErrorMessage(error: any, fallback: string) {
  try {
    const response = error?.context;
    if (response && typeof response.clone === 'function') {
      const body = await response.clone().json();
      if (typeof body?.error === 'string') return body.error;
    }
  } catch { /* retain the SDK message below */ }
  return error?.message || fallback;
}

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

function chooseCallOutput(outputs: any[], speaker: boolean) {
  const terms = speaker ? /speaker|loudspeaker|built.in output/i : /earpiece|receiver|handset|phone/i;
  return outputs.find(device => terms.test(device.label || '')) ?? (speaker ? outputs.find(device => device.deviceId === 'default') : undefined);
}

function applyCallAudioOutput(deviceId: string) {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('[data-office-call-media]').forEach((element: any) => {
    if (element.setSinkId) void element.setSinkId(deviceId).catch(() => undefined);
  });
}

function CallsHub({ session, active }: { session: any; active: boolean }) {
  const [username, setUsername] = useState('');
  const [inviteUsername, setInviteUsername] = useState('');
  const [call, setCall] = useState<any>(null);
  const [ring, setRing] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [muted, setMuted] = useState(false);
  const [speakerMode, setSpeakerMode] = useState(true);
  const [audioOutputs, setAudioOutputs] = useState<any[]>([]);
  const [cameraFacing, setCameraFacing] = useState<'user'|'environment'>('user');
  const inbox = useRef<any>(null);
  const channel = useRef<any>(null);
  const peers = useRef<Map<string, any>>(new Map());
  const pendingIce = useRef<Map<string, any[]>>(new Map());
  const stream = useRef<any>(null);
  const callRef = useRef<any>(null);
  const channelReady = useRef(false);
  const selfId = session?.user?.id as string | undefined;
  const selfName = session?.user?.user_metadata?.full_name || 'Milo user';
  const [remoteStreams, setRemoteStreams] = useState<Record<string, any>>({});

  const refreshHistory = useCallback(async () => {
    if (!supabase || !session) return;
    const { data, error: rpcError } = await supabase.rpc('list_my_call_history');
    if (!rpcError) setHistory(Array.isArray(data) ? data : []);
  }, [session]);

  const sendSignal = useCallback((targetId: string, kind: string, payload: any = {}) => {
    if (channel.current && channelReady.current && selfId) void channel.current.send({ type: 'broadcast', event: 'call-signal', payload: { fromId: selfId, targetId, kind, payload } });
  }, [selfId]);

  const createPeer = useCallback((peerId: string, initiator: boolean) => {
    if (!selfId || !stream.current || peers.current.has(peerId)) return;
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    peers.current.set(peerId, pc);
    stream.current.getTracks().forEach((track: any) => pc.addTrack(track, stream.current));
    pc.onicecandidate = (event: any) => { if (event.candidate) sendSignal(peerId, 'ice', event.candidate); };
    pc.ontrack = (event: any) => setRemoteStreams(current => ({ ...current, [peerId]: event.streams[0] }));
    pc.onconnectionstatechange = () => { if (['failed','closed'].includes(pc.connectionState)) { pc.close(); peers.current.delete(peerId); setRemoteStreams(current => { const next = { ...current }; delete next[peerId]; return next; }); } };
    if (initiator) void pc.createOffer().then((offer: any) => pc.setLocalDescription(offer).then(() => sendSignal(peerId, 'offer', offer))).catch(() => setError('Could not start the media connection. Check your camera and microphone permissions.'));
  }, [selfId, sendSignal]);

  const attachCallChannel = useCallback(async (callId: string) => {
    if (!supabase || !selfId) return false;
    if (channel.current) await supabase.removeChannel(channel.current);
    channelReady.current = false;
    const ch = supabase.channel(`call-session:${callId}`, { config: { private: true } });
    ch.on('broadcast', { event: 'call-signal' }, async ({ payload }: any) => {
      if (payload?.targetId && payload.targetId !== selfId) return;
      const fromId = payload?.fromId;
      if (!fromId || fromId === selfId) return;
      if (payload.kind === 'joined') {
        createPeer(fromId, selfId < fromId);
        if (supabase && callRef.current) void supabase.rpc('list_call_session_members', { call_id_in: callRef.current.id }).then(({ data }: any) => { if (Array.isArray(data)) setMembers(data); });
      } else if (payload.kind === 'left') {
        peers.current.get(fromId)?.close(); peers.current.delete(fromId);
        setRemoteStreams(current => { const next = { ...current }; delete next[fromId]; return next; });
      } else if (payload.kind === 'declined') {
        setError('A user declined the call.');
        if (callRef.current && supabase) void supabase.rpc('list_call_session_members', { call_id_in: callRef.current.id }).then(({ data }: any) => { if (Array.isArray(data)) setMembers(data); });
      } else if (payload.kind === 'offer') {
        createPeer(fromId, false);
        const pc = peers.current.get(fromId);
        if (pc) { await pc.setRemoteDescription(new RTCSessionDescription(payload.payload)); for (const candidate of pendingIce.current.get(fromId) || []) await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => undefined); pendingIce.current.delete(fromId); const answer = await pc.createAnswer(); await pc.setLocalDescription(answer); sendSignal(fromId, 'answer', answer); }
      } else if (payload.kind === 'answer') {
        const pc = peers.current.get(fromId); if (pc) { await pc.setRemoteDescription(new RTCSessionDescription(payload.payload)); for (const candidate of pendingIce.current.get(fromId) || []) await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => undefined); pendingIce.current.delete(fromId); }
      } else if (payload.kind === 'ice') {
        const pc = peers.current.get(fromId); if (pc?.remoteDescription) await pc.addIceCandidate(new RTCIceCandidate(payload.payload)).catch(() => undefined);
        else pendingIce.current.set(fromId, [...(pendingIce.current.get(fromId) || []), payload.payload]);
      } else if (payload.kind === 'ended') {
        setCall(null); callRef.current = null; setRing(null); setError('The call has ended.');
        peers.current.forEach(peer => peer.close()); peers.current.clear(); pendingIce.current.clear();
        stream.current?.getTracks().forEach((track: any) => track.stop()); stream.current = null; setRemoteStreams({}); setMuted(false); setCameraFacing('user'); setSpeakerMode(true);
      }
    });
    const subscribed = new Promise<boolean>(resolve => ch.subscribe((status: string) => {
      if (status === 'SUBSCRIBED') { channelReady.current = true; resolve(true); }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') resolve(false);
    }));
    channel.current = ch;
    return subscribed;
  }, [selfId, createPeer, sendSignal]);

  const ensureMedia = useCallback(async (callMode: 'voice'|'video') => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') throw new Error('Calls need a supported browser with microphone and camera access.');
    if (stream.current) return stream.current;
    stream.current = await navigator.mediaDevices.getUserMedia({ audio: true, video: callMode === 'video' ? { facingMode: { ideal: 'user' } } : false });
    if (navigator.mediaDevices.enumerateDevices) setAudioOutputs((await navigator.mediaDevices.enumerateDevices().catch(() => [])).filter((device: any) => device.kind === 'audiooutput'));
    return stream.current;
  }, []);

  const toggleMute = () => {
    const next = !muted;
    stream.current?.getAudioTracks().forEach((track: any) => { track.enabled = !next; });
    setMuted(next);
  };
  const switchCamera = async () => {
    if (!stream.current || !navigator.mediaDevices?.getUserMedia) return;
    const nextFacing = cameraFacing === 'user' ? 'environment' : 'user';
    try {
      const currentTrack = stream.current.getVideoTracks()[0];
      if (currentTrack?.applyConstraints) {
        try { await currentTrack.applyConstraints({ facingMode: { exact: nextFacing } }); setCameraFacing(nextFacing); return; }
        catch { /* Reacquire the camera if this browser cannot switch an active track. */ }
      }
      const cameraStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: nextFacing } } });
      const nextTrack = cameraStream.getVideoTracks()[0];
      if (!nextTrack) throw new Error('No other camera was found.');
      const current = stream.current;
      const previous = current.getVideoTracks()[0];
      const combined = new MediaStream([...current.getAudioTracks(), nextTrack]);
      await Promise.all([...peers.current.values()].map((peer: any) => peer.getSenders().find((sender: any) => sender.track?.kind === 'video')?.replaceTrack(nextTrack)));
      previous?.stop(); cameraStream.getTracks().filter((track: any) => track !== nextTrack).forEach((track: any) => track.stop());
      stream.current = combined; setCameraFacing(nextFacing);
    } catch (cause: any) { setError(cause?.message || 'Could not switch camera.'); }
  };
  const toggleSpeaker = () => {
    const nextSpeaker = !speakerMode;
    const target = chooseCallOutput(audioOutputs, nextSpeaker);
    if (typeof document === 'undefined' || !target || typeof (document.createElement('audio') as any).setSinkId !== 'function') {
      setError('This browser does not expose a separate speaker and earpiece output. Change the audio route on your device.');
      return;
    }
    setError(''); applyCallAudioOutput(target.deviceId); setSpeakerMode(nextSpeaker);
  };
  const sinkId = chooseCallOutput(audioOutputs, speakerMode)?.deviceId;

  const loadMembers = useCallback(async (callId: string) => {
    const { data, error: rpcError } = await supabase!.rpc('list_call_session_members', { call_id_in: callId });
    if (rpcError) throw rpcError;
    const list = Array.isArray(data) ? data : [];
    setMembers(list);
    return list;
  }, []);

  const setupInbox = useCallback(() => {
    if (!supabase || !selfId || inbox.current) return;
    const ch = supabase.channel(`call-inbox:${selfId}`, { config: { private: true } });
    ch.on('broadcast', { event: 'incoming-call' }, async ({ payload }: any) => {
      if (!payload?.callId) return;
      if (callRef.current) { void supabase.rpc('respond_call_session', { call_id_in: payload.callId, action_in: 'decline' }); return; }
      const ready = await attachCallChannel(payload.callId);
      if (ready) setRing(payload);
    });
    ch.subscribe(); inbox.current = ch;
  }, [selfId, attachCallChannel]);

  useEffect(() => {
    setupInbox(); void refreshHistory();
    return () => {
      if (supabase && inbox.current) void supabase.removeChannel(inbox.current);
      if (supabase && channel.current) void supabase.removeChannel(channel.current);
      peers.current.forEach(peer => peer.close());
      stream.current?.getTracks().forEach((track: any) => track.stop());
    };
  }, [setupInbox, refreshHistory]);

  const beginCall = async (usernames: string[], callMode: 'voice'|'video', seedCallId?: string) => {
    if (!supabase || !session) { setError('Sign in to make calls.'); return; }
    if (callRef.current && !seedCallId) { setError('Leave your current call before starting another one.'); return; }
    setBusy(true); setError('');
    try {
      await ensureMedia(callMode);
      let callId = seedCallId;
      if (!callId) {
        const { data, error: rpcError } = await supabase.rpc('create_call_session', { usernames_in: usernames, mode_in: callMode });
        if (rpcError) throw rpcError;
        callId = data;
      }
      if (!callId) throw new Error('Could not create the call.');
        setCall({ id: callId, mode: callMode, createdBy: seedCallId ? ring?.callerId : selfId }); callRef.current = { id: callId, mode: callMode, createdBy: seedCallId ? ring?.callerId : selfId };
      const ready = channelReady.current || await attachCallChannel(callId);
      if (!ready) throw new Error('Could not connect to the call service. Run the latest Supabase chat schema.');
      if (seedCallId && selfId) {
        const { error: joinError } = await supabase.rpc('respond_call_session', { call_id_in: callId, action_in: 'join' });
        if (joinError) throw joinError;
        setRing(null);
        const roster = await loadMembers(callId);
        const callCreator = roster[0]?.call_creator;
        if (callCreator) { setCall((current: any) => current ? { ...current, createdBy: callCreator } : current); callRef.current = { id: callId, mode: callMode, createdBy: callCreator }; }
        for (const member of roster) if (member.status === 'joined' && member.user_id !== selfId) createPeer(member.user_id, !!selfId && selfId < member.user_id);
        void channel.current?.send({ type: 'broadcast', event: 'call-signal', payload: { fromId: selfId, kind: 'joined' } });
      } else {
        const { data: roster } = await supabase.rpc('list_call_session_members', { call_id_in: callId });
        for (const member of (Array.isArray(roster) ? roster : [])) {
          if (member.status === 'invited') void sendCallInbox(member.user_id, { callId, callerId: selfId, callerName: selfName, mode: callMode });
        }
        await loadMembers(callId);
      }
      void refreshHistory();
    } catch (cause: any) {
      setError(cause?.message || 'Could not start the call.'); setCall(null); callRef.current = null;
      if (supabase && channel.current) await supabase.removeChannel(channel.current);
      channel.current = null; channelReady.current = false;
      peers.current.forEach(peer => peer.close()); peers.current.clear(); pendingIce.current.clear();
      stream.current?.getTracks().forEach((track: any) => track.stop()); stream.current = null;
    }
    finally { setBusy(false); }
  };

  const sendCallInbox = async (targetId: string, payload: any) => {
    if (!supabase) return;
    const ch = supabase.channel(`call-inbox:${targetId}`, { config: { private: true } });
    await new Promise<void>(resolve => ch.subscribe((status: string) => { if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') resolve(); }));
    if (ch.state !== 'joined') { await supabase.removeChannel(ch); throw new Error('Could not reach that user right now. Try again in a moment.'); }
    await ch.send({ type: 'broadcast', event: 'incoming-call', payload });
    await supabase.removeChannel(ch);
  };

  const answerCall = async () => {
    if (!ring) return;
    await beginCall([], ring.mode, ring.callId);
  };
  const declineCall = async () => {
    if (ring && supabase) {
      if (selfId) await channel.current?.send({ type: 'broadcast', event: 'call-signal', payload: { fromId: selfId, kind: 'declined' } });
      await supabase.rpc('respond_call_session', { call_id_in: ring.callId, action_in: 'decline' });
    }
    setRing(null);
  };
  const hangup = async (everyone = false) => {
    const activeCall = callRef.current;
    if (!activeCall || !supabase) return;
    if (selfId) await channel.current?.send({ type: 'broadcast', event: 'call-signal', payload: { fromId: selfId, kind: everyone ? 'ended' : 'left' } });
    await supabase.rpc('respond_call_session', { call_id_in: activeCall.id, action_in: everyone ? 'end' : 'leave' });
    if (supabase && channel.current) await supabase.removeChannel(channel.current);
    channel.current = null; channelReady.current = false;
    peers.current.forEach(peer => peer.close()); peers.current.clear(); pendingIce.current.clear();
    stream.current?.getTracks().forEach((track: any) => track.stop()); stream.current = null;
    setRemoteStreams({}); setCall(null); callRef.current = null; setMembers([]); setMuted(false); setCameraFacing('user'); setSpeakerMode(true); void refreshHistory();
  };
  const addMember = async () => {
    if (!call || !supabase || !inviteUsername.trim()) return;
    setBusy(true); setError('');
    try {
      const { data, error: rpcError } = await supabase.rpc('invite_call_member', { call_id_in: call.id, username_in: inviteUsername.trim() });
      if (rpcError) throw rpcError;
      await sendCallInbox(data.user_id, { callId: call.id, callerId: selfId, callerName: selfName, mode: call.mode });
      setInviteUsername(''); await loadMembers(call.id);
    } catch (cause: any) { setError(cause?.message || 'Could not invite that username.'); }
    finally { setBusy(false); }
  };

  const openFromHistory = async (item: any) => {
    const targets = (item.members || []).filter((member: any) => member.status !== 'declined').map((member: any) => member.username);
    if (!targets.length) { setError('There are no other users in this call history.'); return; }
    await beginCall(targets, item.mode);
  };

  return <View style={[styles.card, !active && { display: 'none' }]}>
    <View style={styles.cardHeading}><View><Text style={styles.sectionTitle}>Calls</Text><Text style={styles.chatPresence}>Call people by username or redial from history</Text></View><Text style={styles.chatPresence}>🔒 Private</Text></View>
    {!session && <Text style={styles.muted}>Sign in or continue as a guest to call other users.</Text>}
    <Text style={styles.fieldLabel}>Invite by username</Text>
    <TextInput style={styles.input} value={username} onChangeText={setUsername} placeholder="e.g. guest_calm_fox_12" autoCapitalize="none" autoCorrect={false} editable={!busy} />
    <View style={styles.buttonRow}>
      <Pressable style={[styles.action, styles.primary, (!session || !username.trim() || busy) && styles.dim]} disabled={!session || !username.trim() || busy} onPress={() => void beginCall([username.trim()], 'voice')}><Text style={styles.actionText}>☎ Voice call</Text></Pressable>
      <Pressable style={[styles.action, styles.teal, (!session || !username.trim() || busy) && styles.dim]} disabled={!session || !username.trim() || busy} onPress={() => void beginCall([username.trim()], 'video')}><Text style={styles.actionText}>▣ Video call</Text></Pressable>
    </View>
    <Text style={styles.helper}>The invited user receives a ringing prompt anywhere in Milo.</Text>
    {error ? <Text style={styles.chatError}>{error}</Text> : null}
    {call && <View style={styles.callActiveCard}>
      <View style={styles.cardHeading}><View><Text style={styles.sectionTitle}>{call.mode === 'video' ? 'Video call' : 'Voice call'}</Text><Text style={styles.chatPresence}>{members.filter(member => member.status === 'joined').map(member => member.display_name || member.username).join(' · ') || 'Connecting…'}</Text></View><Text style={styles.pill}>LIVE</Text></View>
      {call.mode === 'video' && <View style={styles.callVideoGrid}>{Object.entries(remoteStreams).map(([peerId, remote]: any) => <CallVideo key={peerId} stream={remote} sinkId={sinkId} />)}{stream.current && <CallVideo stream={stream.current} muted mirrored />}</View>}
      {call.mode === 'voice' && Object.entries(remoteStreams).map(([peerId, remote]: any) => <CallAudio key={peerId} stream={remote} sinkId={sinkId} />)}
      <View style={styles.chatInputRow}><TextInput style={styles.chatInput} value={inviteUsername} onChangeText={setInviteUsername} placeholder="Add username to this call" autoCapitalize="none" autoCorrect={false} /><Pressable style={styles.chatTool} disabled={busy} onPress={() => void addMember()}><Text style={styles.chatToolText}>＋ Add</Text></Pressable></View>
      <View style={styles.callModalActions}><Pressable accessibilityRole="button" onPress={toggleMute} style={[styles.callControl, muted && styles.callControlMuted]}><Text style={styles.callControlText}>{muted ? 'Unmute' : 'Mute'}</Text></Pressable><Pressable accessibilityRole="button" onPress={toggleSpeaker} style={styles.callControl}><Text style={styles.callControlText}>{speakerMode ? 'Speaker' : 'Normal audio'}</Text></Pressable>{call.mode === 'video' && <Pressable accessibilityRole="button" onPress={() => void switchCamera()} style={styles.callControl}><Text style={styles.callControlText}>{cameraFacing === 'user' ? 'Back camera' : 'Front camera'}</Text></Pressable>}<Pressable style={[styles.callControl, styles.callDecline]} onPress={() => void hangup()}><Text style={styles.callControlText}>Leave call</Text></Pressable>{call.createdBy === selfId && <Pressable style={[styles.callControl, styles.callControlMuted]} onPress={() => void hangup(true)}><Text style={styles.callControlText}>End for everyone</Text></Pressable>}</View>
    </View>}
    <Text style={styles.sectionTitle}>Call history</Text>
    {history.length === 0 ? <View style={styles.empty}><Text style={styles.emptyTitle}>No calls yet</Text><Text style={styles.muted}>Calls you make or receive will appear here.</Text></View> : history.slice(0,30).map(item => {
      const people = (item.members || []).map((member: any) => member.display_name || `@${member.username}`).join(', ') || 'No other participants';
      return <View key={item.id} style={styles.callHistoryRow}><View style={{ flex: 1 }}><Text style={styles.historyTitle}>{item.mode === 'video' ? '▣ Video' : '☎ Voice'} · {people}</Text><Text style={styles.historySub}>{new Date(item.created_at).toLocaleString()} {item.ended_at ? '· ended' : '· active'}</Text></View><Pressable style={styles.chatTool} onPress={() => void openFromHistory(item)}><Text style={styles.chatToolText}>Call again</Text></Pressable></View>;
    })}
    <Modal visible={!!ring} transparent animationType="fade" onRequestClose={() => void declineCall()}>
      <View style={styles.miloOverlay}><View style={styles.callRingCard}><Text style={styles.callRingIcon}>{ring?.mode === 'video' ? '▣' : '☎'}</Text><Text style={styles.sectionTitle}>{ring?.callerName || 'Someone'} is calling</Text><Text style={styles.chatPresence}>Incoming {ring?.mode} call</Text><View style={styles.buttonRow}><Pressable style={[styles.action, styles.primary]} onPress={() => void answerCall()} disabled={busy}><Text style={styles.actionText}>Answer</Text></Pressable><Pressable style={[styles.action, styles.dangerAction]} onPress={() => void declineCall()}><Text style={styles.actionText}>Decline</Text></Pressable></View></View></View>
    </Modal>
  </View>;
}

function CallVideo({ stream, muted = false, sinkId, mirrored = false }: { stream: any; muted?: boolean; sinkId?: string; mirrored?: boolean }) {
  const ref = useRef<any>(null);
  useEffect(() => { if (ref.current) { ref.current.srcObject = stream; if (sinkId && ref.current.setSinkId) void ref.current.setSinkId(sinkId).catch(() => undefined); void ref.current.play?.().catch(() => undefined); } }, [stream, sinkId]);
  if (Platform.OS !== 'web') return <View style={styles.callVideo}><Text style={styles.muted}>Video is available in the web app.</Text></View>;
  return React.createElement('video', { ref, autoPlay: true, playsInline: true, muted, style: { width: '100%', minHeight: 150, backgroundColor: '#0F172A', borderRadius: 12, objectFit: 'cover', transform: mirrored ? 'scaleX(-1)' : undefined } } as any);
}

function CallAudio({ stream, sinkId }: { stream: any; sinkId?: string }) {
  const ref = useRef<any>(null);
  useEffect(() => { if (ref.current) { ref.current.srcObject = stream; if (sinkId && ref.current.setSinkId) void ref.current.setSinkId(sinkId).catch(() => undefined); void ref.current.play?.().catch(() => undefined); } }, [stream, sinkId]);
  if (Platform.OS !== 'web') return null;
  return React.createElement('audio', { ref, autoPlay: true, style: { position: 'absolute', width: 1, height: 1, opacity: 0 } } as any);
}

function TeamChat({ session, onJoin }: { session: any; onJoin: (name: string) => Promise<string | null> }) {
  const [miloMode, setMiloMode] = useState(false);
  const [personalChatMode, setPersonalChatMode] = useState(false);
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
  const [updatedRoomName, setUpdatedRoomName] = useState('');
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
  const [messageSearch, setMessageSearch] = useState('');
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [mentionNotice, setMentionNotice] = useState('');
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
  const [directPeer, setDirectPeer] = useState<{ id: string; name: string } | null>(null);
  const [callReady, setCallReady] = useState(false);
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [callError, setCallError] = useState('');
  const [localCallStream, setLocalCallStream] = useState<MediaStream | null>(null);
  const [remoteCallStream, setRemoteCallStream] = useState<MediaStream | null>(null);
  const [groupCallStreams, setGroupCallStreams] = useState<Record<string, MediaStream>>({});
  const [callPeers, setCallPeers] = useState<CallPeer[]>([]);
  const [callMuted, setCallMuted] = useState(false);
  const [cameraDisabled, setCameraDisabled] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<'user'|'environment'>('user');
  const [speakerMode, setSpeakerMode] = useState(true);
  const [audioOutputDevices, setAudioOutputDevices] = useState<any[]>([]);
  const [viewed, setViewed] = useState<string[]>([]);
  const recorder = useRef<MediaRecorder | null>(null);
  const mediaStream = useRef<MediaStream | null>(null);
  const callChannel = useRef<any>(null);
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const groupPeerConnections = useRef<Record<string, RTCPeerConnection>>({});
  const roomMembersRef = useRef<ChatRoomMember[]>([]);
  const localCallStreamRef = useRef<MediaStream | null>(null);
  const queuedCallIce = useRef<RTCIceCandidateInit[]>([]);
  const queuedGroupCallIce = useRef<Record<string, RTCIceCandidateInit[]>>({});
  const callPeersRef = useRef<CallPeer[]>([]);
  const announcedCallIds = useRef(new Set<string>());
  const pendingLocalCallIce = useRef<Record<string, RTCIceCandidateInit[]>>({});
  const activeCallRef = useRef<ActiveCall | null>(null);
  const callReadyRef = useRef(false);
  const incomingCallRef = useRef<IncomingCall | null>(null);
  const localCallVideo = useRef<HTMLVideoElement | null>(null);
  const remoteCallVideo = useRef<HTMLVideoElement | null>(null);
  const chunks = useRef<Blob[]>([]);
  const messageScroll = useRef<ScrollView>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const isJoined = !!session?.user?.id;
  const isAnonymous = !!session?.user?.is_anonymous;
  const myName = session?.user?.user_metadata?.full_name || session?.user?.email?.split('@')[0] || 'Guest';
  const filteredMessages = messageSearch.trim() ? messages.filter(message => `${message.sender_name} ${message.body}`.toLocaleLowerCase().includes(messageSearch.trim().toLocaleLowerCase())) : messages;

  activeCallRef.current = activeCall;
  incomingCallRef.current = incomingCall;
  callReadyRef.current = callReady;
  callPeersRef.current = callPeers;
  roomMembersRef.current = roomMembers;

  useEffect(() => {
    let alive = true;
    setDirectPeer(null);
    setCallReady(false);
    setCallError('');
    if (!supabase || !session?.user?.id || selectedRoom?.room_type !== 'direct') return () => { alive = false; };
    void supabase.rpc('get_direct_chat_peer', { room_id_in: selectedRoom.room_id }).then(({ data, error }) => {
      if (!alive) return;
      const peer = Array.isArray(data) ? data[0] : null;
      if (error) setCallError(`Calls need the latest chat database setup: ${error.message}`);
      else if (peer?.peer_id) setDirectPeer({ id: peer.peer_id, name: peer.peer_name || selectedRoom.room_name });
      else setCallError('Could not find the other person in this chat.');
    });
    return () => { alive = false; };
  }, [session?.user?.id, selectedRoom?.room_id, selectedRoom?.room_type]);

  useEffect(() => {
    if (!supabase || !session?.user?.id || !selectedRoom || (selectedRoom.room_type === 'direct' && !directPeer)) return;
    let alive = true;
    const channel = supabase.channel(`chat-call:${selectedRoom.room_id}`, { config: { private: true } });
    callChannel.current = channel;
    channel
      .on('broadcast', { event: 'call-offer' }, ({ payload }: any) => {
        if (!alive || payload?.toId !== session.user.id || payload?.roomId !== selectedRoom.room_id) return;
        if (activeCallRef.current || incomingCallRef.current) {
          void channel.send({ type: 'broadcast', event: 'call-busy', payload: { callId: payload.callId, toId: payload.fromId, fromId: session.user.id } });
          return;
        }
        setCallError('');
        setIncomingCall(payload as IncomingCall);
      })
      .on('broadcast', { event: 'call-invite' }, ({ payload }: any) => {
        if (!alive || selectedRoom.room_type !== 'group' || payload?.roomId !== selectedRoom.room_id || payload?.fromId === session.user.id) return;
        if (activeCallRef.current || incomingCallRef.current) {
          void channel.send({ type: 'broadcast', event: 'call-busy', payload: { callId: payload.callId, toId: payload.fromId, fromId: session.user.id } });
          return;
        }
        setCallError('');
        setIncomingCall({ ...payload, group: true } as IncomingCall);
      })
      .on('broadcast', { event: 'call-join' }, ({ payload }: any) => { void handleGroupJoin(payload); })
      .on('broadcast', { event: 'call-roster' }, ({ payload }: any) => { void handleGroupRoster(payload); })
      .on('broadcast', { event: 'group-offer' }, ({ payload }: any) => { void handleGroupOffer(payload); })
      .on('broadcast', { event: 'group-answer' }, ({ payload }: any) => { void handleGroupAnswer(payload); })
      .on('broadcast', { event: 'group-ice' }, ({ payload }: any) => { void handleGroupIce(payload); })
      .on('broadcast', { event: 'call-leave' }, ({ payload }: any) => { handleGroupLeave(payload); })
      .on('broadcast', { event: 'call-full' }, ({ payload }: any) => { if (payload?.callId === activeCallRef.current?.callId && payload?.toId === session.user.id) { endCall(false); setCallError('This room call is full. Up to six people can join.'); } })
      .on('broadcast', { event: 'call-answer' }, async ({ payload }: any) => {
        const active = activeCallRef.current;
        if (!alive || !active || payload?.callId !== active.callId || !peerConnection.current) return;
        try {
          await peerConnection.current.setRemoteDescription(payload.answer);
          for (const candidate of queuedCallIce.current.splice(0)) await peerConnection.current.addIceCandidate(candidate);
          setActiveCall(current => current?.callId === active.callId ? { ...current, status: 'Connecting…' } : current);
        } catch { setCallError('Could not establish the call. Please try again.'); }
      })
      .on('broadcast', { event: 'call-ice' }, async ({ payload }: any) => {
        const active = activeCallRef.current;
        const incoming = incomingCallRef.current;
        if (!alive || (payload?.callId !== active?.callId && payload?.callId !== incoming?.callId)) return;
        if (!peerConnection.current?.remoteDescription) queuedCallIce.current.push(payload.candidate);
        else try { await peerConnection.current.addIceCandidate(payload.candidate); } catch { /* ignore stale ICE candidates */ }
      })
      .on('broadcast', { event: 'call-decline' }, ({ payload }: any) => {
        if (payload?.callId === activeCallRef.current?.callId && !activeCallRef.current?.group) { endCall(false); setCallError('Call declined.'); }
      })
      .on('broadcast', { event: 'call-end' }, ({ payload }: any) => {
        const active = activeCallRef.current;
        if (payload?.callId && (payload.callId === active?.callId || payload.callId === incomingCallRef.current?.callId) && (!active?.group || payload.fromId === active.hostId)) endCall(false);
      })
      .on('broadcast', { event: 'call-busy' }, ({ payload }: any) => {
        if (payload?.callId === activeCallRef.current?.callId && !activeCallRef.current?.group) { endCall(false); setCallError('They are already on another call.'); }
      })
      .subscribe((status: string) => {
        if (!alive) return;
        setCallReady(status === 'SUBSCRIBED');
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setCallError('Call connection unavailable. Check the private Realtime channel setup in Supabase.');
      });
    return () => {
      alive = false;
      setCallReady(false);
      if (activeCallRef.current) { const call = activeCallRef.current; void channel.send({ type: 'broadcast', event: call.group && call.hostId !== session?.user?.id ? 'call-leave' : 'call-end', payload: { callId: call.callId, fromId: session?.user?.id } }); }
      if (callChannel.current === channel) callChannel.current = null;
      peerConnection.current?.close(); peerConnection.current = null;
      Object.values(groupPeerConnections.current).forEach(connection => connection.close()); groupPeerConnections.current = {};
      localCallStreamRef.current?.getTracks().forEach(track => track.stop()); localCallStreamRef.current = null;
      setLocalCallStream(null); setRemoteCallStream(null); setGroupCallStreams({}); setCallPeers([]); setActiveCall(null); setIncomingCall(null); queuedCallIce.current = []; queuedGroupCallIce.current = {}; callPeersRef.current = [];
      announcedCallIds.current.clear(); pendingLocalCallIce.current = {};
      void supabase?.removeChannel(channel);
    };
  }, [session?.user?.id, selectedRoom?.room_id, selectedRoom?.room_type, directPeer?.id]);

  useEffect(() => {
    if (localCallVideo.current) localCallVideo.current.srcObject = localCallStream;
    if (remoteCallVideo.current) remoteCallVideo.current.srcObject = remoteCallStream;
  }, [localCallStream, remoteCallStream, activeCall?.mode]);

  const callAudioSinkId = chooseCallOutput(audioOutputDevices, speakerMode)?.deviceId;
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    document.querySelectorAll('[data-office-call-media]').forEach((element: any) => {
      if (callAudioSinkId && element.setSinkId) void element.setSinkId(callAudioSinkId).catch(() => undefined);
    });
  }, [callAudioSinkId, activeCall?.mode, localCallStream, remoteCallStream, groupCallStreams]);

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

  const refreshUnreadCounts = useCallback(async () => {
    if (!supabase || !isJoined) return;
    const { data, error } = await supabase.rpc('list_chat_unread_counts');
    if (error) return;
    setUnreadCounts(Object.fromEntries(((data ?? []) as { room_id: string; unread_count: number }[]).map(item => [item.room_id, Number(item.unread_count)])));
  }, [isJoined]);

  useEffect(() => { if (isJoined) void refreshRooms(); }, [isJoined, refreshRooms]);

  useEffect(() => {
    if (!isJoined) return;
    void refreshUnreadCounts();
    const interval = setInterval(() => void refreshUnreadCounts(), 15_000);
    return () => clearInterval(interval);
  }, [isJoined, refreshUnreadCounts]);

  useEffect(() => {
    if (!supabase || !selectedRoom || !isJoined) return;
    let alive = true;
    setMessageSearch('');
    void Promise.all([
      supabase.rpc('mark_chat_room_read', { room_id_in: selectedRoom.room_id }),
      supabase.rpc('list_chat_room_members', { room_id_in: selectedRoom.room_id }),
    ]).then(([readResult, memberResult]) => {
      if (!alive) return;
      if (readResult.error) setChatError(`Unread markers need the latest chat database setup: ${readResult.error.message}`);
      if (memberResult.error) setRoomError(`Could not load room members: ${memberResult.error.message}`);
      else setRoomMembers((memberResult.data ?? []) as ChatRoomMember[]);
      setUnreadCounts(current => ({ ...current, [selectedRoom.room_id]: 0 }));
      void refreshUnreadCounts();
    });
    return () => { alive = false; };
  }, [selectedRoom?.room_id, isJoined, refreshUnreadCounts]);

  useEffect(() => {
    if (!isJoined || selectedRoom || !personalChatMode || miloMode) return;
    const refreshTimer = setInterval(() => { void refreshRooms(); }, 10000);
    return () => clearInterval(refreshTimer);
  }, [isJoined, selectedRoom?.room_id, personalChatMode, miloMode, refreshRooms]);

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

  async function renameRoom() {
    if (!supabase || !selectedRoom?.is_creator || selectedRoom.room_type !== 'group' || roomSettingsBusy) return;
    const nextName = updatedRoomName.trim();
    if (!nextName || nextName.length > 50) { setRoomError('Lobby name must be between 1 and 50 characters.'); return; }
    if (nextName === selectedRoom.room_name) { setRoomNotice('Lobby name is unchanged.'); return; }
    setRoomSettingsBusy(true); setRoomError(''); setRoomNotice('');
    const { error } = await supabase.rpc('rename_chat_room', { room_id_in: selectedRoom.room_id, name_in: nextName });
    if (error) setRoomError(error.message);
    else {
      const nextRooms = await refreshRooms();
      const updatedRoom = nextRooms.find(room => room.room_id === selectedRoom.room_id);
      if (updatedRoom) setSelectedRoom(updatedRoom);
      setUpdatedRoomName(nextName);
      setRoomNotice('Lobby name updated.');
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
    endCall();
    setSelectedRoom(null); setMessages([]); setReactions([]); setReplyTo(null); setDraft(''); setFile(null); setChatError(''); setRoomError(''); setRoomMembers([]); setShowRoomSettings(false); setDeleteRoomConfirm(false); setRoomNotice('');
    void refreshRooms();
  }

  async function sendCallSignal(event: string, payload: Record<string, unknown>) {
    const channel = callChannel.current;
    if (!channel || !callReadyRef.current) throw new Error('Call connection is still starting. Try again in a moment.');
    const result = await channel.send({ type: 'broadcast', event, payload });
    if (result !== 'ok') throw new Error('Could not send the call signal. Check your connection and try again.');
  }

  function endCall(notifyPeer = true) {
    const call = activeCallRef.current;
    if (notifyPeer && call && callChannel.current && callReadyRef.current) {
      const event = call.group && call.hostId !== session?.user?.id ? 'call-leave' : 'call-end';
      void callChannel.current.send({ type: 'broadcast', event, payload: { callId: call.callId, fromId: session?.user?.id } });
    }
    peerConnection.current?.close(); peerConnection.current = null;
    Object.values(groupPeerConnections.current).forEach(connection => connection.close()); groupPeerConnections.current = {};
    localCallStreamRef.current?.getTracks().forEach(track => track.stop()); localCallStreamRef.current = null;
    setLocalCallStream(null); setRemoteCallStream(null); setGroupCallStreams({}); setCallPeers([]); setActiveCall(null); setIncomingCall(null); callPeersRef.current = [];
    setCallMuted(false); setCameraDisabled(false); setCameraFacing('user'); setSpeakerMode(true); queuedCallIce.current = []; queuedGroupCallIce.current = {};
    if (call) { announcedCallIds.current.delete(call.callId); delete pendingLocalCallIce.current[call.callId]; }
  }

  async function prepareCall(mode: CallMode, callId: string) {
    if (Platform.OS !== 'web' || typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') {
      throw new Error('Voice and video calls are currently available in the web app.');
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: mode === 'video' ? { facingMode: { ideal: 'user' } } : false });
    if (navigator.mediaDevices.enumerateDevices) setAudioOutputDevices((await navigator.mediaDevices.enumerateDevices().catch(() => [])).filter((device: any) => device.kind === 'audiooutput'));
    setCameraFacing('user');
    localCallStreamRef.current = stream;
    setLocalCallStream(stream);
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    peerConnection.current = pc;
    stream.getTracks().forEach(track => pc.addTrack(track, stream));
    pc.onicecandidate = event => {
      if (!event.candidate) return;
      const candidate = event.candidate.toJSON();
      if (!announcedCallIds.current.has(callId)) { (pendingLocalCallIce.current[callId] ??= []).push(candidate); return; }
      void sendCallSignal('call-ice', { callId, candidate }).catch(() => {});
    };
    pc.ontrack = event => {
      let remote = event.streams[0];
      if (!remote) { remote = new MediaStream(); remote.addTrack(event.track); }
      setRemoteCallStream(remote);
      setActiveCall(current => current?.callId === callId ? { ...current, status: 'Connected' } : current);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') setActiveCall(current => current?.callId === callId ? { ...current, status: 'Connected' } : current);
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') setCallError('Call connection was lost. Try again or switch networks.');
    };
    return pc;
  }

  async function sendGroupSignal(event: string, payload: Record<string, unknown>) {
    const channel = callChannel.current;
    if (!channel || !callReadyRef.current) throw new Error('Call connection is still starting. Try again in a moment.');
    const result = await channel.send({ type: 'broadcast', event, payload });
    if (result !== 'ok') throw new Error('Could not send a group-call signal. Check your connection and try again.');
  }

  function rememberCallPeer(peer: CallPeer) {
    if (peer.id === session?.user?.id) return;
    const next = [...callPeersRef.current.filter(item => item.id !== peer.id), peer];
    callPeersRef.current = next;
    setCallPeers(next);
  }

  async function createGroupPeerConnection(peer: CallPeer, callId: string, makeOffer: boolean) {
    if (groupPeerConnections.current[peer.id] || !localCallStreamRef.current || !session?.user?.id) return;
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    groupPeerConnections.current[peer.id] = pc;
    localCallStreamRef.current.getTracks().forEach(track => pc.addTrack(track, localCallStreamRef.current!));
    pc.onicecandidate = event => {
      if (event.candidate) void sendGroupSignal('group-ice', { callId, fromId: session.user.id, toId: peer.id, candidate: event.candidate.toJSON() }).catch(() => {});
    };
    pc.ontrack = event => {
      let stream = event.streams[0];
      if (!stream) { stream = new MediaStream(); stream.addTrack(event.track); }
      setGroupCallStreams(current => ({ ...current, [peer.id]: stream }));
      setActiveCall(current => current?.callId === callId ? { ...current, status: 'Connected' } : current);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') setCallError(`Could not connect to ${peer.name}. Their network may block direct calls.`);
    };
    if (makeOffer) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await sendGroupSignal('group-offer', { callId, fromId: session.user.id, toId: peer.id, offer: { type: pc.localDescription?.type, sdp: pc.localDescription?.sdp } });
    }
  }

  async function handleGroupJoin(payload: any) {
    const active = activeCallRef.current;
    if (!active?.group || payload?.callId !== active.callId || payload?.fromId === session?.user?.id) return;
    const peer = { id: payload.fromId as string, name: (payload.fromName as string) || 'Room member' };
    if (callPeersRef.current.length >= 5) { void sendGroupSignal('call-full', { callId: active.callId, fromId: session.user.id, toId: peer.id }); return; }
    rememberCallPeer(peer);
    try {
      await sendGroupSignal('call-roster', { callId: active.callId, toId: peer.id, peers: [{ id: session.user.id, name: myName }, ...callPeersRef.current] });
      if (session.user.id < peer.id) await createGroupPeerConnection(peer, active.callId, true);
    } catch (error: any) { setCallError(error?.message || 'Could not connect this room member.'); }
  }

  async function handleGroupRoster(payload: any) {
    const active = activeCallRef.current;
    if (!active?.group || payload?.callId !== active.callId || payload?.toId !== session?.user?.id || !Array.isArray(payload?.peers)) return;
    try {
      for (const peer of payload.peers as CallPeer[]) {
        if (!peer?.id || peer.id === session.user.id) continue;
        rememberCallPeer(peer);
        if (session.user.id < peer.id) await createGroupPeerConnection(peer, active.callId, true);
      }
    } catch (error: any) { setCallError(error?.message || 'Could not connect to the room call.'); }
  }

  async function handleGroupOffer(payload: any) {
    const active = activeCallRef.current;
    if (!active?.group || payload?.callId !== active.callId || payload?.toId !== session?.user?.id || !payload?.fromId) return;
    const peer = callPeersRef.current.find(item => item.id === payload.fromId) || { id: payload.fromId, name: 'Room member' };
    try {
      if (!groupPeerConnections.current[peer.id]) await createGroupPeerConnection(peer, active.callId, false);
      const pc = groupPeerConnections.current[peer.id];
      await pc.setRemoteDescription(payload.offer);
      for (const candidate of queuedGroupCallIce.current[peer.id] ?? []) await pc.addIceCandidate(candidate);
      delete queuedGroupCallIce.current[peer.id];
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await sendGroupSignal('group-answer', { callId: active.callId, fromId: session.user.id, toId: peer.id, answer: { type: pc.localDescription?.type, sdp: pc.localDescription?.sdp } });
    } catch (error: any) { setCallError(error?.message || `Could not answer ${peer.name}.`); }
  }

  async function handleGroupAnswer(payload: any) {
    const active = activeCallRef.current;
    const pc = payload?.fromId ? groupPeerConnections.current[payload.fromId] : null;
    if (!active?.group || payload?.callId !== active.callId || payload?.toId !== session?.user?.id || !pc) return;
    try {
      await pc.setRemoteDescription(payload.answer);
      for (const candidate of queuedGroupCallIce.current[payload.fromId] ?? []) await pc.addIceCandidate(candidate);
      delete queuedGroupCallIce.current[payload.fromId];
    } catch { setCallError('Could not finish connecting a room member.'); }
  }

  async function handleGroupIce(payload: any) {
    const active = activeCallRef.current;
    if (!active?.group || payload?.callId !== active.callId || payload?.toId !== session?.user?.id || !payload?.fromId) return;
    const pc = groupPeerConnections.current[payload.fromId];
    if (!pc?.remoteDescription) { (queuedGroupCallIce.current[payload.fromId] ??= []).push(payload.candidate); return; }
    try { await pc.addIceCandidate(payload.candidate); } catch { /* ignore stale ICE candidates */ }
  }

  function handleGroupLeave(payload: any) {
    const active = activeCallRef.current;
    if (!active?.group || payload?.callId !== active.callId || !payload?.fromId) return;
    groupPeerConnections.current[payload.fromId]?.close();
    delete groupPeerConnections.current[payload.fromId];
    delete queuedGroupCallIce.current[payload.fromId];
    setGroupCallStreams(current => { const next = { ...current }; delete next[payload.fromId]; return next; });
    const next = callPeersRef.current.filter(peer => peer.id !== payload.fromId);
    callPeersRef.current = next; setCallPeers(next);
  }

  async function prepareGroupCallMedia(mode: CallMode) {
    if (Platform.OS !== 'web' || typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) throw new Error('Group calls are currently available in the web app.');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: mode === 'video' ? { facingMode: { ideal: 'user' } } : false });
    if (navigator.mediaDevices.enumerateDevices) setAudioOutputDevices((await navigator.mediaDevices.enumerateDevices().catch(() => [])).filter((device: any) => device.kind === 'audiooutput'));
    setCameraFacing('user');
    localCallStreamRef.current = stream;
    setLocalCallStream(stream);
  }

  async function startGroupCall(mode: CallMode) {
    if (!selectedRoom || selectedRoom.room_type !== 'group' || !session?.user?.id || !callReady || activeCallRef.current || incomingCallRef.current) return;
    setCallError('');
    const callId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setActiveCall({ callId, peerId: '', peerName: selectedRoom.room_name, mode, direction: 'outgoing', status: 'Inviting room members…', group: true, hostId: session.user.id });
    try {
      await prepareGroupCallMedia(mode);
      await sendGroupSignal('call-invite', { callId, roomId: selectedRoom.room_id, fromId: session.user.id, fromName: myName, mode, group: true });
      setActiveCall(current => current?.callId === callId ? { ...current, status: 'Waiting for members…' } : current);
    } catch (error: any) { endCall(false); setCallError(error?.message || 'Could not start the group call.'); }
  }

  async function startCall(mode: CallMode) {
    if (selectedRoom?.room_type === 'group') { await startGroupCall(mode); return; }
    if (!directPeer || selectedRoom?.room_type !== 'direct' || !session?.user?.id || !callReady || activeCallRef.current || incomingCallRef.current) return;
    setCallError('');
    const callId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setActiveCall({ callId, peerId: directPeer.id, peerName: directPeer.name, mode, direction: 'outgoing', status: 'Calling…', group: false, hostId: session.user.id });
    try {
      const pc = await prepareCall(mode, callId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await sendCallSignal('call-offer', { callId, roomId: selectedRoom.room_id, fromId: session.user.id, fromName: myName, toId: directPeer.id, mode, offer: { type: pc.localDescription?.type, sdp: pc.localDescription?.sdp } });
      announcedCallIds.current.add(callId);
      for (const candidate of pendingLocalCallIce.current[callId] ?? []) await sendCallSignal('call-ice', { callId, candidate });
      delete pendingLocalCallIce.current[callId];
    } catch (error: any) {
      endCall(false);
      setCallError(error?.message || 'Could not start the call. Check microphone and camera permissions.');
    }
  }

  async function acceptCall() {
    const invitation = incomingCallRef.current;
    if (!invitation) return;
    setIncomingCall(null);
    setActiveCall({ callId: invitation.callId, peerId: invitation.fromId, peerName: invitation.fromName, mode: invitation.mode, direction: 'incoming', status: invitation.group ? 'Joining room call…' : 'Connecting…', group: !!invitation.group, hostId: invitation.fromId });
    try {
      if (invitation.group) {
        await prepareGroupCallMedia(invitation.mode);
        setCallPeers([{ id: invitation.fromId, name: invitation.fromName }]);
        await sendGroupSignal('call-join', { callId: invitation.callId, roomId: invitation.roomId, fromId: session.user.id, fromName: myName });
        return;
      }
      const pc = await prepareCall(invitation.mode, invitation.callId);
      if (!invitation.offer) throw new Error('The call invitation is incomplete. Ask them to call again.');
      await pc.setRemoteDescription(invitation.offer);
      for (const candidate of queuedCallIce.current.splice(0)) await pc.addIceCandidate(candidate);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await sendCallSignal('call-answer', { callId: invitation.callId, answer: { type: pc.localDescription?.type, sdp: pc.localDescription?.sdp } });
    } catch (error: any) {
      endCall(false);
      setCallError(error?.message || 'Could not answer the call. Check microphone and camera permissions.');
    }
  }

  function declineCall() {
    const invitation = incomingCallRef.current;
    if (invitation && callChannel.current) void callChannel.current.send({ type: 'broadcast', event: 'call-decline', payload: { callId: invitation.callId } });
    setIncomingCall(null);
  }

  function toggleCallMute() {
    const next = !callMuted;
    localCallStreamRef.current?.getAudioTracks().forEach(track => { track.enabled = !next; });
    setCallMuted(next);
  }

  function toggleCallCamera() {
    const next = !cameraDisabled;
    localCallStreamRef.current?.getVideoTracks().forEach(track => { track.enabled = !next; });
    setCameraDisabled(next);
  }

  async function switchCallCamera() {
    const current = localCallStreamRef.current;
    if (!current || !navigator.mediaDevices?.getUserMedia) return;
    const nextFacing = cameraFacing === 'user' ? 'environment' : 'user';
    let cameraStream: MediaStream | null = null;
    try {
      const currentTrack = current.getVideoTracks()[0];
      if (currentTrack?.applyConstraints) {
        try { await currentTrack.applyConstraints({ facingMode: { exact: nextFacing } }); setCameraFacing(nextFacing); return; }
        catch { /* Reacquire the camera if this browser cannot switch an active track. */ }
      }
      cameraStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: nextFacing } } });
      const nextTrack = cameraStream.getVideoTracks()[0];
      const previous = current.getVideoTracks()[0];
      if (!nextTrack) throw new Error('No other camera was found.');
      nextTrack.enabled = !cameraDisabled;
      const peers = [peerConnection.current, ...Object.values(groupPeerConnections.current)].filter(Boolean) as RTCPeerConnection[];
      await Promise.all(peers.map(peer => peer.getSenders().find(sender => sender.track?.kind === 'video')?.replaceTrack(nextTrack)));
      const updated = new MediaStream([...current.getAudioTracks(), nextTrack]);
      previous?.stop();
      cameraStream.getTracks().filter(track => track !== nextTrack).forEach(track => track.stop());
      localCallStreamRef.current = updated; setLocalCallStream(updated); setCameraFacing(nextFacing);
    } catch (error: any) {
      cameraStream?.getTracks().forEach(track => track.stop());
      setCallError(error?.message || 'Could not switch camera.');
    }
  }

  function toggleCallSpeaker() {
    const nextSpeaker = !speakerMode;
    const target = chooseCallOutput(audioOutputDevices, nextSpeaker);
    if (typeof document === 'undefined' || !target || typeof (document.createElement('audio') as any).setSinkId !== 'function') {
      setCallError('This browser does not expose separate speaker and earpiece outputs. Change the audio route on your device.');
      return;
    }
    setCallError(''); applyCallAudioOutput(target.deviceId); setSpeakerMode(nextSpeaker);
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
        if (incoming.sender_id !== session.user.id) {
          const mentioned = roomMembersRef.current.some(member => member.member_id === session.user.id && member.username && incoming.body.toLocaleLowerCase().includes(`@${member.username.toLocaleLowerCase()}`));
          if (mentioned) {
            const notice = `${incoming.sender_name} mentioned you in ${selectedRoom.room_name}.`;
            setMentionNotice(notice);
            setTimeout(() => setMentionNotice(current => current === notice ? '' : current), 7000);
            void showChatNotification(`Mention in ${selectedRoom.room_name}`, `${incoming.sender_name}: ${incoming.body}`).catch(() => undefined);
          } else void showChatNotification(`${incoming.sender_name} · ${selectedRoom.room_name}`, incoming.body || `${incoming.media_type ?? 'New'} message`).catch(() => undefined);
        }
        void supabase.rpc('mark_chat_room_read', { room_id_in: selectedRoom.room_id });
        setUnreadCounts(current => ({ ...current, [selectedRoom.room_id]: 0 }));
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
    <View style={styles.chatHeading}><View style={styles.chatAvatar}><Text style={styles.chatAvatarText}>{miloMode ? '🐱' : '✦'}</Text></View><View style={{ flex: 1 }}><Text style={styles.sectionTitle}>{miloMode ? 'Ask Milo' : selectedRoom?.room_name ?? (isJoined ? personalChatMode ? 'Personal chat' : 'Chat Lobby' : 'Office chat')}</Text><Text style={styles.chatPresence}>{miloMode ? 'Answers grounded in the company HR policy' : selectedRoom ? `${selectedRoom.member_count} members · ${selectedRoom.room_type === 'direct' ? 'personal chat' : 'private group'} · live` : personalChatMode ? 'Start or open a personal conversation' : 'Find a group or create your own'}</Text></View>{!!selectedRoom && <View style={styles.callActions}><Pressable accessibilityRole="button" accessibilityLabel={selectedRoom?.room_type === 'group' ? 'Start group voice call' : 'Start voice call'} disabled={!callReady || !!activeCall || !!incomingCall} onPress={() => void startCall('voice')} style={[styles.callButton, (!callReady || !!activeCall || !!incomingCall) && styles.dim]}><Text style={styles.callButtonText}>☎</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={selectedRoom?.room_type === 'group' ? 'Start group video call' : 'Start video call'} disabled={!callReady || !!activeCall || !!incomingCall} onPress={() => void startCall('video')} style={[styles.callButton, (!callReady || !!activeCall || !!incomingCall) && styles.dim]}><Text style={styles.callButtonText}>▣</Text></Pressable></View>}{selectedRoom ? <Pressable onPress={backToLobby}><Text style={styles.link}>← Lobby</Text></Pressable> : <Text style={styles.onlineBadge}>{miloMode ? 'POLICY AI' : '● LIVE'}</Text>}</View>
    {isJoined && !selectedRoom && <>
      <View style={styles.chatIdentity}><Text style={styles.chatIdentityText}>Browsing as {myName}{isAnonymous ? ' · guest' : ''}</Text>{!!myUsername && <Text style={{ color: colors.blue, fontSize: 10, fontWeight: '800', marginTop: 4 }}>{isAnonymous ? 'Share this easy username: ' : 'Your username: '}@{myUsername}</Text>}</View>
      <View style={styles.miloModeRow}>
        <Pressable onPress={() => { setMiloMode(false); setPersonalChatMode(false); }} style={[styles.miloModeButton, !miloMode && !personalChatMode && styles.miloModeSelected]}><Text style={[styles.miloModeText, !miloMode && !personalChatMode && styles.miloModeTextSelected]}>Team chat</Text></Pressable>
        <Pressable onPress={() => { setMiloMode(false); setPersonalChatMode(true); }} style={[styles.miloModeButton, !miloMode && personalChatMode && styles.miloModeSelected]}><Text style={[styles.miloModeText, !miloMode && personalChatMode && styles.miloModeTextSelected]}>Personal chat</Text></Pressable>
        <Pressable onPress={() => { setMiloMode(true); setPersonalChatMode(false); }} style={[styles.miloModeButton, miloMode && styles.miloModeSelected]}><Text style={[styles.miloModeText, miloMode && styles.miloModeTextSelected]}>Ask Milo 🐱</Text></Pressable>
      </View>
    </>}
    {!!roomError && <Text accessibilityRole="alert" style={{ color: '#B91C1C', fontSize: 12, lineHeight: 18 }}>{roomError}</Text>}
    {!!roomNotice && <Text style={{ color: '#15803D', fontSize: 12, lineHeight: 18 }}>{roomNotice}</Text>}
    {!!chatError && <Text accessibilityRole="alert" style={{ color: '#B91C1C', fontSize: 12, lineHeight: 18 }}>{chatError}</Text>}
    {!!callError && <Text accessibilityRole="alert" style={styles.callError}>{callError}</Text>}
    {!!selectedRoom && <Text style={styles.callHint}>{callReady ? `Voice and video calls ready · ${selectedRoom.room_type === 'group' ? 'the room will be invited' : 'personal chat'}` : 'Connecting call service…'} · Allow microphone/camera access when your browser asks.</Text>}
    {!!mentionNotice && <Text accessibilityRole="alert" style={{ color: colors.blue, fontSize: 12, fontWeight: '700', backgroundColor: '#EFF6FF', padding: 9, borderRadius: 10 }}>{mentionNotice}</Text>}
    {!isJoined ? <View style={styles.chatJoin}><Text style={styles.chatWelcome}>Enter the chat lobby</Text><Text style={styles.muted}>Set a display name to browse groups. You’ll need a room password to enter private groups.</Text><TextInput style={styles.input} value={displayName} onChangeText={value => { setDisplayName(value); setJoinError(''); }} placeholder="Your name" maxLength={40} /><Pressable style={[styles.action, styles.primary, joining && styles.dim]} disabled={!displayName.trim() || joining} onPress={() => { setJoining(true); setJoinError(''); void onJoin(displayName.trim()).then(message => setJoinError(message ?? '')).catch(error => setJoinError(error instanceof Error ? error.message : 'Could not connect to Supabase. Check your internet connection and try again.')).finally(() => setJoining(false)); }}><Text style={styles.actionText}>{joining ? 'Please wait…' : 'Enter chat lobby'}</Text></Pressable>{!!joinError && <Text accessibilityRole="alert" style={{ color: '#B91C1C', fontSize: 12, lineHeight: 18 }}>{joinError}</Text>}</View> : miloMode ? <MiloPolicyAssistant session={session} /> : !selectedRoom && personalChatMode ? <>
      <View style={{ gap: 8, padding: 12, backgroundColor: '#EFF6FF', borderRadius: 14 }}><Text style={styles.chatWelcome}>Start a personal chat</Text><Text style={styles.chatPresence}>Enter someone’s Milo username to open your private conversation. Guests can chat and call using their shared username too.</Text><View style={{ flexDirection: 'row', gap: 8 }}><TextInput style={[styles.input, { flex: 1 }]} value={directUsername} onChangeText={setDirectUsername} placeholder="Username" autoCapitalize="none" autoCorrect={false} onSubmitEditing={() => void startDirectChat()}/><Pressable disabled={roomBusy || !directUsername.trim()} onPress={() => void startDirectChat()} style={[styles.action, styles.primary, (roomBusy || !directUsername.trim()) && styles.dim]}><Text style={styles.actionText}>{roomBusy ? 'Opening…' : 'Chat'}</Text></Pressable></View>
        {directChats.length > 0 && <View style={{ gap: 6, marginTop: 5 }}><Text style={styles.historyTitle}>Your personal chats</Text>{directChats.map(chat => <Pressable key={chat.room_id} onPress={() => setSelectedRoom({ room_id: chat.room_id, room_name: chat.room_name, creator_name: chat.peer_username, created_at: chat.created_at, member_count: 2, password_protected: false, joined: true, is_creator: false, room_type: 'direct' })} style={{ padding: 9, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.border, borderRadius: 10 }}><Text style={styles.historyTitle}>{chat.room_name}</Text><View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><Text style={styles.chatPresence}>@{chat.peer_username}</Text>{(unreadCounts[chat.room_id] ?? 0) > 0 && <Text style={styles.onlineBadge}>{unreadCounts[chat.room_id]} new</Text>}</View></Pressable>)}</View>}
      </View>
    </> : !selectedRoom ? <>
      <Pressable onPress={() => { setShowCreateRoom(value => !value); setRoomError(''); }} style={[styles.action, styles.primary]}><Text style={styles.actionText}>{showCreateRoom ? 'Cancel room creation' : '+ Create a chat room'}</Text></Pressable>
      {showCreateRoom && <View style={{ gap: 9, padding: 12, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: colors.border, borderRadius: 14 }}><Text style={styles.chatWelcome}>Create a private group</Text><TextInput style={styles.input} value={roomName} onChangeText={setRoomName} placeholder="Room name" maxLength={50}/><TextInput style={styles.input} value={roomPassword} onChangeText={setRoomPassword} placeholder="Create a password (4+ characters)" secureTextEntry maxLength={72}/><Pressable disabled={roomBusy || !roomName.trim() || roomPassword.length < 4} onPress={() => void createRoom()} style={[styles.action, styles.primary, (roomBusy || !roomName.trim() || roomPassword.length < 4) && styles.dim]}><Text style={styles.actionText}>{roomBusy ? 'Creating…' : 'Create room'}</Text></Pressable></View>}
      <View style={{ gap: 9 }}><Text style={styles.chatWelcome}>Available groups</Text>{roomsLoading && rooms.length === 0 ? <Text style={styles.muted}>Loading groups…</Text> : rooms.map(room => <View key={room.room_id} style={{ gap: 8, padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 14, backgroundColor: '#FFFFFF' }}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><View style={{ flex: 1 }}><Text style={styles.historyTitle}>{room.room_name}</Text><Text style={styles.chatPresence}>{room.creator_name} · {room.member_count} {room.member_count === 1 ? 'member' : 'members'} · {room.password_protected ? '🔒 Password protected' : 'Open room'}</Text></View><View style={{ alignItems: 'flex-end', gap: 4 }}>{room.joined && <Text style={styles.onlineBadge}>JOINED</Text>}{(unreadCounts[room.room_id] ?? 0) > 0 && <Text style={styles.onlineBadge}>{unreadCounts[room.room_id]} new</Text>}</View></View>{room.joined ? <Pressable onPress={() => void enterRoom(room)} style={[styles.action, styles.primary]}><Text style={styles.actionText}>Enter room</Text></Pressable> : joinRoomId === room.room_id ? null : <Pressable onPress={() => { setJoinRoomId(room.room_id); setJoinPassword(''); setRoomError(''); }} style={styles.outlineButton}><Text style={styles.outlineText}>{room.password_protected ? 'Enter password' : 'Join room'}</Text></Pressable>}{!room.joined && joinRoomId === room.room_id && <View style={{ gap: 8 }}>{room.password_protected && <TextInput style={[styles.input, { width: '100%' }]} value={joinPassword} onChangeText={setJoinPassword} placeholder="Room password" secureTextEntry returnKeyType="go" onSubmitEditing={() => void enterRoom(room, joinPassword)}/>}<View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 12 }}><Pressable accessibilityRole="button" accessibilityLabel="Cancel joining lobby" onPress={() => { setJoinRoomId(null); setJoinPassword(''); }} hitSlop={8}><Text style={styles.link}>Cancel</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={room.password_protected ? 'Enter lobby' : 'Join lobby'} disabled={roomBusy || (room.password_protected && !joinPassword)} onPress={() => void enterRoom(room, joinPassword)} style={[styles.lobbySubmit, (roomBusy || (room.password_protected && !joinPassword)) && styles.dim]}><Text style={styles.lobbySubmitText}>{roomBusy ? '…' : '✓'}</Text></Pressable></View></View>}</View>)}</View>
    </> : <>
      <View style={styles.chatIdentity}><Text style={styles.chatIdentityText}>Chatting as {myName}{isAnonymous ? ' · guest' : ''}</Text>{selectedRoom.is_creator && <Text style={{ color: colors.blue, fontSize: 10, fontWeight: '800', marginTop: 4 }}>Room creator</Text>}</View>
      {selectedRoom.is_creator && <Pressable onPress={() => { const opening = !showRoomSettings; setShowRoomSettings(opening); setRoomError(''); if (opening) { setUpdatedRoomName(selectedRoom.room_name); void loadRoomMembers(selectedRoom); } }} style={styles.outlineButton}><Text style={styles.outlineText}>{showRoomSettings ? 'Hide room management' : 'Manage room'}</Text></Pressable>}
      {showRoomSettings && selectedRoom.is_creator && <View style={{ gap: 10, padding: 12, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: colors.border, borderRadius: 14 }}>
        <Text style={styles.chatWelcome}>Room management</Text>
        {selectedRoom.room_type === 'group' && <View style={{ gap: 8, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}><Text style={styles.historyTitle}>Lobby name</Text><TextInput style={styles.input} value={updatedRoomName} onChangeText={setUpdatedRoomName} placeholder="Enter lobby name" maxLength={50} returnKeyType="done" onSubmitEditing={() => void renameRoom()}/><Pressable disabled={roomSettingsBusy || !updatedRoomName.trim() || updatedRoomName.trim() === selectedRoom.room_name} onPress={() => void renameRoom()} style={[styles.action, styles.primary, (roomSettingsBusy || !updatedRoomName.trim() || updatedRoomName.trim() === selectedRoom.room_name) && styles.dim]}><Text style={styles.actionText}>{roomSettingsBusy ? 'Saving…' : 'Save lobby name'}</Text></Pressable></View>}
        {selectedRoom.room_type === 'group' && <View style={{ gap: 8, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}><Text style={styles.historyTitle}>Add a member by username</Text><View style={{ flexDirection: 'row', gap: 8 }}><TextInput style={[styles.input, { flex: 1 }]} value={inviteUsername} onChangeText={setInviteUsername} placeholder="Username" autoCapitalize="none" autoCorrect={false}/><Pressable disabled={roomSettingsBusy || !inviteUsername.trim()} onPress={() => void addMemberByUsername()} style={[styles.action, styles.primary, (roomSettingsBusy || !inviteUsername.trim()) && styles.dim]}><Text style={styles.actionText}>Add</Text></Pressable></View><Text style={styles.chatPresence}>They need an Milo account. They’ll be added to this room immediately.</Text></View>}
        <Text style={styles.muted}>{selectedRoom.password_protected ? 'This room currently requires a password.' : 'This room is open to anyone who enters the lobby.'} Enter a new password, or leave it empty to remove password protection.</Text>
        <TextInput style={styles.input} value={updatedRoomPassword} onChangeText={setUpdatedRoomPassword} placeholder="New password (4+ characters)" secureTextEntry maxLength={72}/>
        <Pressable disabled={roomSettingsBusy || (!!updatedRoomPassword && updatedRoomPassword.length < 4) || (!updatedRoomPassword && !selectedRoom.password_protected)} onPress={() => void saveRoomPassword()} style={[styles.action, styles.primary, (roomSettingsBusy || (!!updatedRoomPassword && updatedRoomPassword.length < 4) || (!updatedRoomPassword && !selectedRoom.password_protected)) && styles.dim]}><Text style={styles.actionText}>{roomSettingsBusy ? 'Saving…' : updatedRoomPassword ? 'Update room password' : 'Remove password'}</Text></Pressable>
        <Text style={styles.historyTitle}>Members ({roomMembers.length})</Text>
        {roomMembers.map(member => <View key={member.member_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 }}><Text style={{ flex: 1, color: colors.text, fontSize: 12 }}>{member.member_name}{member.member_id === session.user.id ? ' · you (creator)' : ''}</Text>{member.member_id !== session.user.id && <Pressable disabled={roomSettingsBusy} onPress={() => void kickRoomMember(member)}><Text style={{ color: kickConfirmId === member.member_id ? '#B91C1C' : colors.muted, fontWeight: '800', fontSize: 11 }}>{kickConfirmId === member.member_id ? 'Confirm remove' : 'Remove'}</Text></Pressable>}</View>)}
        {roomMembers.length === 0 && <Text style={styles.muted}>Loading members…</Text>}
        <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10, gap: 8 }}><Text style={{ color: '#B91C1C', fontSize: 11, lineHeight: 16 }}>Deleting this room permanently removes its messages and shared media for everyone.</Text><View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><Pressable disabled={roomSettingsBusy} onPress={() => void deleteRoom()} style={[styles.action, { backgroundColor: '#B91C1C', flex: 1 }, roomSettingsBusy && styles.dim]}><Text style={styles.actionText}>{roomSettingsBusy ? 'Deleting…' : deleteRoomConfirm ? 'Confirm delete room' : 'Delete this room'}</Text></Pressable>{deleteRoomConfirm && <Pressable onPress={() => setDeleteRoomConfirm(false)}><Text style={styles.link}>Cancel</Text></Pressable>}</View></View>
      </View>}
      <TextInput accessibilityLabel="Search messages" style={styles.input} value={messageSearch} onChangeText={setMessageSearch} placeholder="Search messages in this chat" returnKeyType="search" />
      <ScrollView ref={messageScroll} onContentSizeChange={() => messageScroll.current?.scrollToEnd({ animated: true })} style={styles.chatMessages} contentContainerStyle={styles.chatMessagesContent} nestedScrollEnabled>
        {messages.length === 0 ? <View style={styles.chatEmpty}><Text style={styles.chatEmptyIcon}>☕</Text><Text style={styles.emptyTitle}>Start the conversation</Text><Text style={styles.muted}>Send a message, photo, video, or voice note.</Text></View> : filteredMessages.length === 0 ? <View style={styles.chatEmpty}><Text style={styles.emptyTitle}>No matching messages</Text><Text style={styles.muted}>Try another search.</Text></View> : filteredMessages.map(message => {
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
      <View style={styles.chatComposer}>{!!replyTo && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#EFF6FF', borderRadius: 10, padding: 9 }}><View style={{ flex: 1 }}><Text style={{ color: colors.blue, fontSize: 10, fontWeight: '800' }}>Replying to {replyTo.sender_name}</Text><Text numberOfLines={1} style={styles.muted}>{replyTo.body || (replyTo.media_type ? `${replyTo.media_type} attachment` : '')}</Text></View><Pressable accessibilityLabel="Cancel reply" onPress={() => setReplyTo(null)}><Text style={styles.link}>×</Text></Pressable></View>}{roomMembers.some(member => member.member_id !== session.user.id) && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, alignItems: 'center' }}><Text style={styles.muted}>Mention:</Text>{roomMembers.filter(member => member.member_id !== session.user.id && member.username).map(member => <Pressable key={member.member_id} onPress={() => setDraft(current => `${current}${current && !current.endsWith(' ') ? ' ' : ''}@${member.username} `)} style={styles.chatTool}><Text style={styles.chatToolText}>@{member.username}</Text></Pressable>)}</ScrollView>}<View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>{QUICK_EMOJIS.map(emoji => <Pressable key={emoji} accessibilityLabel={`Insert ${emoji}`} onPress={() => setDraft(current => `${current}${emoji}`)} style={{ paddingHorizontal: 5, paddingVertical: 3 }}><Text style={{ fontSize: 18 }}>{emoji}</Text></Pressable>)}</View><View style={styles.chatTools}><Pressable accessibilityLabel="Add photo or video" onPress={chooseFile} style={styles.chatTool}><Text style={styles.chatToolText}>＋ Media</Text></Pressable><Pressable accessibilityLabel={recording ? 'Stop voice recording' : 'Record voice message'} onPress={recording ? stopVoiceRecording : () => void startVoiceRecording()} style={[styles.chatTool, recording && styles.recordingTool]}><Text style={[styles.chatToolText, recording && styles.recordingText]}>{recording ? '■ Stop' : '● Voice'}</Text></Pressable></View>{Platform.OS === 'web' && <input ref={fileInput} type="file" accept="image/*,video/*" onChange={handleFileSelection} aria-label="Choose a photo or video" style={{ position: 'fixed', width: 1, height: 1, opacity: 0, overflow: 'hidden', left: -100, bottom: 0 }} />}<View style={styles.chatInputRow}><TextInput style={styles.chatInput} multiline maxLength={1000} value={draft} onChangeText={setDraft} placeholder="Message the team…"/><Pressable accessibilityLabel="Send message" disabled={sending || (!draft.trim() && !file)} onPress={() => void sendMessage()} style={[styles.sendButton, (sending || (!draft.trim() && !file)) && styles.dim]}><Text style={styles.sendButtonText}>{sending ? '…' : '↑'}</Text></Pressable></View></View>
    </>}
    <Modal visible={!!incomingCall} transparent animationType="fade" onRequestClose={declineCall}><View style={styles.mediaOverlay}><View style={styles.callModal}><View style={styles.callAvatar}><Text style={styles.callAvatarText}>{incomingCall?.mode === 'video' ? '▣' : '☎'}</Text></View><Text style={styles.sectionTitle}>{incomingCall?.mode === 'video' ? 'Incoming video call' : 'Incoming voice call'}</Text><Text style={styles.muted}>{incomingCall?.group ? `${incomingCall.fromName} started a group call in ${selectedRoom?.room_name ?? 'this room'}.` : `${incomingCall?.fromName || 'Someone'} is calling you.`}</Text><View style={styles.callModalActions}><Pressable accessibilityRole="button" onPress={declineCall} style={[styles.callControl, styles.callDecline]}><Text style={styles.callControlText}>Decline</Text></Pressable><Pressable accessibilityRole="button" onPress={() => void acceptCall()} style={[styles.callControl, styles.callAccept]}><Text style={styles.callControlText}>Accept</Text></Pressable></View></View></View></Modal>
    <Modal visible={!!activeCall} transparent animationType="fade" onRequestClose={() => endCall()}><View style={styles.mediaOverlay}><View style={styles.callModal}>
      <View style={styles.cardHeading}><Text style={styles.sectionTitle}>{activeCall?.group ? `${selectedRoom?.room_name ?? 'Room'} call` : activeCall?.mode === 'video' ? 'Video call' : 'Voice call'}</Text><Text style={styles.onlineBadge}>{activeCall?.status.toUpperCase()}</Text></View>
      <Text style={styles.muted}>{activeCall?.group ? `${callPeers.length + 1} participant${callPeers.length === 0 ? '' : 's'} · ${activeCall?.mode === 'video' ? 'video' : 'voice'}` : activeCall?.direction === 'outgoing' ? `Calling ${activeCall.peerName}…` : `With ${activeCall?.peerName}`}</Text>
      {Platform.OS === 'web' && activeCall?.mode === 'video' ? <View style={[styles.callVideoStage, activeCall.group && styles.groupCallVideoStage]}>
        <View style={[styles.callVideoTile, activeCall.group && styles.groupCallVideoTile]}>{React.createElement('video', { ref: (node: HTMLVideoElement | null) => { localCallVideo.current = node; if (node) node.srcObject = localCallStream; }, autoPlay: true, muted: true, playsInline: true, 'data-office-call-media': 'true', style: { width: '100%', height: '100%', objectFit: 'cover', transform: cameraFacing === 'user' ? 'scaleX(-1)' : undefined, background: '#0F172A' } })}<Text style={styles.callVideoLabel}>You{cameraDisabled ? ' · camera off' : ''}</Text></View>
        {activeCall.group ? Object.entries(groupCallStreams).map(([peerId, stream]) => { const peer = callPeers.find(item => item.id === peerId); return <View key={peerId} style={[styles.callVideoTile, activeCall.group && styles.groupCallVideoTile]}>{React.createElement('video', { ref: (node: HTMLVideoElement | null) => { if (node) node.srcObject = stream; }, autoPlay: true, playsInline: true, 'data-office-call-media': 'true', style: { width: '100%', height: '100%', objectFit: 'cover', background: '#0F172A' } })}<Text style={styles.callVideoLabel}>{peer?.name ?? 'Room member'}</Text></View>; }) : <View style={[styles.callVideoTile, activeCall.group && styles.groupCallVideoTile]}>{React.createElement('video', { ref: (node: HTMLVideoElement | null) => { remoteCallVideo.current = node; if (node) node.srcObject = remoteCallStream; }, autoPlay: true, playsInline: true, 'data-office-call-media': 'true', style: { width: '100%', height: '100%', objectFit: 'cover', background: '#0F172A' } })}{!remoteCallStream && <Text style={styles.callVideoWaiting}>Waiting for video…</Text>}<Text style={styles.callVideoLabel}>{activeCall.peerName}</Text></View>}
        {activeCall.group && Object.keys(groupCallStreams).length === 0 && <Text style={styles.callVideoWaiting}>Waiting for room members…</Text>}
      </View> : <View style={styles.callVoiceStage}><View style={styles.callAvatar}><Text style={styles.callAvatarText}>{activeCall?.group ? '👥' : '☎'}</Text></View><Text style={styles.callPeerName}>{activeCall?.group ? selectedRoom?.room_name : activeCall?.peerName}</Text><Text style={styles.muted}>{activeCall?.group ? callPeers.map(peer => peer.name).join(' · ') || 'Waiting for members to join' : activeCall?.status}</Text></View>}
      {Platform.OS === 'web' && activeCall?.mode === 'voice' && (activeCall.group ? Object.entries(groupCallStreams).map(([peerId, stream]) => React.createElement('video', { key: peerId, ref: (node: HTMLVideoElement | null) => { if (node) node.srcObject = stream; }, autoPlay: true, playsInline: true, 'data-office-call-media': 'true', style: { display: 'none' } })) : React.createElement('video', { ref: (node: HTMLVideoElement | null) => { remoteCallVideo.current = node; if (node) node.srcObject = remoteCallStream; }, autoPlay: true, playsInline: true, 'data-office-call-media': 'true', style: { display: 'none' } }))}
      {!!callError && <Text style={styles.callError}>{callError}</Text>}
      <View style={styles.callModalActions}><Pressable accessibilityRole="button" onPress={toggleCallMute} style={[styles.callControl, callMuted && styles.callControlMuted]}><Text style={styles.callControlText}>{callMuted ? 'Unmute mic' : 'Mute mic'}</Text></Pressable><Pressable accessibilityRole="button" onPress={toggleCallSpeaker} style={styles.callControl}><Text style={styles.callControlText}>{speakerMode ? 'Speaker' : 'Normal audio'}</Text></Pressable>{activeCall?.mode === 'video' && <><Pressable accessibilityRole="button" onPress={toggleCallCamera} style={[styles.callControl, cameraDisabled && styles.callControlMuted]}><Text style={styles.callControlText}>{cameraDisabled ? 'Camera on' : 'Camera off'}</Text></Pressable><Pressable accessibilityRole="button" onPress={() => void switchCallCamera()} style={styles.callControl}><Text style={styles.callControlText}>{cameraFacing === 'user' ? 'Back camera' : 'Front camera'}</Text></Pressable></>}<Pressable accessibilityRole="button" onPress={() => endCall()} style={[styles.callControl, styles.callDecline]}><Text style={styles.callControlText}>{activeCall?.group && activeCall.hostId !== session?.user?.id ? 'Leave call' : 'End call'}</Text></Pressable></View>
    </View></View></Modal>
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
  return <SafeAreaView style={styles.safe}><StatusBar style="dark"/><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.authWrap}><View style={styles.authCard}><Image accessibilityLabel="Milo app icon" source={require('./assets/milo-icon.png')} style={{ width: 64, height: 64, borderRadius: 18, alignSelf: 'center' }}/><Text style={styles.title}>{authMode === 'signup' ? 'Create your account' : 'Welcome to Milo'}</Text><Text style={styles.subtitle}>{authMode === 'signup' ? 'Sign up with your email, password, and a username others can use to find you.' : 'Log in with your email and password.'}</Text>{authMode === 'signup' && <TextInput style={styles.input} placeholder="Username (3–24 characters)" autoCapitalize="none" autoCorrect={false} value={username} onChangeText={value => { setUsername(value); setAuthMessage(''); }} maxLength={24}/>}<TextInput style={styles.input} placeholder="Email address (Gmail is supported)" autoCapitalize="none" keyboardType="email-address" autoComplete="email" value={email} onChangeText={value => { setEmail(value); setAuthMessage(''); }}/><TextInput style={styles.input} placeholder="Password" secureTextEntry autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'} value={password} onChangeText={value => { setPassword(value); setAuthMessage(''); }}/><Pressable style={[styles.action, styles.primary]} onPress={() => void submitAccount()} disabled={busy || !email.trim() || !password || (authMode === 'signup' && !username.trim())}><Text style={styles.actionText}>{busy ? 'Please wait…' : authMode === 'signup' ? 'Sign up' : 'Log in'}</Text></Pressable><Pressable style={styles.textButton} onPress={() => { setAuthMode(current => current === 'login' ? 'signup' : 'login'); setAuthMessage(''); }}><Text style={styles.outlineText}>{authMode === 'signup' ? 'Already have an account? Log in' : 'New here? Create an account'}</Text></Pressable>{!!authMessage && <Text accessibilityRole="alert" style={{ color: authMessage.startsWith('Account created') ? '#15803D' : '#B91C1C', fontSize: 12, lineHeight: 18 }}>{authMessage}</Text>}<View style={styles.chatJoinDivider}><View style={styles.chatDividerLine}/><Text style={styles.muted}>OR CHAT AS A GUEST</Text><View style={styles.chatDividerLine}/></View><TextInput style={styles.input} placeholder="Chat display name" autoCapitalize="words" value={guestName} onChangeText={value => { setGuestName(value); setGuestError(''); }} maxLength={40}/><Pressable style={[styles.action, styles.guestAction]} disabled={busy || !guestName.trim()} onPress={() => void joinGuestChat()}><Text style={styles.guestActionText}>{busy ? 'Please wait…' : 'Join Milo chat'}</Text></Pressable>{!!guestError && <Text accessibilityRole="alert" style={{ color: '#B91C1C', fontSize: 12, lineHeight: 18 }}>{guestError}</Text>}<Pressable style={styles.textButton} onPress={onContinue}><Text style={styles.muted}>Continue in offline mode</Text></Pressable></View></KeyboardAvoidingView></SafeAreaView>;
}

type MemoryTile = { id: number; pairKey: string; symbol?: string; faceSource?: ImageSourcePropType; matched: boolean };
const gameFaceImages: ImageSourcePropType[] = [
  require('./assets/game-faces/face-01.jpeg'), require('./assets/game-faces/face-02.jpeg'),
  require('./assets/game-faces/face-03.jpeg'), require('./assets/game-faces/face-04.jpeg'),
  require('./assets/game-faces/face-05.jpg'), require('./assets/game-faces/face-06.jpg'),
  require('./assets/game-faces/face-07.jpeg'),
];
const memoryAnimals = ['🐼', '🦊', '🐸', '🐳', '🦁', '🐵', '🐧', '🐢', '🐨', '🦉', '🐰', '🦒', '🦋', '🐙', '🦓', '🐝', '🐬'];
function memoryPairCatalog() {
  return [
    ...gameFaceImages.map((faceSource, index) => ({ pairKey: `face-${index}`, faceSource })),
    ...memoryAnimals.map(symbol => ({ pairKey: `animal-${symbol}`, symbol })),
  ];
}
function newMemoryDeck(pairCount: number): MemoryTile[] {
  const pairs = memoryPairCatalog().slice(0, pairCount);
  const deck = pairs.flatMap((pair, index) => [
    { ...pair, id: index * 2, matched: false }, { ...pair, id: index * 2 + 1, matched: false },
  ]);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function GamesHub({ session }: { session: any }) {
  const [selectedGame, setSelectedGame] = useState<'memory' | 'ludo'>(() => typeof window !== 'undefined' && new URL(window.location.href).searchParams.has('ludo') ? 'ludo' : 'memory');
  return <View style={{ gap: 12 }}>
    <View style={styles.difficultyRow}>
      <Pressable onPress={() => setSelectedGame('memory')} style={[styles.difficultyButton, selectedGame === 'memory' && styles.difficultySelected]}><Text style={[styles.difficultyText, selectedGame === 'memory' && styles.difficultyTextSelected]}>Memory Match</Text></Pressable>
      <Pressable onPress={() => setSelectedGame('ludo')} style={[styles.difficultyButton, selectedGame === 'ludo' && styles.difficultySelected]}><Text style={[styles.difficultyText, selectedGame === 'ludo' && styles.difficultyTextSelected]}>Ludo</Text></Pressable>
    </View>
    {selectedGame === 'memory' ? <MemoryMatchGame session={session}/> : <LudoGame session={session}/>}
  </View>;
}

const ludoColors = ['#E74C3C', '#27AE60', '#F1C40F', '#3498DB', '#9B59B6', '#E67E22'];
const ludoSixColors = [ludoColors[3], ludoColors[2], ludoColors[4], ludoColors[0], ludoColors[1], ludoColors[5]];
const ludoColorFor = (playerIndex: number, playerCount: LudoPlayerCount) => playerCount > 4 ? ludoSixColors[playerIndex % 6] : ludoColors[playerIndex % ludoColors.length];
// Four-player starts follow the classic board; six-player seats follow the uploaded board's order.
type LudoPlayerCount = 2 | 3 | 4 | 5 | 6;
const ludoStarts: Record<LudoPlayerCount, number[]> = {
  2: [41, 28], 3: [41, 28, 15], 4: [41, 28, 15, 2],
  5: [0, 9, 18, 27, 36], 6: [0, 9, 18, 27, 36, 44],
};
// The four non-entry safety squares are marked with stars like the reference board.
const ludoStarSquares = [10, 23, 36, 49];
const ludoSixStarSquares = [4, 13, 22, 31, 40, 48];
const ludoSafeSquaresFor = (playerCount: LudoPlayerCount) => [...new Set([...ludoStarts[playerCount], ...(playerCount > 4 ? ludoSixStarSquares : ludoStarSquares)])];
function ludoTokenCanMove(tokens: number[][], playerIndex: number, tokenIndex: number, die: number, playerCount: LudoPlayerCount) {
  const position = tokens[playerIndex]?.[tokenIndex];
  if (position === undefined || position >= 57) return false;
  if (position < 0 && die !== 6) return false;
  const destination = position < 0 ? 0 : position + die;
  if (destination > 57) return false;
  const firstStep = position < 0 ? 0 : position + 1;
  const safeSquares = ludoSafeSquaresFor(playerCount);
  for (let step = firstStep; step <= Math.min(destination, 51); step += 1) {
    const square = (ludoStarts[playerCount][playerIndex] + step) % 52;
    // A blockade on a safe square must not prevent a piece from entering or
    // passing through that square. Keep this in sync with the SQL validator.
    if (safeSquares.includes(square)) continue;
    const opposingPieces = tokens.reduce((total, otherTokens, otherPlayer) => otherPlayer === playerIndex ? total : total + otherTokens.filter(otherPosition => otherPosition >= 0 && otherPosition < 52 && (ludoStarts[playerCount][otherPlayer] + otherPosition) % 52 === square).length, 0);
    if (opposingPieces >= 2) return false;
  }
  return true;
}
const ludoProgressLabel = (position: number) => position < 0 ? 'Yard' : position >= 52 ? `Home ${position - 51}/6` : `Track ${position + 1}/52`;
const ludoTrackCoords: [number, number][] = [
  [7,0],[6,0],[6,1],[6,2],[6,3],[6,4],[6,5],[5,6],[4,6],[3,6],[2,6],[1,6],[0,6],
  [0,7],[0,8],[1,8],[2,8],[3,8],[4,8],[5,8],[6,9],[6,10],[6,11],[6,12],[6,13],[6,14],
  [7,14],[8,14],[8,13],[8,12],[8,11],[8,10],[8,9],[9,8],[10,8],[11,8],[12,8],[13,8],[14,8],
  [14,7],[14,6],[13,6],[12,6],[11,6],[10,6],[9,6],[8,5],[8,4],[8,3],[8,2],[8,1],[8,0],
];
const ludoYardCoords: [number, number][][] = [
  // Fractional grid positions place waiting tokens at the exact centers of the symmetric 2×2 yard circles.
  [[10.5,1.5],[10.5,3.5],[12.5,1.5],[12.5,3.5]],
  [[10.5,10.5],[10.5,12.5],[12.5,10.5],[12.5,12.5]],
  [[1.5,10.5],[1.5,12.5],[3.5,10.5],[3.5,12.5]],
  [[1.5,1.5],[1.5,3.5],[3.5,1.5],[3.5,3.5]],
  [[1,6],[1,8],[4,6],[4,8]], [[10,6],[10,8],[13,6],[13,8]],
];
const ludoHomeLanes: [number, number][][] = [
  [[13,7],[12,7],[11,7],[10,7],[9,7],[8,7]], [[7,13],[7,12],[7,11],[7,10],[7,9],[7,8]],
  [[1,7],[2,7],[3,7],[4,7],[5,7],[6,7]], [[7,1],[7,2],[7,3],[7,4],[7,5],[7,6]],
  [[6,13],[6,12],[6,11],[6,10],[6,9],[6,8]], [[8,1],[8,2],[8,3],[8,4],[8,5],[8,6]],
];

type LudoBoardPlayer = { id: string; username: string; tokens: number[]; index: number };
const sixSideLengths = [9, 9, 9, 9, 8, 8];
const sixEntryPoints: [number, number][] = [[50,72],[28,85],[5,50],[28,12],[71,12],[94,50]];
const sixPoint = (from: [number, number], to: [number, number], progress: number): [number, number] => [from[0] + (to[0] - from[0]) * progress, from[1] + (to[1] - from[1]) * progress];
const sixTrackCoords: [number, number][] = sixSideLengths.flatMap((length, side) => Array.from({ length }, (_, step) => {
  return sixPoint(sixEntryPoints[side], sixEntryPoints[(side + 1) % 6], step / length);
}));
function SixPlayerLudoBoard({ playerCount, players, legalTokenIndices, selectablePlayerId, diceValue, onMove }: { playerCount: LudoPlayerCount; players: LudoBoardPlayer[]; legalTokenIndices: number[]; selectablePlayerId: string; diceValue: number | null; onMove: (playerId: string, tokenIndex: number) => void }) {
  const [boardSize, setBoardSize] = useState(0);
  const yardPoint = (playerIndex: number, tokenIndex: number): [number, number] => {
    const circles: [number, number][][] = [
      [[44.6,81.3],[54.7,81.3],[49.7,76.9],[49.7,85.3]],
      [[14.6,61.5],[24.3,61.5],[19.4,65.1],[19.4,70.6]],
      [[19.2,24.4],[19.2,28.6],[14.7,31.9],[24.6,31.9]],
      [[44.9,8.6],[54.9,8.8],[49.7,12.6],[49.7,18.8]],
      [[80.6,23.8],[75.0,28.6],[80.6,31.9],[85.4,31.9]],
      [[74.6,62.2],[85.3,62.2],[79.9,65.6],[79.9,70.8]],
    ];
    return circles[playerIndex]?.[tokenIndex] ?? [50, 50];
  };
  const homePoint = (playerIndex: number, laneIndex: number): [number, number] => {
    const point = sixEntryPoints[playerIndex];
    const inwardProgress = 0.14 + laneIndex * 0.14;
    return sixPoint(point, [50,50], inwardProgress);
  };
  const positionFor = (player: LudoBoardPlayer, position: number, tokenIndex: number): [number, number] => {
    if (position < 0) return yardPoint(player.index, tokenIndex);
    if (position >= 52) return homePoint(player.index, Math.min(5, position - 52));
    const trackIndex = (ludoStarts[playerCount][player.index] + position) % 52;
    return sixTrackCoords[trackIndex];
  };
  return <View style={{ width: '100%', maxWidth: 480, alignSelf: 'center', gap: 6 }}>
    <View onLayout={event => setBoardSize(event.nativeEvent.layout.width)} style={{ width: '100%', aspectRatio: 1, borderRadius: 22, overflow: 'hidden', backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#cbd5e1', position: 'relative' }}>
      <Image source={require('./assets/ludo-six-player-board.jpg')} resizeMode="cover" style={{ position: 'absolute', width: '100%', height: '100%' }} />
      {Array.from({ length: 6 }, (_, playerIndex) => Array.from({ length: 4 }, (_, tokenIndex) => {
        const player = players.find(item => item.index === playerIndex);
        const position = player?.tokens[tokenIndex];
        if (playerIndex < playerCount && (position === undefined || position < 0)) return null;
        const [x,y] = yardPoint(playerIndex, tokenIndex);
        const maskSize = Math.max(20, boardSize * 0.065);
        return <View key={`six-yard-mask-${playerIndex}-${tokenIndex}`} pointerEvents="none" style={{ position: 'absolute', left: `${x}%`, top: `${y}%`, width: maskSize, height: maskSize, marginLeft: -maskSize / 2, marginTop: -maskSize / 2, borderRadius: maskSize / 2, backgroundColor: '#fff' }} />;
      }))}
      {players.flatMap(player => player.tokens.map((position, tokenIndex) => {
        const [x,y] = positionFor(player, position, tokenIndex);
        const selectable = player.id === selectablePlayerId && legalTokenIndices.includes(tokenIndex);
        const pieceSize = Math.max(18, boardSize * (position < 0 ? 0.07 : 0.05));
        return <Pressable key={`${player.id}-${tokenIndex}`} disabled={!selectable} onPress={() => onMove(player.id, tokenIndex)} style={[styles.ludoPiece, { left: `${x}%`, top: `${y}%`, width: pieceSize, height: pieceSize, marginLeft: -pieceSize / 2, marginTop: -pieceSize / 2, backgroundColor: position < 0 ? 'transparent' : ludoSixColors[player.index % ludoSixColors.length], borderWidth: selectable ? 2.5 : 0, borderColor: selectable ? '#111827' : 'transparent', elevation: position < 0 ? 0 : 3 }, selectable && styles.ludoPieceSelectable]}>{position >= 0 && <Text style={styles.ludoPieceText}>{tokenIndex + 1}</Text>}</Pressable>;
      }))}
    </View>{diceValue !== null && <Text style={{ color: colors.text, fontSize: 13, fontWeight: '800', textAlign: 'center' }}>🎲 Dice: {diceValue}</Text>}
  </View>;
}
function LudoBoard({ playerCount, players, legalTokenIndices, selectablePlayerId, diceValue, onMove }: { playerCount: LudoPlayerCount; players: LudoBoardPlayer[]; legalTokenIndices: number[]; selectablePlayerId: string; diceValue: number | null; onMove: (playerId: string, tokenIndex: number) => void }) {
  const [boardSize, setBoardSize] = useState(0);
  if (playerCount > 4) return <SixPlayerLudoBoard playerCount={playerCount} players={players} legalTokenIndices={legalTokenIndices} selectablePlayerId={selectablePlayerId} diceValue={diceValue} onMove={onMove} />;
  const triangleHalf = boardSize / 10;
  const safeSquares = ludoSafeSquaresFor(playerCount);
  const baseColor = (row: number, col: number) => row < 6 && col < 6 ? ludoColors[3] : row < 6 && col > 8 ? ludoColors[2] : row > 8 && col < 6 ? ludoColors[0] : row > 8 && col > 8 ? ludoColors[1] : null;
  const cellColor = (row: number, col: number) => {
    if (row === 7 && col >= 1 && col <= 5) return ludoColors[3];
    if (row === 7 && col >= 9 && col <= 13) return ludoColors[1];
    if (col === 7 && row >= 1 && row <= 5) return ludoColors[2];
    if (col === 7 && row >= 9 && row <= 13) return ludoColors[0];
    if (row === 6 && col === 6) return ludoColors[3];
    if (row === 6 && col >= 7 && col <= 8) return ludoColors[2];
    if (row === 7 && col === 6) return ludoColors[3];
    if (row === 7 && col === 8) return ludoColors[1];
    if (row === 8 && col >= 6 && col <= 8) return ludoColors[0];
    return baseColor(row, col);
  };
  const yards = playerCount === 4 ? ludoYardCoords.slice(0, 4) : ludoYardCoords;
  const homeLanes = playerCount === 4 ? ludoHomeLanes.slice(0, 4) : ludoHomeLanes;
  const coordinates = (player: LudoBoardPlayer, position: number, tokenIndex: number): [number, number] => {
    if (position < 0) return yards[player.index]?.[tokenIndex] ?? [7,7];
    if (position >= 52) return homeLanes[player.index]?.[position - 52] ?? [7,7];
    const pathIndex = (ludoStarts[playerCount][player.index] + position) % 52;
    return ludoTrackCoords[pathIndex];
  };
  const baseBoxes = [
    { row: 9, col: 0, color: ludoColors[0] }, { row: 9, col: 9, color: ludoColors[1] },
    { row: 0, col: 9, color: ludoColors[2] }, { row: 0, col: 0, color: ludoColors[3] },
  ];
  return <View style={{ width: '100%', maxWidth: 420, alignSelf: 'center', gap: 6 }}><View style={styles.ludoBoard} onLayout={event => setBoardSize(event.nativeEvent.layout.width)}>
    <View style={styles.ludoGrid}>{Array.from({ length: 15 }, (_, row) => <View key={`row-${row}`} style={styles.ludoGridRow}>{Array.from({ length: 15 }, (_, col) => {
      const color = cellColor(row, col); const pathIndex = ludoTrackCoords.findIndex(([r,c]) => r === row && c === col); const isSafe = pathIndex >= 0 && safeSquares.includes(pathIndex); const isStar = isSafe;
      return <View key={`cell-${row}-${col}`} style={[styles.ludoGridCell, color ? { backgroundColor: color } : styles.ludoGridBlank, pathIndex >= 0 && !color && styles.ludoPathCell, isSafe && styles.ludoSafeCell]}>{isStar && <Text style={styles.ludoSafeStar}>☆</Text>}</View>;
    })}</View>)}</View>
    <View pointerEvents="none" style={styles.ludoCenterMark}>
      <View style={{ position: 'absolute', top: 0, left: 0, width: 0, height: 0, borderLeftWidth: triangleHalf, borderRightWidth: triangleHalf, borderTopWidth: triangleHalf, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: ludoColors[2] }}/>
      <View style={{ position: 'absolute', top: 0, right: 0, width: 0, height: 0, borderTopWidth: triangleHalf, borderBottomWidth: triangleHalf, borderRightWidth: triangleHalf, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderRightColor: ludoColors[1] }}/>
      <View style={{ position: 'absolute', bottom: 0, left: 0, width: 0, height: 0, borderLeftWidth: triangleHalf, borderRightWidth: triangleHalf, borderBottomWidth: triangleHalf, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: ludoColors[0] }}/>
      <View style={{ position: 'absolute', top: 0, left: 0, width: 0, height: 0, borderTopWidth: triangleHalf, borderBottomWidth: triangleHalf, borderLeftWidth: triangleHalf, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderLeftColor: ludoColors[3] }}/>
    </View>
    {baseBoxes.map((box, index) => <View key={`base-${index}`} pointerEvents="none" style={[styles.ludoHomeBox, { left: `${box.col/15*100}%`, top: `${box.row/15*100}%`, backgroundColor: box.color }]}><View style={[styles.ludoHomeInner, { position: 'relative' }]}>{[0,1,2,3].map(i => <View key={i} style={[styles.ludoHomeDot, { position: 'absolute', backgroundColor: box.color, left: i % 2 === 0 ? '10.5%' : '54.5%', top: i < 2 ? '10.5%' : '54.5%' }]}/>)}</View></View>)}
    {players.flatMap(player => player.tokens.map((position, tokenIndex) => {
      const [row, col] = coordinates(player, position, tokenIndex);
      const x = (col + 0.5) / 15 * 100; const y = (row + 0.5) / 15 * 100;
      const selectable = player.id === selectablePlayerId && legalTokenIndices.includes(tokenIndex);
      return <Pressable key={`${player.id}-${tokenIndex}`} disabled={!selectable} onPress={() => onMove(player.id, tokenIndex)} style={[styles.ludoPiece, { left: `${x}%`, top: `${y}%`, marginLeft: -boardSize * 0.03, marginTop: -boardSize * 0.03, backgroundColor: ludoColors[player.index % ludoColors.length] }, selectable && styles.ludoPieceSelectable]}><Text style={styles.ludoPieceText}>{tokenIndex + 1}</Text></Pressable>;
    }))}
  </View>{diceValue !== null && <Text style={{ color: colors.text, fontSize: 13, fontWeight: '800', textAlign: 'center' }}>🎲 Dice: {diceValue}</Text>}</View>;
}

function LudoMoveChoices({ tokenIndices, tokens, diceValue, onChoose, disabled = false }: { tokenIndices: number[]; tokens: number[]; diceValue: number | null; onChoose: (tokenIndex: number) => void; disabled?: boolean }) {
  if (diceValue === null || tokenIndices.length === 0) return null;
  return <View style={styles.ludoMoveChoicePanel}>
    <Text style={styles.sectionTitle}>Choose a token to move {diceValue} {diceValue === 1 ? 'space' : 'spaces'}</Text>
    <View style={styles.ludoMoveChoices}>{tokenIndices.map(tokenIndex => <Pressable key={tokenIndex} accessibilityRole="button" accessibilityLabel={`Move token ${tokenIndex + 1}, currently ${ludoProgressLabel(tokens[tokenIndex])}`} disabled={disabled} onPress={() => onChoose(tokenIndex)} style={[styles.ludoMoveChoice, disabled && styles.dim]}>
      <Text style={styles.ludoMoveChoiceTitle}>Move token {tokenIndex + 1}</Text>
      <Text style={styles.ludoMoveChoiceSubtitle}>{tokens[tokenIndex] < 0 ? 'Leave the yard' : ludoProgressLabel(tokens[tokenIndex])}</Text>
    </Pressable>)}</View>
  </View>;
}

function freshLocalLudo(playerCount: LudoPlayerCount, names?: string[], forfeitTripleSix = true) {
  return { playerCount, names: Array.from({ length: playerCount }, (_, index) => names?.[index] || `Player ${index + 1}`), tokens: Array.from({ length: playerCount }, () => [-1, -1, -1, -1]), turnIndex: 0, diceValue: null as number | null, winnerIndex: null as number | null, sixStreak: 0, forfeitTripleSix };
}

function LudoGame({ session }: { session: any }) {
  const [playMode, setPlayMode] = useState<'offline' | 'online'>('offline');
  const [playerCount, setPlayerCount] = useState<LudoPlayerCount>(4);
  const [forfeitTripleSix, setForfeitTripleSix] = useState(true);
  const [localGame, setLocalGame] = useState(() => freshLocalLudo(4));
  const [inviteText, setInviteText] = useState('');
  const [publicRoomName, setPublicRoomName] = useState('');
  const [publicRoomPassword, setPublicRoomPassword] = useState('');
  const [publicRooms, setPublicRooms] = useState<any[]>([]);
  const [roomJoinPasswords, setRoomJoinPasswords] = useState<Record<string, string>>({});
  const [myUsername, setMyUsername] = useState('');
  const [receivedInvites, setReceivedInvites] = useState<any[]>([]);
  const [ludoMatch, setLudoMatch] = useState<any>(null);
  const [ludoMessage, setLudoMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const pendingLudoAction = useRef(false);

  const localLegalMoves = localGame.diceValue === null ? [] : localGame.tokens[localGame.turnIndex].map((_position, index) => ludoTokenCanMove(localGame.tokens, localGame.turnIndex, index, localGame.diceValue!, localGame.playerCount) ? index : -1).filter(index => index >= 0);

  function startLocalGame(count: LudoPlayerCount) {
    setLocalGame(current => freshLocalLudo(count, current.names, forfeitTripleSix));
  }

  function rollLocalDice() {
    if (localGame.diceValue !== null || localGame.winnerIndex !== null) return;
    const rolled = Math.floor(Math.random() * 6) + 1;
    if (rolled === 6 && localGame.forfeitTripleSix && localGame.sixStreak >= 2) {
      setLocalGame(current => ({ ...current, turnIndex: (current.turnIndex + 1) % current.playerCount, diceValue: null, sixStreak: 0 }));
      setLudoMessage('Third consecutive six forfeited · turn passes.');
      return;
    }
    const legal = localGame.tokens[localGame.turnIndex].some((_position, index) => ludoTokenCanMove(localGame.tokens, localGame.turnIndex, index, rolled, localGame.playerCount));
    setLocalGame(current => ({ ...current, diceValue: rolled, sixStreak: rolled === 6 ? current.sixStreak + 1 : 0 }));
    if (!legal) setLudoMessage(`Player ${localGame.turnIndex + 1} rolled ${rolled} · no legal move.`);
    else setLudoMessage('');
  }

  function moveLocalToken(tokenIndex: number) {
    if (localGame.diceValue === null || !localLegalMoves.includes(tokenIndex)) return;
    setLocalGame(current => {
      const tokens = current.tokens.map(playerTokens => [...playerTokens]);
      const dice = current.diceValue!; const playerIndex = current.turnIndex; const oldPosition = tokens[playerIndex][tokenIndex];
      const destination = oldPosition < 0 ? 0 : oldPosition + dice;
      tokens[playerIndex][tokenIndex] = destination;
      let captured = false;
      if (destination < 52) {
        const globalSquare = (ludoStarts[current.playerCount][playerIndex] + destination) % 52;
        if (!ludoSafeSquaresFor(current.playerCount).includes(globalSquare)) {
          tokens.forEach((opponent, otherIndex) => {
            if (otherIndex === playerIndex) return;
            opponent.forEach((position, otherToken) => {
              if (position >= 0 && position < 52 && (ludoStarts[current.playerCount][otherIndex] + position) % 52 === globalSquare) { tokens[otherIndex][otherToken] = -1; captured = true; }
            });
          });
        }
      }
      const wins = tokens[playerIndex].every(position => position === 57);
      return { ...current, tokens, diceValue: null, winnerIndex: wins ? playerIndex : null, turnIndex: wins || dice === 6 || captured ? playerIndex : (playerIndex + 1) % current.playerCount, sixStreak: dice === 6 ? current.sixStreak : 0 };
    });
    setLudoMessage('');
  }

  function skipLocalTurn() {
    if (localGame.diceValue === null || localLegalMoves.length) return;
    setLocalGame(current => ({ ...current, turnIndex: current.diceValue === 6 ? current.turnIndex : (current.turnIndex + 1) % current.playerCount, diceValue: null, sixStreak: current.diceValue === 6 ? current.sixStreak : 0 }));
  }

  const loadMatch = useCallback(async (id: string) => {
    if (!supabase) return;
    const { data, error } = await supabase.from('ludo_matches').select('*').eq('id', id).maybeSingle();
    if (error) { setLudoMessage(error.message); return; }
    if (!data) { setLudoMessage('That Ludo invite link is invalid or you are not invited.'); return; }
    setLudoMatch(data); setForfeitTripleSix(data.forfeit_triple_six ?? true); setLudoMessage('');
    if (typeof window !== 'undefined' && new URL(window.location.href).searchParams.has('ludo')) {
      const url = new URL(window.location.href); url.searchParams.delete('ludo'); window.history.replaceState({}, '', url.toString());
    }
  }, []);

  const refreshInvites = useCallback(async () => {
    if (!supabase || !session) return;
    const { data } = await supabase.from('ludo_matches').select('*').eq('status', 'waiting').order('created_at', { ascending: false });
    setReceivedInvites((data ?? []).filter((item: any) => item.invitee_ids?.includes(session.user.id) && !item.accepted_ids?.includes(session.user.id) && !item.declined_ids?.includes(session.user.id)));
  }, [session]);

  const refreshPublicRooms = useCallback(async () => {
    if (!supabase || !session) return;
    const { data } = await supabase.rpc('list_public_ludo_rooms');
    if (data) setPublicRooms(data);
  }, [session]);

  useEffect(() => {
    if (!supabase || !session) return;
    void supabase.from('profiles').select('username').eq('id', session.user.id).maybeSingle().then(({ data }) => setMyUsername(data?.username ?? ''));
    void refreshInvites();
    void refreshPublicRooms();
    const roomRefresh = setInterval(() => void refreshPublicRooms(), 8000);
    const channel = supabase.channel(`ludo-invites-${session.user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ludo_matches' }, () => void refreshInvites()).subscribe();
    const url = typeof window !== 'undefined' ? new URL(window.location.href) : null;
    const matchId = url?.searchParams.get('ludo');
    if (matchId) void loadMatch(matchId);
    return () => { clearInterval(roomRefresh); void supabase?.removeChannel(channel); };
  }, [session, refreshInvites, refreshPublicRooms, loadMatch]);

  useEffect(() => {
    if (!supabase || !ludoMatch?.id) return;
    const channel = supabase.channel(`ludo-match-${ludoMatch.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'ludo_matches', filter: `id=eq.${ludoMatch.id}` }, () => void loadMatch(ludoMatch.id)).subscribe();
    return () => { void supabase?.removeChannel(channel); };
  }, [ludoMatch?.id, loadMatch]);

  async function createGuest() {
    if (!supabase) { setLudoMessage('Connect Supabase before creating a guest username.'); return; }
    setBusy(true);
    const { error } = await supabase.auth.signInAnonymously({ options: { data: { full_name: `Guest ${Math.random().toString(36).slice(2, 6)}` } } });
    setBusy(false); setLudoMessage(error?.message ?? 'Guest profile created. Loading your unique username…');
  }

  async function createRoom() {
    if (!supabase || !session) { setLudoMessage('Create a guest username or sign in before inviting players.'); return; }
    const usernames = inviteText.split(/[\s,;]+/).map(item => item.trim().replace(/^@/, '')).filter(Boolean);
    if (usernames.length !== playerCount - 1) { setLudoMessage(`Enter exactly ${playerCount - 1} usernames for a ${playerCount}-player game.`); return; }
    setBusy(true); setLudoMessage('Sending Ludo invitations…');
    const { data, error } = await supabase.rpc('create_ludo_invite', { username_list_in: usernames, player_count_in: playerCount, forfeit_triple_six_in: forfeitTripleSix });
    setBusy(false);
    if (error) { setLudoMessage(error.message); return; }
    setInviteText(''); setLudoMessage('Invitations sent. The game starts when all players accept.');
    if (data) void loadMatch(data as string);
  }

  async function createPublicRoom() {
    if (!supabase || !session) { setLudoMessage('Create a guest username or sign in before opening a room.'); return; }
    setBusy(true); setLudoMessage('Creating your room…');
    const { data, error } = await supabase.rpc('create_public_ludo_room', {
      room_name_in: publicRoomName.trim(), password_in: publicRoomPassword,
      player_count_in: playerCount, forfeit_triple_six_in: forfeitTripleSix,
    });
    setBusy(false);
    if (error) { setLudoMessage(error.message); return; }
    setPublicRoomName(''); setPublicRoomPassword('');
    setLudoMessage('Room created. It will start when all seats are filled.');
    await refreshPublicRooms();
    if (data) void loadMatch(data as string);
  }

  async function joinPublicRoom(roomId: string) {
    if (!supabase || !session) return;
    setBusy(true);
    const { error } = await supabase.rpc('join_public_ludo_room', {
      match_id_in: roomId, password_in: roomJoinPasswords[roomId] ?? '',
    });
    setBusy(false);
    if (error) { setLudoMessage(error.message); return; }
    setLudoMessage('You joined the room.');
    await refreshPublicRooms();
    void loadMatch(roomId);
  }

  async function replyInvite(matchId: string, accept: boolean) {
    const { error } = await supabase!.rpc('respond_ludo_invite', { match_id_in: matchId, accept_in: accept });
    if (error) { setLudoMessage(error.message); return; }
    await refreshInvites(); if (accept) void loadMatch(matchId);
  }

  async function gameAction(functionName: string, args: Record<string, unknown>) {
    if (!supabase || !ludoMatch || pendingLudoAction.current) return;
    pendingLudoAction.current = true;
    setBusy(true);
    const { data, error } = await supabase.rpc(functionName, args);
    pendingLudoAction.current = false;
    setBusy(false);
    if (error) setLudoMessage(error.message);
    else {
      await loadMatch(ludoMatch.id);
      if (functionName === 'roll_ludo_dice' && data === 0) setLudoMessage('Third consecutive six forfeited · turn passes.');
      else if (functionName === 'move_ludo_token') setLudoMessage('');
    }
  }

  function openLudoLink(matchId: string) {
    if (typeof window !== 'undefined') { const url = new URL(window.location.href); url.searchParams.set('ludo', matchId); window.history.pushState({}, '', url.toString()); }
    void loadMatch(matchId);
  }

  const players = ludoMatch?.player_user_ids?.map((id: string, index: number) => ({ id, username: ludoMatch.player_usernames[index], tokens: ludoMatch.tokens?.[id] ?? [-1, -1, -1, -1], index })) ?? [];
  const currentPlayerId = players[ludoMatch?.turn_index ?? 0]?.id;
  const myTurn = !!session && currentPlayerId === session.user.id && ludoMatch?.status === 'active';
  const onlineTokenPositions = players.map((player: any) => player.tokens);
  const myPlayerIndex = players.findIndex((player: any) => player.id === session?.user?.id);
  const legalTokenIndices = myTurn && ludoMatch?.dice_value ? players.find((player: any) => player.id === session.user.id)?.tokens.map((_position: number, index: number) => ludoTokenCanMove(onlineTokenPositions, myPlayerIndex, index, ludoMatch.dice_value, ludoMatch.player_count) ? index : -1).filter((index: number) => index >= 0) ?? [] : [];

  return <View style={styles.gameCard}>
    <View style={styles.gameHeader}><View style={{ flex: 1 }}><Text style={styles.gameEyebrow}>PLAY TOGETHER</Text><Text style={styles.gameTitle}>Ludo</Text></View><Text style={styles.gameIcon}>🎲</Text></View>
    <Text style={styles.gameDescription}>Play offline, invite friends by username, or open a password-protected online room. Roll a six to leave the yard; land on an opponent to send them back. Get all four pieces home to win.</Text>
    <View style={styles.difficultyRow}><Pressable onPress={() => { setPlayMode('offline'); setLudoMessage(''); }} style={[styles.difficultyButton, playMode === 'offline' && styles.difficultySelected]}><Text style={[styles.difficultyText, playMode === 'offline' && styles.difficultyTextSelected]}>Offline play</Text></Pressable><Pressable onPress={() => { setPlayMode('online'); setLudoMessage(''); }} style={[styles.difficultyButton, playMode === 'online' && styles.difficultySelected]}><Text style={[styles.difficultyText, playMode === 'online' && styles.difficultyTextSelected]}>Online play</Text></Pressable></View>
    {playMode === 'offline' ? <View style={styles.onlineGamePanel}>
      <Text style={styles.sectionTitle}>Pass-and-play · one device</Text>
      <Text style={styles.muted}>Choose between 2 and 6 local players. Each player rolls and moves when their name is highlighted.</Text>
      <View style={styles.difficultyRow}><Text style={styles.difficultyLabel}>Players</Text>{([2, 3, 4, 5, 6] as const).map(count => <Pressable key={count} onPress={() => startLocalGame(count)} style={[styles.difficultyButton, localGame.playerCount === count && styles.difficultySelected]}><Text style={[styles.difficultyText, localGame.playerCount === count && styles.difficultyTextSelected]}>{count}</Text></Pressable>)}</View>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: forfeitTripleSix }} onPress={() => { const next = !forfeitTripleSix; setForfeitTripleSix(next); setLocalGame(current => ({ ...current, forfeitTripleSix: next, sixStreak: 0 })); }} style={styles.ludoRuleToggle}><Text style={styles.ludoRuleCheck}>{forfeitTripleSix ? '✓' : ''}</Text><Text style={styles.muted}>Forfeit the third consecutive six</Text></Pressable>
      <View style={styles.ludoNameGrid}>{localGame.names.map((name, index) => <TextInput key={`local-name-${index}`} accessibilityLabel={`Player ${index + 1} name`} style={[styles.input, styles.ludoNameInput]} value={name} onChangeText={value => setLocalGame(current => ({ ...current, names: current.names.map((item, i) => i === index ? value : item) }))} maxLength={18}/>)}</View>
      <View style={styles.ludoPlayerList}>{localGame.names.map((name, index) => <View key={`local-player-${index}`} style={[styles.ludoPlayerBadge, localGame.turnIndex === index && localGame.winnerIndex === null && styles.playerTurn]}><Text style={[styles.ludoPlayerName, { color: ludoColorFor(index, localGame.playerCount) }]}>{name || `Player ${index + 1}`}</Text><Text style={styles.muted}>{localGame.tokens[index].filter(position => position === 57).length}/4 home</Text></View>)}</View>
      <LudoBoard playerCount={localGame.playerCount} players={localGame.names.map((username, index) => ({ id: String(index), username, tokens: localGame.tokens[index], index }))} legalTokenIndices={[]} selectablePlayerId="" diceValue={localGame.diceValue} onMove={() => {}}/>
      <Text style={styles.turnLabel}>{localGame.winnerIndex !== null ? `${localGame.names[localGame.winnerIndex] || `Player ${localGame.winnerIndex + 1}`} wins!` : `${localGame.names[localGame.turnIndex] || `Player ${localGame.turnIndex + 1}`}’s turn`}</Text>
      {!!ludoMessage && <Text style={styles.muted}>{ludoMessage}</Text>}
      {localGame.winnerIndex === null && localGame.diceValue === null && <Pressable style={[styles.action, styles.primary]} onPress={rollLocalDice}><Text style={styles.actionText}>Roll dice</Text></Pressable>}
      {localGame.winnerIndex === null && localGame.diceValue !== null && localLegalMoves.length === 0 && <Pressable style={styles.outlineButton} onPress={skipLocalTurn}><Text style={styles.outlineText}>No legal move · Pass turn</Text></Pressable>}
      {localGame.winnerIndex === null && <LudoMoveChoices tokenIndices={localLegalMoves} tokens={localGame.tokens[localGame.turnIndex]} diceValue={localGame.diceValue} onChoose={moveLocalToken}/>}
      <Pressable style={styles.outlineButton} onPress={() => startLocalGame(localGame.playerCount)}><Text style={styles.outlineText}>Start a new game</Text></Pressable>
    </View> : !session ? <><Text style={styles.muted}>Create a guest username or sign in to invite players and join online rooms.</Text><Pressable disabled={busy} style={[styles.newGameButton, { alignSelf: 'flex-start' }]} onPress={() => void createGuest()}><Text style={styles.newGameText}>{busy ? 'Creating…' : 'Create guest username'}</Text></Pressable></> : <>
      {!!myUsername && <Text style={styles.onlineUsername}>{session.user?.is_anonymous ? 'Share this easy username: ' : 'Your username: '}<Text style={styles.onlineUsernameValue}>@{myUsername}</Text></Text>}
      <View style={styles.difficultyRow}><Text style={styles.difficultyLabel}>Players</Text>{([2, 3, 4, 5, 6] as const).map(count => <Pressable key={count} onPress={() => setPlayerCount(count)} style={[styles.difficultyButton, playerCount === count && styles.difficultySelected]}><Text style={[styles.difficultyText, playerCount === count && styles.difficultyTextSelected]}>{count}</Text></Pressable>)}</View>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: forfeitTripleSix }} onPress={() => setForfeitTripleSix(value => !value)} style={styles.ludoRuleToggle}><Text style={styles.ludoRuleCheck}>{forfeitTripleSix ? '✓' : ''}</Text><Text style={styles.muted}>Forfeit the third consecutive six</Text></Pressable>
      <View style={styles.onlineGamePanel}>
        <Text style={styles.sectionTitle}>Create a password room</Text>
        <Text style={styles.muted}>Anyone can see the room listing. Only people with its password can join. It closes when all {playerCount} seats are taken.</Text>
        <TextInput accessibilityLabel="Room name" style={styles.input} value={publicRoomName} onChangeText={setPublicRoomName} maxLength={32} placeholder="Room name"/>
        <TextInput accessibilityLabel="Room password" style={styles.input} value={publicRoomPassword} onChangeText={setPublicRoomPassword} maxLength={64} placeholder="Room password (4–64 characters)" secureTextEntry autoCapitalize="none" autoCorrect={false}/>
        <Pressable disabled={busy || !publicRoomName.trim() || publicRoomPassword.length < 4} style={[styles.action, styles.primary, (busy || !publicRoomName.trim() || publicRoomPassword.length < 4) && styles.dim]} onPress={() => void createPublicRoom()}><Text style={styles.actionText}>{busy ? 'Please wait…' : `Create ${playerCount}-player room`}</Text></Pressable>
      </View>
      <View style={styles.onlineGamePanel}>
        <View style={styles.onlineMatchHeader}><Text style={styles.sectionTitle}>Open rooms</Text><Pressable onPress={() => void refreshPublicRooms()}><Text style={styles.link}>Refresh</Text></Pressable></View>
        <Text style={styles.muted}>Join with your guest username or account. Full rooms disappear from this list.</Text>
        {publicRooms.length === 0 ? <Text style={styles.muted}>No open rooms right now. Create one and invite others to enter its password.</Text> : publicRooms.map((room: any) => <View key={room.id} style={[styles.onlineInviteCard, { flexWrap: 'wrap' }]}>
          <View style={{ flex: 1, minWidth: 120 }}><Text style={styles.onlineInviteTitle}>{room.room_name}</Text><Text style={styles.muted}>@{room.creator_username} · {room.joined_count}/{room.player_count} players · 🔒 Password</Text></View>
          <TextInput accessibilityLabel={`Password for ${room.room_name}`} style={[styles.input, { flex: 1, minWidth: 105, marginBottom: 0 }]} value={roomJoinPasswords[room.id] ?? ''} onChangeText={value => setRoomJoinPasswords(current => ({ ...current, [room.id]: value }))} placeholder="Password" secureTextEntry autoCapitalize="none" autoCorrect={false}/>
          <Pressable disabled={busy || !roomJoinPasswords[room.id]} onPress={() => void joinPublicRoom(room.id)} style={[styles.newGameButton, (busy || !roomJoinPasswords[room.id]) && styles.dim]}><Text style={styles.newGameText}>Join</Text></Pressable>
        </View>)}
      </View>
      <Text style={styles.sectionTitle}>Invite players directly</Text>
      <Text style={styles.muted}>Enter {playerCount - 1} usernames, separated by commas.</Text>
      <TextInput accessibilityLabel="Ludo invite usernames" style={styles.input} value={inviteText} onChangeText={setInviteText} autoCapitalize="none" autoCorrect={false} placeholder={Array.from({ length: playerCount - 1 }, (_, index) => `@player${index + 1}`).join(', ')}/>
      <Pressable disabled={busy} style={[styles.action, styles.primary, busy && styles.dim]} onPress={() => void createRoom()}><Text style={styles.actionText}>{busy ? 'Please wait…' : `Send ${playerCount}-player invitations`}</Text></Pressable>
      {!!ludoMessage && <Text accessibilityRole="alert" style={styles.muted}>{ludoMessage}</Text>}
      {receivedInvites.map(invite => <View key={invite.id} style={styles.onlineInviteCard}><View style={{ flex: 1 }}><Text style={styles.onlineInviteTitle}>Ludo invitation · {invite.player_count} players</Text><Text style={styles.muted}>From @{invite.creator_username}</Text></View><Pressable onPress={() => void replyInvite(invite.id, true)} style={styles.newGameButton}><Text style={styles.newGameText}>Join</Text></Pressable><Pressable onPress={() => void replyInvite(invite.id, false)}><Text style={styles.link}>Decline</Text></Pressable></View>)}
      {ludoMatch && <View style={styles.onlineGamePanel}>
        <View style={styles.onlineMatchHeader}><Text style={styles.sectionTitle}>{ludoMatch.room_name || (ludoMatch.status === 'waiting' ? 'Waiting for players' : ludoMatch.status === 'completed' ? 'Game over' : ludoMatch.status === 'cancelled' ? 'Room closed' : 'Ludo room')}</Text><Pressable onPress={() => openLudoLink(ludoMatch.id)}><Text style={styles.link}>Open invite link</Text></Pressable></View>
        <Text selectable style={styles.muted}>{typeof window !== 'undefined' ? `${window.location.origin}/?ludo=${ludoMatch.id}` : `Room code: ${ludoMatch.id}`}</Text>
        <Text style={styles.muted}>Players joined: {players.length} / {ludoMatch.player_count}</Text>
        {ludoMatch.status === 'waiting' && ludoMatch.is_public && <Text style={styles.muted}>Waiting for {ludoMatch.player_count - players.length} more player{ludoMatch.player_count - players.length === 1 ? '' : 's'}. This room is open to password holders.</Text>}
        <View style={styles.ludoPlayerList}>{players.map((player: any) => <Text key={player.id} style={styles.ludoPlayerName}>✓ @{player.username}</Text>)}</View>
        <View style={styles.ludoPlayerList}>{(ludoMatch.invitee_usernames ?? []).map((username: string, index: number) => <Text key={`${username}-${index}`} style={styles.ludoPlayerName}>{players.some((player: any) => player.username === username) ? '✓' : '◷'} @{username}</Text>)}</View>
        {ludoMatch.status === 'cancelled' && <Text style={styles.muted}>An invitation was declined. Create a new room to invite a different player.</Text>}
        {ludoMatch.status === 'active' || ludoMatch.status === 'completed' ? <>
          <LudoBoard playerCount={ludoMatch.player_count} players={players} legalTokenIndices={[]} selectablePlayerId="" diceValue={ludoMatch.dice_value} onMove={() => {}}/>
          <View style={styles.ludoPlayerList}>{players.map((player: any) => <View key={player.id} style={[styles.ludoPlayerBadge, player.id === currentPlayerId && styles.playerTurn]}><Text style={[styles.ludoPlayerName, { color: ludoColorFor(player.index, ludoMatch.player_count) }]}>{player.id === session.user.id ? 'You' : `@${player.username}`}</Text><Text style={styles.muted}>{player.tokens.filter((token: number) => token === 57).length}/4 home</Text></View>)}</View>
          <Text style={styles.turnLabel}>{ludoMatch.status === 'completed' ? `${players.find((player: any) => player.id === ludoMatch.winner_user_id)?.username === myUsername ? 'You win!' : `@${players.find((player: any) => player.id === ludoMatch.winner_user_id)?.username} wins!`}` : myTurn ? 'Your turn' : `Waiting for @${players.find((player: any) => player.id === currentPlayerId)?.username ?? 'player'}`}</Text>
          {myTurn && !ludoMatch.dice_value && <Pressable style={[styles.action, styles.primary]} onPress={() => void gameAction('roll_ludo_dice', { match_id_in: ludoMatch.id })}><Text style={styles.actionText}>Roll dice</Text></Pressable>}
          {myTurn && !!ludoMatch.dice_value && legalTokenIndices.length === 0 && <Pressable style={styles.outlineButton} onPress={() => void gameAction('skip_ludo_turn', { match_id_in: ludoMatch.id })}><Text style={styles.outlineText}>No legal move · Pass turn</Text></Pressable>}
          {myTurn && <LudoMoveChoices tokenIndices={legalTokenIndices} tokens={players.find((player: any) => player.id === session.user.id)?.tokens ?? []} diceValue={ludoMatch.dice_value} disabled={busy} onChoose={tokenIndex => void gameAction('move_ludo_token', { match_id_in: ludoMatch.id, token_index_in: tokenIndex})}/>}
        </> : null}
      </View>}
    </>}
  </View>;
}

function MemoryMatchGame({ session }: { session: any }) {
  const [mode, setMode] = useState<'offline' | 'online'>('offline');
  const [inviteUsername, setInviteUsername] = useState('');
  const [onlineMatch, setOnlineMatch] = useState<any>(null);
  const [pendingInvites, setPendingInvites] = useState<any[]>([]);
  const [myGameUsername, setMyGameUsername] = useState('');
  const [gameMessage, setGameMessage] = useState('');
  const onlineBusy = useRef(false);
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

  const loadOnlineMatch = useCallback(async (id: string) => {
    if (!supabase) return;
    const { data, error } = await supabase.from('memory_game_matches').select('*').eq('id', id).maybeSingle();
    if (error) { setGameMessage(error.message); return; }
    if (!data) { setGameMessage('That match link is invalid or you are not a participant.'); return; }
    setOnlineMatch(data); setMode('online'); setGameMessage('');
    if (typeof window !== 'undefined' && new URL(window.location.href).searchParams.has('match')) {
      const url = new URL(window.location.href); url.searchParams.delete('match'); window.history.replaceState({}, '', url.toString());
    }
  }, []);

  const refreshInvites = useCallback(async () => {
    if (!supabase || !session) return;
    const { data } = await supabase.from('memory_game_matches').select('*').eq('invitee_id', session.user.id).eq('status', 'waiting').order('created_at', { ascending: false });
    setPendingInvites(data ?? []);
  }, [session]);

  useEffect(() => {
    if (!supabase || !session) return;
    void supabase.from('profiles').select('username').eq('id', session.user.id).maybeSingle()
      .then(({ data }) => setMyGameUsername(data?.username ?? ''));
    void refreshInvites();
    const channel = supabase.channel(`memory-games-${session.user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'memory_game_matches', filter: `invitee_id=eq.${session.user.id}` }, () => void refreshInvites())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'memory_game_matches', filter: `creator_id=eq.${session.user.id}` }, payload => {
        if (onlineMatch?.id && (payload.new as any)?.id === onlineMatch.id) void loadOnlineMatch(onlineMatch.id);
      }).subscribe();
    const url = typeof window !== 'undefined' ? new URL(window.location.href) : null;
    const matchId = url?.searchParams.get('match');
    if (matchId) void loadOnlineMatch(matchId);
    return () => { void supabase?.removeChannel(channel); };
  }, [session, refreshInvites, loadOnlineMatch, onlineMatch?.id]);

  useEffect(() => {
    if (!supabase || !onlineMatch?.id) return;
    const channel = supabase.channel(`memory-match-${onlineMatch.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'memory_game_matches', filter: `id=eq.${onlineMatch.id}` }, () => void loadOnlineMatch(onlineMatch.id)).subscribe();
    return () => { void supabase?.removeChannel(channel); };
  }, [onlineMatch?.id, loadOnlineMatch]);

  useEffect(() => {
    if (!onlineMatch || onlineMatch.status !== 'active') return;
    const openTiles = onlineMatch.opened_tiles as number[];
    if (openTiles?.length === 2 && onlineMatch.pending_miss) {
      const timer = setTimeout(async () => {
        await supabase?.rpc('settle_memory_game_miss', { match_id_in: onlineMatch.id });
        void loadOnlineMatch(onlineMatch.id);
      }, 900);
      return () => clearTimeout(timer);
    }
  }, [onlineMatch, loadOnlineMatch]);

  const onlineTiles: MemoryTile[] = useMemo(() => {
    if (!onlineMatch) return [];
    const catalog = new Map(memoryPairCatalog().map(item => [item.pairKey, item]));
    const matches = new Set<number>(onlineMatch.matched_tiles ?? []);
    return (onlineMatch.deck as string[]).map((pairKey, id) => ({ ...catalog.get(pairKey), id, pairKey, matched: matches.has(id) } as MemoryTile));
  }, [onlineMatch]);

  async function invitePlayer() {
    if (!supabase || !session) { setGameMessage('Create a guest profile or sign in to invite a player.'); return; }
    if (!inviteUsername.trim()) { setGameMessage('Enter the player’s username.'); return; }
    setGameMessage('Sending invitation…');
    const deck = newMemoryDeck(pairCount).map(tile => tile.pairKey);
    const { data, error } = await supabase.rpc('create_memory_game_invite', { username_in: inviteUsername.trim(), pair_count_in: pairCount, deck_in: deck });
    if (error) { setGameMessage(error.message); return; }
    setInviteUsername(''); setGameMessage('Invitation sent. The match will start when they accept.');
    if (data) void loadOnlineMatch(data as string);
  }

  async function startGuestOnline() {
    if (!supabase) { setGameMessage('Connect Supabase before creating an online guest profile.'); return; }
    const guestName = `Guest ${Math.random().toString(36).slice(2, 6)}`;
    const { error } = await supabase.auth.signInAnonymously({ options: { data: { full_name: guestName } } });
    setGameMessage(error ? `Could not create guest profile: ${error.message}` : 'Guest profile created. Your unique username is being set up…');
  }

  async function respondInvite(invite: any, accept: boolean) {
    const { error } = await supabase!.rpc('respond_memory_game_invite', { match_id_in: invite.id, accept_in: accept });
    if (error) { setGameMessage(error.message); return; }
    await refreshInvites();
    if (accept) void loadOnlineMatch(invite.id);
  }

  async function revealOnline(index: number) {
    if (!supabase || !onlineMatch || onlineBusy.current || onlineMatch.status !== 'active') return;
    onlineBusy.current = true;
    const { error } = await supabase.rpc('play_memory_game_tile', { match_id_in: onlineMatch.id, tile_index_in: index });
    onlineBusy.current = false;
    if (error) setGameMessage(error.message); else void loadOnlineMatch(onlineMatch.id);
  }

  function openMatchLink(matchId: string) {
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href); url.searchParams.set('match', matchId); window.history.pushState({}, '', url.toString());
    }
    void loadOnlineMatch(matchId);
  }

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
    <View style={styles.difficultyRow}><Pressable onPress={() => { setMode('offline'); setOnlineMatch(null); setGameMessage(''); }} style={[styles.difficultyButton, mode === 'offline' && styles.difficultySelected]}><Text style={[styles.difficultyText, mode === 'offline' && styles.difficultyTextSelected]}>Offline play</Text></Pressable><Pressable onPress={() => { setMode('online'); setGameMessage(''); }} style={[styles.difficultyButton, mode === 'online' && styles.difficultySelected]}><Text style={[styles.difficultyText, mode === 'online' && styles.difficultyTextSelected]}>Online play</Text></Pressable></View>
    {mode === 'online' && <View style={styles.onlineGamePanel}>
      {!session
        ? <><Text style={styles.muted}>Create a lightweight guest profile to get a unique username and play online. Your local attendance history stays on this device.</Text><Pressable style={[styles.newGameButton, { alignSelf: 'flex-start' }]} onPress={() => void startGuestOnline()}><Text style={styles.newGameText}>Create guest username</Text></Pressable>{!!gameMessage && <Text accessibilityRole="alert" style={styles.muted}>{gameMessage}</Text>}</>
        : <>
          {!!myGameUsername && <Text style={styles.onlineUsername}>{session.user?.is_anonymous ? 'Share this easy username: ' : 'Your username: '}<Text style={styles.onlineUsernameValue}>@{myGameUsername}</Text></Text>}
          <Text style={styles.difficultyLabel}>Invite a player by username</Text>
          <View style={styles.difficultyRow}><Text style={styles.difficultyLabel}>Board size</Text>{[8, 16, 24].map(count => <Pressable key={count} onPress={() => setPairCount(count)} style={[styles.difficultyButton, pairCount === count && styles.difficultySelected]}><Text style={[styles.difficultyText, pairCount === count && styles.difficultyTextSelected]}>{count} pairs</Text></Pressable>)}</View>
          <View style={styles.onlineInviteRow}><TextInput accessibilityLabel="Username to invite" autoCapitalize="none" autoCorrect={false} style={[styles.input, styles.onlineInviteInput]} placeholder="e.g. alex_01" value={inviteUsername} onChangeText={setInviteUsername}/><Pressable style={[styles.newGameButton, styles.onlineInviteButton]} onPress={() => void invitePlayer()}><Text style={styles.newGameText}>Invite</Text></Pressable></View>
          {pendingInvites.map(invite => <View key={invite.id} style={styles.onlineInviteCard}><View style={{ flex: 1 }}><Text style={styles.onlineInviteTitle}>Game invitation</Text><Text style={styles.muted}>{invite.creator_username ?? 'A teammate'} · {invite.pair_count} pairs</Text></View><Pressable onPress={() => void respondInvite(invite, true)} style={styles.newGameButton}><Text style={styles.newGameText}>Accept</Text></Pressable><Pressable onPress={() => void respondInvite(invite, false)}><Text style={styles.link}>Decline</Text></Pressable></View>)}
          {!!gameMessage && <Text accessibilityRole="alert" style={styles.muted}>{gameMessage}</Text>}
          {onlineMatch && <>
            <View style={styles.onlineMatchHeader}><Text style={styles.sectionTitle}>{onlineMatch.status === 'waiting' ? 'Waiting for acceptance' : onlineMatch.status === 'completed' ? 'Match complete' : 'Live match'}</Text><Pressable onPress={() => openMatchLink(onlineMatch.id)}><Text style={styles.link}>Open match link</Text></Pressable></View>
            <Text selectable style={styles.muted}>{typeof window !== 'undefined' ? `${window.location.origin}/?match=${onlineMatch.id}` : `Match code: ${onlineMatch.id}`}</Text>
            {onlineMatch.status === 'active' || onlineMatch.status === 'completed' ? <>
              <View style={styles.playerRow}>{[onlineMatch.creator_id, onlineMatch.invitee_id].map((id: string, player: number) => <View key={id} style={[styles.playerCard, onlineMatch.turn_user_id === id && onlineMatch.status === 'active' && styles.playerTurn]}><Text style={styles.playerName}>{id === session.user.id ? 'You' : onlineMatch.creator_id === id ? `@${onlineMatch.creator_username}` : `@${onlineMatch.invitee_username}`}</Text><Text style={styles.playerScore}>{onlineMatch.scores?.[id] ?? 0}</Text><Text style={styles.playerPairs}>pairs</Text></View>)}</View>
              <Text style={styles.turnLabel}>{onlineMatch.status === 'completed' ? (onlineMatch.winner_user_id ? (onlineMatch.winner_user_id === session.user.id ? 'You win!' : 'Your opponent wins!') : 'It’s a tie!') : onlineMatch.turn_user_id === session.user.id ? 'Your turn' : 'Waiting for your opponent…'}</Text>
              <View style={styles.memoryBoard}>{Array.from({ length: Math.ceil(onlineTiles.length / 4) }, (_, row) => <View key={row} style={styles.memoryRow}>{onlineTiles.slice(row * 4, row * 4 + 4).map((tile, column) => { const index = row * 4 + column; const faceUp = tile.matched || (onlineMatch.opened_tiles as number[]).includes(index); return <Pressable key={tile.id} accessibilityRole="button" accessibilityLabel={faceUp ? 'Revealed tile' : 'Hidden tile'} onPress={() => void revealOnline(index)} style={[styles.memoryTile, faceUp && styles.memoryTileOpen, tile.matched && styles.memoryTileMatched]}>{faceUp && tile.faceSource ? <Image source={tile.faceSource} style={styles.memoryFaceImage} resizeMode="cover"/> : <Text style={[styles.memoryTileText, !faceUp && styles.memoryTileHidden]}>{faceUp ? tile.symbol : '?'}</Text>}</Pressable>;})}</View>)}</View>
            </> : null}
          </>}
        </>}
    </View>}
    {mode === 'offline' && <>
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
    </>}
  </View>;
}

type PunchTimeDraft = { punchIn: string; punchOut: string; breakHours: string; breakMinutes: string };

function ClockTimeField({ value, onChange, label, style }: { value: string; onChange: (value: string) => void; label: string; style?: any }) {
  const [visible, setVisible] = useState(false);
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);
  const [period, setPeriod] = useState<'AM' | 'PM'>('AM');
  function openPicker() {
    const match = value.trim().match(/^(0?[1-9]|1[0-2]):([0-5]\d)\s*(AM|PM)$/i);
    if (match) {
      setHour(Number(match[1])); setMinute(Number(match[2])); setPeriod(match[3].toUpperCase() as 'AM' | 'PM');
    } else {
      const now = new Date(); setHour(now.getHours() % 12 || 12); setMinute(now.getMinutes()); setPeriod(now.getHours() < 12 ? 'AM' : 'PM');
    }
    Keyboard.dismiss(); setVisible(true);
  }
  function adjustHour(delta: number) { setHour(current => ((current - 1 + delta + 12) % 12) + 1); }
  function adjustMinute(delta: number) { setMinute(current => ((current + delta + 60) % 60)); }
  return <>
    <View style={[styles.clockFieldRow, style]}>
      <TextInput accessibilityLabel={label} style={[styles.input, styles.clockFieldInput]} value={value} onChangeText={onChange} placeholder="HH:MM AM/PM" keyboardType="default" autoCapitalize="characters" maxLength={8}/>
      <Pressable accessibilityRole="button" accessibilityLabel={`Choose ${label} with clock`} onPress={openPicker} style={styles.clockFieldButton}><Text style={styles.clockFieldIcon}>◷</Text></Pressable>
    </View>
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
      <View style={styles.timePickerOverlay}><View style={styles.timePickerCard}>
        <View style={styles.cardHeading}><Text style={styles.sectionTitle}>Set {label}</Text><Pressable onPress={() => setVisible(false)}><Text style={styles.link}>Cancel</Text></Pressable></View>
        <Text style={styles.muted}>Choose a time, then tap Set time.</Text>
        <View style={styles.timePickerWheels}>
          <View style={styles.timePickerUnit}><Text style={styles.timePickerLabel}>HOUR</Text><Pressable accessibilityLabel="Increase hour" onPress={() => adjustHour(1)} style={styles.timePickerStep}><Text style={styles.timePickerStepText}>＋</Text></Pressable><Text style={styles.timePickerValue}>{hour}</Text><Pressable accessibilityLabel="Decrease hour" onPress={() => adjustHour(-1)} style={styles.timePickerStep}><Text style={styles.timePickerStepText}>−</Text></Pressable></View>
          <Text style={styles.timePickerColon}>:</Text>
          <View style={styles.timePickerUnit}><Text style={styles.timePickerLabel}>MINUTE</Text><Pressable accessibilityLabel="Increase minute" onPress={() => adjustMinute(1)} style={styles.timePickerStep}><Text style={styles.timePickerStepText}>＋</Text></Pressable><Text style={styles.timePickerValue}>{String(minute).padStart(2, '0')}</Text><Pressable accessibilityLabel="Decrease minute" onPress={() => adjustMinute(-1)} style={styles.timePickerStep}><Text style={styles.timePickerStepText}>−</Text></Pressable></View>
          <View style={styles.timePickerUnit}><Text style={styles.timePickerLabel}>PERIOD</Text>{(['AM','PM'] as const).map(option => <Pressable key={option} onPress={() => setPeriod(option)} style={[styles.timePickerPeriod, period === option && styles.timePickerPeriodSelected]}><Text style={[styles.timePickerPeriodText, period === option && styles.timePickerPeriodTextSelected]}>{option}</Text></Pressable>)}</View>
        </View>
        <Pressable accessibilityRole="button" style={[styles.action, styles.primary]} onPress={() => { onChange(`${hour}:${String(minute).padStart(2, '0')} ${period}`); setVisible(false); }}><Text style={styles.actionText}>Set time</Text></Pressable>
      </View></View>
    </Modal>
  </>;
}

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
      <View style={styles.calcField}><Text style={styles.rowLabel}>Punch in</Text><ClockTimeField label="Calculator punch-in time" style={styles.calcTimeField} value={punchIn} onChange={value => { setPunchIn(value); setCalculated(false); }}/></View>
      <View style={styles.calcField}><Text style={styles.rowLabel}>Punch out</Text><ClockTimeField label="Calculator punch-out time" style={styles.calcTimeField} value={punchOut} onChange={value => { setPunchOut(value); setCalculated(false); }}/></View>
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
  const field = (index: number, kind: 'punchIn' | 'punchOut', label: string) => <View style={{ flex: 1, gap: 5 }}><Text style={styles.rowLabel}>{label}</Text><View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}><Pressable accessibilityLabel={`Subtract 15 minutes from ${label}`} onPress={() => updateRow(index, kind, shiftClock(rows[index][kind], -15))} style={{ paddingHorizontal: 4, paddingVertical: 9 }}><Text style={styles.link}>−15</Text></Pressable><ClockTimeField label={`${label} time`} style={styles.correctionTimeField} value={rows[index][kind]} onChange={value => updateRow(index, kind, value.toUpperCase())}/><Pressable accessibilityLabel={`Add 15 minutes to ${label}`} onPress={() => updateRow(index, kind, shiftClock(rows[index][kind], 15))} style={{ paddingHorizontal: 4, paddingVertical: 9 }}><Text style={styles.link}>+15</Text></Pressable></View></View>;
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

function TeamAvailability({ session, today }: { session: any; today: string }) {
  const [visible, setVisible] = useState(false);
  const [people, setPeople] = useState<{ username: string; display_name: string; presence_status: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const canShare = !!session?.user?.id && !session.user.is_anonymous && !!supabase;
  const refresh = useCallback(async () => {
    if (!canShare || !supabase) return;
    setLoading(true);
    const [{ data: preference, error: preferenceError }, { data, error: listError }] = await Promise.all([
      supabase.from('team_availability_preferences').select('visible_to_team').eq('user_id', session.user.id).maybeSingle(),
      supabase.rpc('list_team_availability', { work_date_in: today }),
    ]);
    if (preferenceError || listError) setError(`Team availability needs the latest database setup: ${(preferenceError || listError)?.message}`);
    else { setVisible(!!preference?.visible_to_team); setPeople((data ?? []) as typeof people); setError(''); }
    setLoading(false);
  }, [canShare, session?.user?.id, today]);
  useEffect(() => {
    if (!canShare) return;
    void refresh();
    const interval = setInterval(() => void refresh(), 45_000);
    return () => clearInterval(interval);
  }, [canShare, refresh]);
  async function toggleVisibility() {
    if (!supabase || !canShare) return;
    const next = !visible;
    const { error: saveError } = await supabase.rpc('set_team_availability_visible', { visible_in: next });
    if (saveError) setError(saveError.message);
    else { setVisible(next); await refresh(); }
  }
  return <View style={{ gap: 9, padding: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 16, backgroundColor: '#FFFFFF' }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><View style={{ flex: 1 }}><Text style={styles.sectionTitle}>Team availability</Text><Text style={styles.muted}>Share whether you’re working, on break, or off shift.</Text></View><Pressable accessibilityRole="switch" accessibilityState={{ checked: visible }} disabled={!canShare} onPress={() => void toggleVisibility()} style={{ minWidth: 68, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 99, backgroundColor: visible ? '#DCFCE7' : '#E2E8F0', alignItems: 'center' }}><Text style={{ color: visible ? '#15803D' : colors.muted, fontSize: 10, fontWeight: '800' }}>{!canShare ? 'SIGN IN' : visible ? 'SHARING' : 'PRIVATE'}</Text></Pressable></View>
    {!canShare ? <Text style={styles.chatPresence}>Sign in with an employee account to share work availability.</Text> : visible ? loading && !people.length ? <Text style={styles.chatPresence}>Loading team…</Text> : people.length ? people.map(person => <View key={person.username} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 }}><View style={{ width: 8, height: 8, borderRadius: 99, backgroundColor: person.presence_status === 'Working' ? '#16A34A' : person.presence_status === 'On break' ? '#F59E0B' : '#94A3B8' }}/><Text style={{ flex: 1, color: colors.text, fontSize: 12 }}>{person.display_name} <Text style={styles.muted}>@{person.username}</Text></Text><Text style={styles.chatPresence}>{person.presence_status}</Text></View>) : <Text style={styles.chatPresence}>No teammates have shared their availability yet.</Text> : <Text style={styles.chatPresence}>Your status stays private until you turn sharing on.</Text>}
    {!!error && <Text accessibilityRole="alert" style={{ color: '#B91C1C', fontSize: 11 }}>{error}</Text>}
  </View>;
}

function History({ days, policy, onClear, onCorrect, onAddMissed }: { days: AttendanceDay[]; policy: PolicyConfig; onClear: (date: string) => Promise<void>; onCorrect: (date: string) => void; onAddMissed: (date: string) => void }) {
  const [month, setMonth] = useState(localDateKey().slice(0, 7));
  const [expandedDates, setExpandedDates] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  const rows = days.filter(d => d.date.startsWith(month));
  const weekStart = new Date(); weekStart.setHours(0, 0, 0, 0); weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const weekStartKey = localDateKey(weekStart);
  const weekRows = days.filter(item => item.date >= weekStartKey && item.date <= localDateKey());
  const weekWorkMinutes = weekRows.reduce((sum, item) => sum + getAttendanceSummary(item, item.punchOutAt ? new Date(item.punchOutAt) : new Date(), policy).netWorkedMinutes, 0);
  const weekBreakMinutes = weekRows.reduce((sum, item) => sum + getAttendanceSummary(item, item.punchOutAt ? new Date(item.punchOutAt) : new Date(), policy).takenBreakMinutes, 0);
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
  return <><View style={{ gap: 10, borderRadius: 16, backgroundColor: '#EFF6FF', padding: 14 }}><Text style={styles.sectionTitle}>This week · from {weekStart.toLocaleDateString([], { day: 'numeric', month: 'short' })}</Text><View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><View><Text style={styles.statLabel}>NET WORK</Text><Text style={styles.monthStat}>{formatDuration(weekWorkMinutes)}</Text></View><View><Text style={styles.statLabel}>BREAKS</Text><Text style={styles.monthStat}>{formatDuration(weekBreakMinutes)}</Text></View><View><Text style={styles.statLabel}>DAYS</Text><Text style={styles.monthStat}>{weekRows.filter(item => getDaySessions(item).length).length}</Text></View></View></View><View style={styles.monthBar}><Pressable onPress={() => shiftMonth(-1)}><Text style={styles.monthArrow}>‹</Text></Pressable><Text style={styles.monthTitle}>{monthName(month)}</Text><Pressable onPress={() => shiftMonth(1)}><Text style={styles.monthArrow}>›</Text></Pressable></View><Pressable accessibilityRole="button" onPress={() => onAddMissed(`${month}-01`)} style={styles.outlineButton}><Text style={styles.outlineText}>＋ Add missed attendance</Text></Pressable><Pressable accessibilityRole="button" disabled={exporting || !rows.length} onPress={() => void exportPdf()} style={[styles.exportButton, (!rows.length || exporting) && styles.exportDisabled]}><Text style={styles.exportButtonText}>{exporting ? 'Preparing PDF…' : 'Export month as PDF'}</Text></Pressable><View style={styles.summaryStrip}><View><Text style={styles.statLabel}>DAYS RECORDED</Text><Text style={styles.monthStat}>{rows.length}</Text></View><View><Text style={styles.statLabel}>WORK HOURS</Text><Text style={styles.monthStat}>{formatDuration(total)}</Text></View><View><Text style={styles.statLabel}>LATE LOGINS</Text><Text style={styles.monthStat}>{lateDates.length}</Text></View></View>{rows.length ? [...rows].sort((a, b) => b.date.localeCompare(a.date)).map(d => { const s = getAttendanceSummary(d, d.punchOutAt ? new Date(d.punchOutAt) : new Date(), policy); const daySessions = getDaySessions(d); const lastSession = daySessions[daySessions.length - 1]; const expanded = expandedDates.includes(d.date); return <View key={d.date} style={styles.historyDayCard}><View style={styles.historyRow}><View style={styles.historyDate}><Text style={styles.historyDay}>{new Date(`${d.date}T12:00:00`).toLocaleDateString([], { weekday: 'short' })}</Text><Text style={styles.historyNum}>{new Date(`${d.date}T12:00:00`).getDate()}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={`${expanded ? 'Hide' : 'Show'} punches for ${d.date}`} onPress={() => setExpandedDates(current => expanded ? current.filter(date => date !== d.date) : [...current, d.date])} style={styles.historyMain}><Text style={styles.historyTitle}>{clock(daySessions[0]?.punchInAt ?? null)} — {lastSession?.punchOutAt ? clock(lastSession.punchOutAt) : 'In progress'}</Text><Text style={styles.historySub}>{halfDayDates.has(d.date) ? 'Half-day applied · ' : ''}{s.loginStatus} · {daySessions.length} session{daySessions.length === 1 ? '' : 's'} · Break {formatDuration(s.takenBreakMinutes)} · {d.synced === false ? 'Waiting to sync' : 'Saved'}</Text><Text style={styles.sessionToggle}>{expanded ? 'Hide punch details' : 'View punch details'}</Text></Pressable><Text style={styles.historyHours}>{formatDuration(s.netWorkedMinutes)}</Text><ClearDayControl date={d.date} onClear={onClear} compact /></View>{expanded && <View style={styles.sessionList}>{daySessions.map((session, index) => { const end = session.punchOutAt ? new Date(session.punchOutAt) : new Date(); const elapsed = Math.max(0, Math.floor((end.getTime() - new Date(session.punchInAt).getTime()) / 60000)); const sessionBreak = Math.min(elapsed, session.breakMinutes ?? 0); return <View key={`${session.punchInAt}-${index}`} style={styles.sessionEntry}><Text style={styles.sessionLabel}>Session {index + 1}</Text><Text style={styles.sessionTime}>{clock(session.punchInAt)} → {session.punchOutAt ? clock(session.punchOutAt) : 'In progress'}</Text><Text style={styles.sessionDuration}>{formatDuration(elapsed - sessionBreak)} work{sessionBreak ? ` · ${formatDuration(sessionBreak)} break` : ''}</Text></View>; })}<Pressable style={styles.outlineButton} onPress={() => onCorrect(d.date)}><Text style={styles.outlineText}>Correct punch times</Text></Pressable></View>}</View>; }) : <View style={styles.empty}><Text style={styles.emptyTitle}>No attendance yet</Text><Text style={styles.muted}>Punch in to start a record for {monthName(month)}.</Text></View>}</>;
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

type MiloMessage = { role: 'user' | 'assistant'; text: string; source?: string };

function MiloPolicyAssistant({ session, compact = false }: { session: any; compact?: boolean }) {
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<MiloMessage[]>([{ role: 'assistant', text: 'Hi, I’m Milo! Ask me about your company policy. I’ll stick to the uploaded document and flag anything it doesn’t clearly answer.' }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function ask(text = question) {
    const cleanQuestion = text.trim();
    if (!cleanQuestion || busy) return;
    if (!session || !supabase) { setError('Sign in online to ask Milo about company policy.'); return; }
    const previous = messages;
    setMessages([...previous, { role: 'user', text: cleanQuestion }]);
    setQuestion(''); setError(''); setBusy(true);
    try {
      const history = previous.slice(-6).map(message => ({ role: message.role, content: message.text }));
      const { data, error: invokeError } = await supabase.functions.invoke('milo-policy-answer', { body: { question: cleanQuestion, history } });
      if (invokeError || data?.error) throw new Error(data?.error || await edgeFunctionErrorMessage(invokeError, 'Milo is unavailable right now.'));
      setMessages(current => [...current, { role: 'assistant', text: data.answer, source: data.source }]);
    } catch (cause: any) {
      setError(cause?.message || 'Could not reach Milo. Check your connection and try again.');
    } finally { setBusy(false); }
  }

  return <View style={[styles.miloPanel, compact && styles.miloPanelCompact]}>
    <View style={styles.miloIntro}><View style={styles.miloAvatar}><Text style={styles.miloAvatarText}>🐱</Text></View><View style={{ flex: 1 }}><Text style={styles.chatWelcome}>Milo · Policy assistant</Text><Text style={styles.chatPresence}>Answers from the latest HR policy uploaded by HR</Text></View></View>
    <ScrollView style={[styles.miloMessages, compact && styles.miloMessagesCompact]} contentContainerStyle={styles.miloMessagesContent} keyboardShouldPersistTaps="handled">
      {messages.map((message, index) => <View key={`${index}-${message.role}`} style={[styles.miloBubble, message.role === 'user' ? styles.miloBubbleUser : styles.miloBubbleAgent]}><Text style={styles.miloBubbleText}>{message.text}</Text>{message.source && <Text style={styles.miloSource}>Based on company policy</Text>}</View>)}
      {busy && <View style={[styles.miloBubble, styles.miloBubbleAgent, styles.miloThinking]}><ActivityIndicator size="small" color={colors.blue}/><Text style={styles.chatPresence}>Milo is checking the policy…</Text></View>}
    </ScrollView>
    {!compact && !messages.some(message => message.source) && messages.length === 1 && <View style={styles.miloSuggestions}>{['What are the working hours?', 'How many late arrivals are allowed?', 'What is the work-from-home policy?'].map(prompt => <Pressable key={prompt} onPress={() => void ask(prompt)} style={styles.miloSuggestion}><Text style={styles.miloSuggestionText}>{prompt}</Text></Pressable>)}</View>}
    {!!error && <Text accessibilityRole="alert" style={styles.miloError}>{error}</Text>}
    <View style={styles.chatInputRow}><TextInput accessibilityLabel="Ask Milo about company policy" style={styles.chatInput} value={question} onChangeText={setQuestion} placeholder="Ask about company policy…" multiline maxLength={1200} editable={!busy} onSubmitEditing={() => void ask()}/><Pressable accessibilityRole="button" accessibilityLabel="Send question to Milo" disabled={busy || !question.trim()} onPress={() => void ask()} style={[styles.sendButton, (busy || !question.trim()) && styles.dim]}><Text style={styles.sendButtonText}>{busy ? '…' : '↑'}</Text></Pressable></View>
    <Text style={styles.miloDisclaimer}>Milo explains the policy; HR makes final decisions. If the policy is unclear, ask HR.</Text>
  </View>;
}

function HRDashboard({ rows, loading, role, policyUploadBusy, policyUploadedName, onUploadPolicy, onRefresh, onResolve }: { rows: any[]; loading: boolean; role: string; policyUploadBusy: boolean; policyUploadedName: string; onUploadPolicy: (file: File) => Promise<string | null>; onRefresh: () => void; onResolve: (id: string, status: 'approved' | 'rejected') => void }) {
  function choosePolicyPdf() {
    if (Platform.OS !== 'web') return Alert.alert('Use the web app', 'Upload the company policy from the Milo HR dashboard in a browser.');
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'application/pdf,.pdf';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      void onUploadPolicy(file).then(message => { if (message) Alert.alert('Policy upload failed', message); });
    };
    input.click();
  }
  return <>
    {role === 'hr_admin' && <View style={styles.card}><Text style={styles.sectionTitle}>Milo policy source</Text><Text style={styles.muted}>Upload the current company HR policy as a PDF. Milo will extract the text, including scanned pages, and use it as the source for employee answers.</Text><Pressable accessibilityRole="button" disabled={policyUploadBusy} onPress={choosePolicyPdf} style={[styles.action, styles.primary, policyUploadBusy && styles.dim]}><Text style={styles.actionText}>{policyUploadBusy ? 'Reading and saving policy…' : 'Upload company policy PDF'}</Text></Pressable>{!!policyUploadedName && <Text style={styles.miloUploadSuccess}>✓ Active policy: {policyUploadedName}</Text>}<Text style={styles.chatPresence}>HR admin only · PDF limit 5 MB · Uploading replaces the current active policy.</Text></View>}
    <View style={styles.card}><View style={styles.cardHeading}><Text style={styles.sectionTitle}>HR attendance overview</Text><Pressable onPress={onRefresh}><Text style={styles.link}>Refresh</Text></Pressable></View><Text style={styles.muted}>Protected report and approval queue. Access requires an HR or manager role assigned by an administrator.</Text>{loading && <ActivityIndicator/>}{rows.length ? rows.map(row => <View key={row.review_id ?? `${row.user_id}-${row.work_date}`} style={styles.hrRow}><View style={{ flex: 1 }}><Text style={styles.historyTitle}>{row.employee_name ?? row.email ?? 'Employee'} · {row.work_date}</Text><Text style={styles.historySub}>{row.review_status ? `Late login · ${row.minutes_late} min · ${row.review_status}` : `Work: ${formatDuration(row.net_work_minutes ?? 0)}`}</Text></View>{row.review_status === 'pending' && <View style={styles.hrActions}><Pressable onPress={() => onResolve(row.review_id, 'approved')}><Text style={styles.approve}>Approve</Text></Pressable><Pressable onPress={() => onResolve(row.review_id, 'rejected')}><Text style={styles.reject}>Reject</Text></Pressable></View>}</View>) : !loading && <View style={styles.empty}><Text style={styles.emptyTitle}>No report data</Text><Text style={styles.muted}>The secure report will appear when employees have submitted attendance.</Text></View>}</View>
  </>;
}
function Stat({ label, value }: { label: string; value: string }) { return <View style={styles.statCard}><Text style={styles.statLabel}>{label}</Text><Text style={styles.statValue}>{value}</Text></View>; }
function Row({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) { return <View style={styles.row}><Text style={styles.rowLabel}>{label}</Text><Text style={[styles.rowValue, warning && { color: colors.amber }]}>{value}</Text></View>; }
function Pill({ text, warning }: { text: string; warning: boolean }) { return <View style={[styles.pill, warning && styles.pillWarn]}><Text style={[styles.pillText, warning && { color: '#B45309' }]}>{text}</Text></View>; }
function Stepper({ label, value, onMinus, onPlus }: { label: string; value: string; onMinus: () => void; onPlus: () => void }) { return <View style={styles.stepper}><Text style={styles.rowLabel}>{label}</Text><View style={styles.stepActions}><Pressable style={styles.stepButton} onPress={onMinus}><Text style={styles.stepText}>−</Text></Pressable><Text style={styles.stepValue}>{value}</Text><Pressable style={styles.stepButton} onPress={onPlus}><Text style={styles.stepText}>+</Text></Pressable></View></View>; }
function SettingChoice({ label, value, options, onSelect }: { label: string; value: string; options: string[]; onSelect: (value: string) => void }) { return <View style={styles.settingChoice}><Text style={styles.rowLabel}>{label}</Text><View style={styles.choiceRow}>{options.map(option => <Pressable key={option} onPress={() => onSelect(option)} style={[styles.choice, value === option && styles.choiceSelected]}><Text style={[styles.choiceText, value === option && styles.choiceTextSelected]}>{option}</Text></Pressable>)}</View></View>; }

const styles = StyleSheet.create({
  clockFieldRow: { flexDirection: 'row', alignItems: 'center', gap: 5 }, clockFieldInput: { flex: 1, minWidth: 0, marginBottom: 0 }, clockFieldButton: { width: 42, height: 46, borderRadius: 12, borderWidth: 1, borderColor: '#BFDBFE', backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' }, clockFieldIcon: { color: colors.blue, fontSize: 25, fontWeight: '800', lineHeight: 30 }, calcTimeField: { flexDirection: 'row', alignItems: 'center', gap: 5 }, correctionTimeField: { flex: 1, minWidth: 55 }, timePickerOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.52)', alignItems: 'center', justifyContent: 'center', padding: 18 }, timePickerCard: { width: '100%', maxWidth: 380, backgroundColor: colors.card, padding: 18, borderRadius: 18, gap: 14, borderWidth: 1, borderColor: colors.border }, timePickerWheels: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', gap: 8 }, timePickerUnit: { alignItems: 'center', gap: 6 }, timePickerLabel: { color: colors.muted, fontSize: 9, fontWeight: '800', letterSpacing: 0.8 }, timePickerStep: { width: 42, height: 34, borderRadius: 10, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' }, timePickerStepText: { color: colors.blue, fontWeight: '800', fontSize: 18 }, timePickerValue: { minWidth: 55, textAlign: 'center', color: colors.text, fontSize: 30, fontWeight: '900', fontVariant: ['tabular-nums'] }, timePickerColon: { color: colors.text, fontSize: 28, fontWeight: '800', marginTop: 18 }, timePickerPeriod: { minWidth: 48, paddingVertical: 7, borderRadius: 9, alignItems: 'center', backgroundColor: '#F1F5F9' }, timePickerPeriodSelected: { backgroundColor: colors.blue }, timePickerPeriodText: { color: colors.muted, fontSize: 12, fontWeight: '800' }, timePickerPeriodTextSelected: { color: '#FFFFFF' },
  ludoSafeStar: { color: '#94A3B8', fontSize: 18, lineHeight: 20, fontWeight: '700' },
  fireworksLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000, elevation: 1000, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(15, 23, 42, 0.10)' }, fireworkParticle: { position: 'absolute', left: -3, top: -3, width: 7, height: 7, borderRadius: 5 }, fireworkFlash: { position: 'absolute', left: -11, top: -11, width: 22, height: 22, borderRadius: 12, backgroundColor: '#FFF7C2' }, fireworksMessage: { position: 'absolute', alignSelf: 'center', top: '42%', minWidth: 230, borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.72)', backgroundColor: 'rgba(15,23,42,0.88)', paddingHorizontal: 26, paddingVertical: 22, alignItems: 'center', shadowColor: '#000000', shadowOpacity: 0.24, shadowRadius: 24, elevation: 12 }, fireworksEmoji: { fontSize: 32, marginBottom: 7 }, fireworksTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: '900', textAlign: 'center' }, fireworksSubtitle: { color: '#DBEAFE', fontSize: 13, fontWeight: '700', marginTop: 5 },
  safe: { flex: 1, backgroundColor: colors.background }, ambienceLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden', zIndex: 0 }, correctionOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.58)', alignItems: 'center', justifyContent: 'center', padding: 12 }, correctionModal: { width: '100%', maxWidth: 620, height: '92%', maxHeight: 780, backgroundColor: colors.card, borderRadius: 18, padding: 15, gap: 12, overflow: 'hidden' }, correctionScroll: { flex: 1, minHeight: 0 }, correctionContent: { gap: 12, paddingBottom: 8 }, correctionRow: { gap: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 }, correctionFields: { flexDirection: 'row', gap: 8 }, sessionBreakEditor: { gap: 6, backgroundColor: '#F8FAFC', padding: 9, borderRadius: 10 }, sessionBreakFields: { flexDirection: 'row', gap: 8 }, sessionBreakField: { flex: 1, gap: 4 }, correctionFooter: { flexShrink: 0, paddingTop: 2, backgroundColor: colors.card }, correctionSave: { flex: 0, alignSelf: 'stretch', height: 46, justifyContent: 'center' }, passingLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50, overflow: 'hidden' }, fallLayer: { position: 'absolute', top: -36, left: 0, right: 0, bottom: 0, zIndex: 51, overflow: 'hidden' }, spiderThread: { position: 'absolute', top: 0, width: 2, backgroundColor: '#E2E8F0', opacity: 0.95, transformOrigin: 'top center' }, fallingSpider: { position: 'absolute', top: 0 }, passingGif: { position: 'absolute', top: '42%', left: 0 }, ambientGlow: { position: 'absolute', width: 260, height: 260, borderRadius: 140, opacity: 0.16 }, glowBlue: { top: '18%', left: -140, backgroundColor: '#BFDBFE' }, glowMint: { top: '54%', right: -145, backgroundColor: '#A7F3D0' }, floatPaw: { position: 'absolute', fontSize: 21, opacity: 0.15 }, floatPawOne: { top: '26%', left: '12%' }, floatPawTwo: { top: '66%', right: '14%' }, firefly: { position: 'absolute', color: '#F59E0B', fontSize: 23, fontWeight: '900' }, fireflyOne: { top: '38%', right: '23%' }, fireflyTwo: { top: '72%', left: '28%' }, runningPawTrail: { position: 'absolute', left: 0, bottom: 14, fontSize: 22, color: '#60A5FA', opacity: 0.25 }, spiderWeb: { position: 'absolute', width: 142, height: 142, top: -42, right: -42, borderRadius: 100 }, webRing: { position: 'absolute', borderWidth: 1, borderColor: '#60A5FA', borderRadius: 100 }, webRingOuter: { width: 128, height: 128, left: 7, top: 7 }, webRingMiddle: { width: 88, height: 88, left: 27, top: 27 }, webRingInner: { width: 48, height: 48, left: 47, top: 47 }, webSpoke: { position: 'absolute', width: 124, height: 1, top: 70, left: 70, backgroundColor: '#60A5FA' }, webSpider: { position: 'absolute', left: 57, top: 55, fontSize: 18 }, ambientRunner: { position: 'absolute', left: 0, bottom: 13, fontSize: 28, opacity: 0.38 }, page: { width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 38, gap: 16 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  catScene: { height: 88, width: '100%', borderRadius: 18, overflow: 'hidden', backgroundColor: '#DFF4F3', borderWidth: 1, borderColor: '#C5E8E5' }, catSun: { position: 'absolute', right: 24, top: 13, width: 25, height: 25, borderRadius: 20, backgroundColor: '#FDE68A' }, catCloud: { position: 'absolute', right: 56, top: 9, fontSize: 15, opacity: 0.75 }, catTitle: { position: 'absolute', left: 13, top: 12, color: '#0F766E', fontSize: 8, fontWeight: '900', letterSpacing: 1.1 }, catCaption: { position: 'absolute', left: 13, top: 26, color: '#365F66', fontSize: 11, fontWeight: '700' }, catHorizon: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 20, backgroundColor: '#A7D9AC' }, catGrassLeft: { position: 'absolute', left: '30%', bottom: 8, height: 13, width: 55, borderTopLeftRadius: 35, borderTopRightRadius: 20, backgroundColor: '#86C694', transform: [{ rotate: '-5deg' }] }, catGrassRight: { position: 'absolute', right: '8%', bottom: 6, height: 16, width: 70, borderTopLeftRadius: 40, borderTopRightRadius: 25, backgroundColor: '#8BCB9A', transform: [{ rotate: '4deg' }] }, catPaws: { position: 'absolute', left: '42%', bottom: 13, fontSize: 11, letterSpacing: 4 }, walkingCat: { position: 'absolute', left: 0, bottom: 7 }, catEmoji: { fontSize: 31, lineHeight: 37 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 7 }, eyebrow: { color: colors.blue, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 }, title: { color: colors.text, fontSize: 30, fontWeight: '800', marginTop: 4 }, subtitle: { color: colors.muted, fontSize: 14, marginTop: 4, lineHeight: 20 }, avatar: { width: 48, height: 48, borderRadius: 16, backgroundColor: '#DBEAFE', alignItems: 'center', justifyContent: 'center' }, avatarLarge: { width: 56, height: 56, borderRadius: 18, backgroundColor: '#DBEAFE', alignItems: 'center', justifyContent: 'center', alignSelf: 'center' }, avatarText: { color: colors.blue, fontWeight: '800', fontSize: 17 },
  installCard: { backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: '#BFDBFE', borderRadius: 13, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 10 }, installCopy: { flex: 1, gap: 3 }, installTitle: { color: colors.text, fontSize: 12, fontWeight: '800' }, installDescription: { color: colors.muted, fontSize: 10, lineHeight: 15 }, installButton: { backgroundColor: colors.blue, paddingHorizontal: 11, paddingVertical: 9, borderRadius: 10 }, installButtonText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' }, installDismiss: { paddingHorizontal: 3, paddingVertical: 4 }, installDismissText: { color: colors.muted, fontSize: 18, lineHeight: 20 },
  connection: { backgroundColor: '#F0FDF4', padding: 11, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }, offline: { backgroundColor: '#FFFBEB' }, dot: { width: 7, height: 7, borderRadius: 5 }, connectionText: { fontSize: 11, color: colors.muted, flex: 1 }, link: { color: colors.blue, fontWeight: '700', fontSize: 12 }, tabs: { flexDirection: 'row', gap: 5, backgroundColor: '#E9EEF5', padding: 4, borderRadius: 14 }, tab: { width: 75, flexGrow: 0, paddingVertical: 10, borderRadius: 11, alignItems: 'center' }, tabActive: { backgroundColor: '#FFFFFF', elevation: 1 }, tabText: { fontSize: 13, fontWeight: '700', color: colors.muted }, tabTextActive: { color: colors.text }, fieldLabel: { color: colors.muted, fontSize: 11, fontWeight: '700' }, chatError: { color: '#B91C1C', fontSize: 12, lineHeight: 18 },
  hero: { position: 'relative', zIndex: 52, overflow: 'hidden', backgroundColor: colors.navy, borderRadius: 25, padding: 22, shadowColor: '#0F172A', shadowOffset: { width: 0, height: 9 }, shadowOpacity: 0.13, shadowRadius: 17, elevation: 3 }, heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }, heroLabel: { color: '#BFDBFE', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 }, timerHero: { color: '#FFF', fontSize: 44, fontWeight: '800', fontVariant: ['tabular-nums'], letterSpacing: 1, marginTop: 5, marginBottom: 5 }, breakTimerCard: { marginTop: 12, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#451A1A', borderRadius: 12, borderWidth: 1, borderColor: '#7F1D1D' }, breakTimerLabel: { color: '#FCA5A5', fontSize: 9, fontWeight: '900', letterSpacing: 1 }, breakTimerValue: { color: '#F87171', fontSize: 23, fontWeight: '900', fontVariant: ['tabular-nums'], marginTop: 3 }, breakTimerHint: { color: '#FECACA', fontSize: 10, marginTop: 2 }, progressBadge: { backgroundColor: '#263A56', paddingVertical: 9, paddingHorizontal: 12, borderRadius: 12 }, progressBadgeText: { color: '#DCEBFF', fontSize: 14, fontWeight: '800' }, progressTrack: { height: 8, backgroundColor: '#334155', borderRadius: 99, overflow: 'hidden', marginTop: 16 }, progressFill: { height: 8, backgroundColor: '#60A5FA', borderRadius: 99 }, progressMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 9 }, heroSmall: { color: '#CBD5E1', fontSize: 11 }, shiftEstimate: { color: '#BFDBFE', fontSize: 11, fontWeight: '700', marginTop: 5 }, buttonRow: { flexDirection: 'row', gap: 10, marginTop: 21 }, action: { flex: 1, borderRadius: 13, paddingVertical: 14, alignItems: 'center' }, primary: { backgroundColor: colors.blue }, teal: { backgroundColor: '#0F766E' }, dim: { opacity: 0.45 }, actionText: { color: '#FFF', fontWeight: '800', fontSize: 14 }, helper: { color: '#CBD5E1', fontSize: 12, marginTop: 12, lineHeight: 18 },
  calcFields: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 }, calcButton: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto', width: '100%', minHeight: 46, marginTop: 2, justifyContent: 'center' }, calcField: { flex: 1, minWidth: 90, gap: 6 }, calcResult: { backgroundColor: '#EFF6FF', borderRadius: 12, padding: 13, gap: 4 }, calcWorked: { color: colors.text, fontSize: 19, fontWeight: '800' }, calcStatus: { fontSize: 12, fontWeight: '700' }, calcMet: { color: '#15803D' }, calcPending: { color: colors.blue }, calcHint: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, statCard: { flexBasis: '47%', flexGrow: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 15, padding: 14, gap: 8 }, statLabel: { color: colors.muted, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 }, statValue: { color: colors.text, fontSize: 16, fontWeight: '800' }, card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 18, padding: 17, gap: 13 }, cardHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '800' }, row: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 }, rowLabel: { color: colors.muted, fontSize: 12, flex: 1 }, rowValue: { color: colors.text, fontSize: 12, fontWeight: '700', textAlign: 'right', flex: 1 }, pill: { backgroundColor: '#DCFCE7', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 99 }, pillWarn: { backgroundColor: '#FEF3C7' }, pillText: { color: '#15803D', fontSize: 10, fontWeight: '800' }, policyNote: { color: '#854D0E', fontSize: 11, lineHeight: 17, backgroundColor: '#FFFBEB', padding: 10, borderRadius: 10 }, outlineButton: { borderWidth: 1, borderColor: '#BFDBFE', borderRadius: 11, padding: 11, alignItems: 'center', backgroundColor: '#F8FBFF' }, outlineText: { color: colors.blue, fontSize: 12, fontWeight: '800' }, lobbySubmit: { width: 46, height: 46, borderRadius: 14, backgroundColor: colors.blue, alignItems: 'center', justifyContent: 'center' }, lobbySubmitText: { color: '#FFFFFF', fontSize: 23, lineHeight: 27, fontWeight: '900' }, muted: { color: colors.muted, fontSize: 12, lineHeight: 18 }, stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, stepActions: { flexDirection: 'row', alignItems: 'center', gap: 10 }, stepButton: { width: 30, height: 30, borderRadius: 10, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' }, stepText: { fontSize: 20, color: colors.text }, stepValue: { minWidth: 64, textAlign: 'center', fontWeight: '800', color: colors.text, fontSize: 12 }, settingChoice: { gap: 8 }, choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, choice: { backgroundColor: '#F1F5F9', paddingVertical: 7, paddingHorizontal: 10, borderRadius: 99 }, choiceSelected: { backgroundColor: '#DBEAFE' }, choiceText: { color: colors.muted, fontSize: 10, fontWeight: '700' }, choiceTextSelected: { color: colors.blue },
  gameCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 22, padding: 18, gap: 15 }, gameHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, gameEyebrow: { color: colors.blue, fontWeight: '800', fontSize: 10, letterSpacing: 1.2 }, gameTitle: { color: colors.text, fontSize: 24, fontWeight: '800', marginTop: 3 }, gameIcon: { fontSize: 34 }, gameDescription: { color: colors.muted, fontSize: 12, lineHeight: 18 }, difficultyRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7 }, difficultyLabel: { color: colors.muted, fontSize: 11, fontWeight: '700', marginRight: 3 }, difficultyButton: { borderRadius: 99, paddingVertical: 7, paddingHorizontal: 10, backgroundColor: '#F1F5F9' }, difficultySelected: { backgroundColor: '#DBEAFE' }, difficultyText: { color: colors.muted, fontSize: 10, fontWeight: '700' }, difficultyTextSelected: { color: colors.blue }, playerRow: { flexDirection: 'row', gap: 10 }, playerCard: { flex: 1, alignItems: 'center', backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: colors.border, borderRadius: 15, padding: 10 }, playerTurn: { borderColor: colors.blue, backgroundColor: '#EFF6FF' }, playerName: { width: '100%', color: colors.text, textAlign: 'center', fontWeight: '700', fontSize: 12, paddingVertical: 4 }, playerScore: { color: colors.blue, fontWeight: '800', fontSize: 25, marginTop: 4 }, playerPairs: { color: colors.muted, fontSize: 10 }, turnLabel: { textAlign: 'center', color: colors.text, fontWeight: '800', fontSize: 14 }, memoryBoard: { width: '100%', maxWidth: 460, alignSelf: 'center', gap: 8 }, memoryRow: { flexDirection: 'row', gap: 8 }, memoryTile: { flex: 1, aspectRatio: 1, borderRadius: 13, borderWidth: 1, borderColor: '#CBD5E1', backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }, memoryFaceImage: { width: '100%', height: '100%' }, memoryTileOpen: { backgroundColor: '#EFF6FF', borderColor: '#93C5FD' }, memoryTileMatched: { backgroundColor: '#DCFCE7', borderColor: '#86EFAC' }, memoryTileText: { fontSize: 29, fontWeight: '800' }, memoryTileHidden: { color: '#BFDBFE', fontSize: 31 }, gameFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, gameHint: { flex: 1, color: colors.muted, fontSize: 11 }, newGameButton: { backgroundColor: colors.blue, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 11 }, newGameText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  onlineGamePanel: { padding: 13, borderRadius: 16, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: colors.border, gap: 11 }, onlineInviteRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, onlineInviteInput: { flex: 1, minWidth: 0, marginBottom: 0 }, onlineInviteButton: { minHeight: 46, justifyContent: 'center' }, onlineInviteCard: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, padding: 10, backgroundColor: '#EFF6FF' }, onlineInviteTitle: { color: colors.text, fontSize: 12, fontWeight: '800' }, onlineUsername: { color: colors.muted, fontSize: 12 }, onlineUsernameValue: { color: colors.blue, fontWeight: '800' }, onlineMatchHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  ludoPlayerList: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, ludoPlayerName: { color: colors.text, fontSize: 11, fontWeight: '700' }, ludoPlayerBadge: { minWidth: 74, paddingHorizontal: 9, paddingVertical: 7, borderRadius: 11, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.border, alignItems: 'center' }, ludoNameGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 7 }, ludoNameInput: { width: '48%', flexGrow: 1, marginBottom: 0 }, ludoRuleToggle: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 5 }, ludoRuleCheck: { width: 20, height: 20, borderRadius: 5, overflow: 'hidden', textAlign: 'center', textAlignVertical: 'center', backgroundColor: '#DBEAFE', color: colors.blue, fontWeight: '900', borderWidth: 1, borderColor: colors.blue }, ludoMoveChoicePanel: { padding: 12, borderWidth: 1, borderColor: '#BFDBFE', borderRadius: 14, backgroundColor: '#EFF6FF', gap: 10 }, ludoMoveChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, ludoMoveChoice: { flexGrow: 1, flexBasis: '45%', minWidth: 120, padding: 12, borderRadius: 12, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#BFDBFE', gap: 3 }, ludoMoveChoiceTitle: { color: colors.blue, fontSize: 13, fontWeight: '900' }, ludoMoveChoiceSubtitle: { color: colors.muted, fontSize: 11, fontWeight: '600' }, ludoBoard: { width: '100%', maxWidth: 420, aspectRatio: 1, alignSelf: 'center', position: 'relative', borderRadius: 4, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#64748B', overflow: 'hidden' }, ludoGrid: { position: 'absolute', width: '100%', height: '100%' }, ludoGridRow: { flexDirection: 'row', flex: 1 }, ludoGridCell: { flex: 1, aspectRatio: 1, borderWidth: 0.5, borderColor: '#94A3B8', alignItems: 'center', justifyContent: 'center' }, ludoGridBlank: { backgroundColor: '#FFFFFF' }, ludoPathCell: { backgroundColor: '#FFFFFF' }, ludoSafeCell: { backgroundColor: '#F8FAFC', borderColor: '#64748B' }, ludoHomeBox: { position: 'absolute', width: '40%', height: '40%', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#475569' }, ludoHomeInner: { width: '76%', height: '76%', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#334155', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-evenly' }, ludoHomeDot: { width: '35%', aspectRatio: 1, borderRadius: 100, borderWidth: 1.5, borderColor: '#475569', elevation: 2 }, ludoCenterMark: { position: 'absolute', left: '40%', top: '40%', width: '20%', height: '20%', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center' }, ludoTrackCell: { borderColor: '#334155', borderWidth: 1 }, ludoCellNumber: { fontSize: 8, color: colors.blue }, ludoPiece: { position: 'absolute', width: '6%', height: '6%', marginLeft: -9, marginTop: -9, borderRadius: 100, borderWidth: 1.5, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', elevation: 3 }, ludoPieceSelectable: { borderColor: '#111827', borderWidth: 2.5, transform: [{ scale: 1.2 }] }, ludoPieceText: { color: '#FFFFFF', fontSize: 9, fontWeight: '900' }, ludoCenter: { position: 'absolute', left: '50%', top: '50%', width: 30, height: 30, marginLeft: -15, marginTop: -15, borderRadius: 6, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }, ludoDice: { fontSize: 18, fontWeight: '900', color: colors.text },
  exportButton: { backgroundColor: colors.blue, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' }, exportDisabled: { opacity: 0.45 }, exportButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' }, historyDayCard: { backgroundColor: colors.card, borderRadius: 15, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }, sessionToggle: { color: colors.blue, fontSize: 10, fontWeight: '700' }, sessionList: { borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#F8FAFC' }, sessionEntry: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }, sessionLabel: { color: colors.muted, fontSize: 10, fontWeight: '700', width: 58 }, sessionTime: { color: colors.text, fontSize: 11, fontWeight: '700', flex: 1 }, sessionDuration: { color: colors.muted, fontSize: 10 },
  chatJoinDivider: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }, chatDividerLine: { flex: 1, height: 1, backgroundColor: colors.border }, guestAction: { backgroundColor: '#0F766E' }, guestActionText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  heroCatLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }, heroCatImage: { position: 'absolute', width: '100%', height: '100%' }, heroCatShade: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.navy }, heroCatPaw: { position: 'absolute', left: '55%', bottom: '15%', width: 45, height: 88, transformOrigin: 'bottom center' }, heroCatPawArm: { position: 'absolute', left: 15, bottom: 0, width: 15, height: 62, borderRadius: 10, backgroundColor: '#E8953D', borderWidth: 2, borderColor: '#FFD17A' }, heroCatPawPalm: { position: 'absolute', left: 3, top: 8, width: 40, height: 34, borderRadius: 20, backgroundColor: '#E8953D', borderWidth: 2, borderColor: '#FFD17A' }, heroCatToe: { position: 'absolute', top: 2, width: 12, height: 17, borderRadius: 9, backgroundColor: '#E8953D', borderWidth: 1, borderColor: '#FFD17A' }, heroCatToeOne: { left: 5 }, heroCatToeTwo: { left: 17, top: -1 }, heroCatToeThree: { left: 29 }, heroCatBlink: { position: 'absolute', left: '31%', top: '24%', width: '9%', height: '4%', borderRadius: 99, backgroundColor: '#EAA34B', alignItems: 'center', justifyContent: 'center' }, heroCatBlinkLine: { width: '72%', height: 1.5, borderRadius: 2, backgroundColor: '#60351E', transform: [{ rotate: '-5deg' }] }, greetingPill: { backgroundColor: 'rgba(15, 118, 110, 0.92)', paddingVertical: 9, paddingHorizontal: 12, borderRadius: 12 }, greetingPillText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' }, catGreetingCard: { width: '100%', maxWidth: 420, backgroundColor: '#FFFFFF', borderRadius: 26, paddingHorizontal: 24, paddingVertical: 27, alignItems: 'center', gap: 10, borderWidth: 1, borderColor: '#CFECE8' }, catSpeech: { backgroundColor: '#DCFCE7', paddingHorizontal: 18, paddingVertical: 9, borderRadius: 16, borderBottomLeftRadius: 4 }, catSpeechText: { color: '#166534', fontSize: 15, fontWeight: '900' }, catGreetingTitle: { color: colors.text, fontSize: 23, fontWeight: '900', textAlign: 'center' }, catGreetingBody: { color: colors.muted, fontSize: 13, lineHeight: 19, textAlign: 'center', maxWidth: 280 }, actionPrimarySmall: { backgroundColor: colors.blue, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 20, marginTop: 7 }, officeByeRow: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: '#F0FDF4', borderRadius: 13, padding: 10 }, officeOutActions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 }, officeOutButton: { backgroundColor: '#B91C1C', borderRadius: 13, paddingVertical: 12, paddingHorizontal: 9, alignItems: 'center', marginTop: 12 }, officeOutText: { color: '#FFFFFF', fontWeight: '900', fontSize: 12, textAlign: 'center' }, undoOfficeOutButton: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#B91C1C', borderRadius: 13, paddingVertical: 11, paddingHorizontal: 12 }, undoOfficeOutText: { color: '#B91C1C', fontWeight: '800', fontSize: 11 }, officeSummaryModal: { width: '100%', maxWidth: 560, maxHeight: '90%', backgroundColor: colors.card, borderRadius: 18, padding: 16, gap: 13 }, officeSummaryTotals: { flexDirection: 'row', gap: 10, padding: 12, backgroundColor: '#F1F5F9', borderRadius: 12 }, officeSummaryWork: { color: colors.blue, fontSize: 18, fontWeight: '900', marginTop: 5 }, officeSummaryBreak: { color: '#B91C1C', fontSize: 18, fontWeight: '900', marginTop: 5 }, officeSummaryRow: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: '#F8FAFC', borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 10 }, officeSummaryText: { color: colors.text, fontSize: 12, fontWeight: '800' },
  miloFab: { position: 'absolute', zIndex: 90, elevation: 12, right: 18, bottom: 20, width: 68, height: 68, borderRadius: 34, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D9E9E8', padding: 7, alignItems: 'center', justifyContent: 'center', shadowColor: '#0F172A', shadowOpacity: 0.2, shadowRadius: 14, shadowOffset: { width: 0, height: 5 } }, miloFabHovered: { width: 226, height: 68, borderRadius: 36, paddingHorizontal: 8, paddingVertical: 7, flexDirection: 'row', justifyContent: 'flex-start', gap: 10 }, miloFabAvatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#DFF4F3', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }, miloFabEmoji: { fontSize: 32, lineHeight: 40 }, miloFabCopy: { flex: 1 }, miloFabName: { color: '#122033', fontSize: 15, lineHeight: 20, fontWeight: '800' }, miloFabCaption: { color: '#527078', fontSize: 11, lineHeight: 15, fontWeight: '600' }, miloOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(15, 23, 42, 0.54)', padding: 14 }, miloModalCard: { width: '100%', maxWidth: 560, height: '84%', maxHeight: 720, minHeight: 360, backgroundColor: colors.card, borderRadius: 20, padding: 16, gap: 12 }, miloPanelCompact: { flex: 1, minHeight: 0 }, miloMessagesCompact: { flex: 1, minHeight: 140 },
  callActions: { flexDirection: 'row', alignItems: 'center', gap: 6 }, callButton: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: '#BFDBFE' }, callButtonText: { color: colors.blue, fontSize: 18, fontWeight: '900' }, callHint: { color: colors.muted, fontSize: 10, lineHeight: 15 }, callError: { color: '#B91C1C', fontSize: 12, lineHeight: 18 }, callModal: { width: '100%', maxWidth: 460, backgroundColor: colors.card, borderRadius: 22, padding: 20, gap: 13, alignItems: 'center' }, callAvatar: { width: 82, height: 82, borderRadius: 41, backgroundColor: '#DBEAFE', alignItems: 'center', justifyContent: 'center' }, callAvatarText: { color: colors.blue, fontSize: 35, fontWeight: '900' }, callModalActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, flexWrap: 'wrap', marginTop: 8 }, callControl: { minWidth: 92, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 14, backgroundColor: '#475569', alignItems: 'center' }, callControlText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' }, callAccept: { backgroundColor: '#15803D' }, callDecline: { backgroundColor: '#B91C1C' }, callControlMuted: { backgroundColor: '#64748B' }, callVideoStage: { width: '100%', minHeight: 240, maxHeight: 390, flexDirection: 'row', gap: 8 }, groupCallVideoStage: { flexWrap: 'wrap', maxHeight: 500 }, groupCallVideoTile: { height: 150, minWidth: 120, flexBasis: '44%' }, callVideoTile: { flex: 1, minWidth: 140, height: 260, borderRadius: 14, overflow: 'hidden', backgroundColor: '#0F172A', alignItems: 'center', justifyContent: 'center' }, callVideoLabel: { position: 'absolute', left: 8, bottom: 8, color: '#FFFFFF', fontSize: 10, fontWeight: '800', backgroundColor: 'rgba(15,23,42,0.7)', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8 }, callVideoWaiting: { position: 'absolute', color: '#FFFFFF', fontSize: 11 }, callVoiceStage: { minHeight: 185, alignItems: 'center', justifyContent: 'center', gap: 8 }, callPeerName: { color: colors.text, fontSize: 18, fontWeight: '800' },
  callActiveCard: { backgroundColor: '#F0FDF4', borderWidth: 1, borderColor: '#BBF7D0', borderRadius: 15, padding: 12, gap: 11 }, callVideoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, callVideo: { minHeight: 120, flex: 1, backgroundColor: '#0F172A', borderRadius: 12, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }, callHistoryRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, borderTopWidth: 1, borderTopColor: colors.border }, callRingCard: { width: '100%', maxWidth: 370, backgroundColor: colors.card, borderRadius: 20, padding: 22, alignItems: 'center', gap: 12 }, callRingIcon: { color: colors.blue, fontSize: 38, fontWeight: '900' }, dangerAction: { backgroundColor: '#B91C1C' }, outlineAction: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.border },
  chatCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 22, padding: 16, gap: 13 }, miloModeRow: { flexDirection: 'row', backgroundColor: '#E9EEF5', padding: 4, borderRadius: 12, gap: 5 }, miloModeButton: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 9 }, miloModeSelected: { backgroundColor: '#FFFFFF', elevation: 1 }, miloModeText: { color: colors.muted, fontSize: 12, fontWeight: '700' }, miloModeTextSelected: { color: colors.blue }, miloPanel: { gap: 12, paddingTop: 2 }, miloIntro: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#F0FDF4', borderRadius: 14, padding: 12 }, miloAvatar: { width: 42, height: 42, borderRadius: 14, backgroundColor: '#DCFCE7', alignItems: 'center', justifyContent: 'center' }, miloAvatarText: { fontSize: 23 }, miloMessages: { maxHeight: 390, minHeight: 190, backgroundColor: '#F8FAFC', borderRadius: 14 }, miloMessagesContent: { padding: 11, gap: 9 }, miloBubble: { maxWidth: '92%', borderRadius: 14, padding: 11, gap: 6 }, miloBubbleUser: { alignSelf: 'flex-end', backgroundColor: '#DBEAFE', borderBottomRightRadius: 4 }, miloBubbleAgent: { alignSelf: 'flex-start', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: 4 }, miloThinking: { flexDirection: 'row', alignItems: 'center', gap: 8 }, miloBubbleText: { color: colors.text, fontSize: 13, lineHeight: 19 }, miloSource: { color: colors.blue, fontSize: 10, fontWeight: '700', marginTop: 3 }, miloSuggestions: { gap: 6 }, miloSuggestion: { borderWidth: 1, borderColor: '#BFDBFE', borderRadius: 10, backgroundColor: '#F8FBFF', padding: 9 }, miloSuggestionText: { color: colors.blue, fontSize: 11, fontWeight: '700' }, miloError: { color: '#B91C1C', fontSize: 12, lineHeight: 18 }, miloDisclaimer: { color: colors.muted, fontSize: 10, lineHeight: 15 }, miloUploadSuccess: { color: '#15803D', fontSize: 11, fontWeight: '700' }, chatHeading: { flexDirection: 'row', alignItems: 'center', gap: 11 }, chatAvatar: { width: 43, height: 43, borderRadius: 15, backgroundColor: '#DBEAFE', alignItems: 'center', justifyContent: 'center' }, chatAvatarText: { color: colors.blue, fontSize: 22, fontWeight: '800' }, chatPresence: { color: colors.muted, fontSize: 10, marginTop: 3 }, onlineBadge: { color: '#15803D', fontSize: 9, fontWeight: '900', backgroundColor: '#DCFCE7', overflow: 'hidden', borderRadius: 99, paddingHorizontal: 8, paddingVertical: 6 }, chatJoin: { gap: 12, paddingVertical: 12 }, chatWelcome: { color: colors.text, fontSize: 17, fontWeight: '800' }, chatIdentity: { borderRadius: 10, backgroundColor: '#F8FAFC', padding: 9 }, chatIdentityText: { color: colors.muted, fontSize: 10, fontWeight: '700' }, chatMessages: { maxHeight: 430, minHeight: 220, backgroundColor: '#F8FAFC', borderRadius: 16 }, chatMessagesContent: { flexGrow: 1, justifyContent: 'flex-end', padding: 12, gap: 9 }, chatEmpty: { flex: 1, minHeight: 190, alignItems: 'center', justifyContent: 'center', gap: 7 }, chatEmptyIcon: { fontSize: 30 }, chatBubble: { maxWidth: '88%', borderRadius: 15, paddingHorizontal: 12, paddingVertical: 9, gap: 5 }, chatBubbleMine: { alignSelf: 'flex-end', backgroundColor: '#DBEAFE', borderBottomRightRadius: 5 }, chatBubbleOther: { alignSelf: 'flex-start', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: 5 }, chatSender: { color: colors.blue, fontSize: 10, fontWeight: '800' }, chatBody: { color: colors.text, fontSize: 13, lineHeight: 19 }, chatTime: { color: colors.muted, fontSize: 9, alignSelf: 'flex-end' }, mediaButton: { minWidth: 185, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 11, padding: 10, backgroundColor: 'rgba(255,255,255,0.75)', borderWidth: 1, borderColor: colors.border }, mediaIcon: { color: colors.blue, fontSize: 19, fontWeight: '800' }, mediaTitle: { color: colors.text, fontSize: 11, fontWeight: '800' }, mediaHint: { color: colors.muted, fontSize: 9, marginTop: 2 }, mediaChevron: { color: colors.blue, fontSize: 21 }, chatComposer: { gap: 9 }, chatTools: { flexDirection: 'row', gap: 8 }, chatTool: { backgroundColor: '#F1F5F9', borderRadius: 10, paddingHorizontal: 11, paddingVertical: 8 }, chatToolText: { color: colors.blue, fontSize: 10, fontWeight: '800' }, recordingTool: { backgroundColor: '#FEE2E2' }, recordingText: { color: '#B91C1C' }, chatInputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 }, chatInput: { flex: 1, maxHeight: 110, minHeight: 43, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: colors.border, borderRadius: 13, paddingHorizontal: 12, paddingVertical: 11, color: colors.text, fontSize: 13 }, sendButton: { width: 43, height: 43, borderRadius: 13, backgroundColor: colors.blue, alignItems: 'center', justifyContent: 'center' }, sendButtonText: { color: '#FFFFFF', fontSize: 24, lineHeight: 28, fontWeight: '800' }, attachmentPreview: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#EFF6FF', borderRadius: 10, padding: 10 }, attachmentText: { color: colors.text, fontSize: 10, fontWeight: '700', flex: 1 }, onceToggle: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 3 }, onceCheckbox: { width: 18, height: 18, borderRadius: 5, borderWidth: 1, borderColor: colors.blue, backgroundColor: '#EFF6FF', textAlign: 'center', overflow: 'hidden', color: colors.blue, fontSize: 12, fontWeight: '900' }, onceText: { color: colors.muted, fontSize: 10, flex: 1 }, mediaOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(15, 23, 42, 0.82)', padding: 18 }, mediaModal: { width: '100%', maxWidth: 620, maxHeight: '90%', backgroundColor: colors.card, borderRadius: 18, padding: 15, gap: 12 }, mediaImage: { width: '100%', height: 420 }, onceFootnote: { color: colors.muted, fontSize: 10, textAlign: 'center' },
  updateOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.58)', alignItems: 'center', justifyContent: 'center', padding: 22 }, updateCard: { width: '100%', maxWidth: 420, backgroundColor: colors.card, borderRadius: 24, padding: 25, gap: 13, borderWidth: 1, borderColor: colors.border, shadowColor: '#0F172A', shadowOpacity: 0.2, shadowRadius: 24, elevation: 8 }, updateBadge: { alignSelf: 'flex-start', backgroundColor: '#DBEAFE', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 6 }, updateBadgeText: { color: colors.blue, fontSize: 10, fontWeight: '900', letterSpacing: 1 }, updateTitle: { color: colors.text, fontSize: 24, lineHeight: 30, fontWeight: '900' }, updateSummary: { color: colors.muted, fontSize: 14, lineHeight: 21 }, updateMeta: { color: colors.muted, fontSize: 11 }, updatePrimary: { backgroundColor: colors.blue, paddingVertical: 14, borderRadius: 13, alignItems: 'center', marginTop: 4 }, updatePrimaryText: { color: '#FFFFFF', fontWeight: '800', fontSize: 13 }, updateLater: { paddingVertical: 9, alignItems: 'center' }, updateLaterText: { color: colors.muted, fontWeight: '700', fontSize: 12 },
  monthBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 }, monthArrow: { fontSize: 28, color: colors.blue, paddingHorizontal: 10 }, monthTitle: { color: colors.text, fontSize: 18, fontWeight: '800' }, summaryStrip: { flexDirection: 'row', justifyContent: 'space-around', backgroundColor: '#EFF6FF', borderRadius: 15, padding: 16 }, monthStat: { color: colors.text, fontSize: 18, fontWeight: '800', marginTop: 5 }, historyRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.card, borderRadius: 15, borderWidth: 1, borderColor: colors.border, padding: 12 }, historyDate: { width: 43, height: 48, borderRadius: 11, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' }, historyDay: { color: colors.blue, fontSize: 9, fontWeight: '700' }, historyNum: { color: colors.text, fontSize: 16, fontWeight: '800' }, historyMain: { flex: 1, gap: 5 }, historyTitle: { color: colors.text, fontSize: 12, fontWeight: '800' }, historySub: { color: colors.muted, fontSize: 10 }, historyHours: { color: colors.text, fontSize: 12, fontWeight: '800' }, clearCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 14, flexDirection: 'row', justifyContent: 'flex-end' }, clearCompact: { alignItems: 'flex-end', gap: 5 }, clearText: { color: colors.text, fontSize: 12, flex: 1 }, clearActions: { flexDirection: 'row', gap: 14, alignItems: 'center' }, clearDanger: { color: '#B91C1C', fontWeight: '800', fontSize: 12 }, empty: { padding: 26, alignItems: 'center', backgroundColor: '#F8FAFC', borderRadius: 15, gap: 6 }, emptyTitle: { color: colors.text, fontWeight: '800', fontSize: 14 }, hrRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, borderTopWidth: 1, borderTopColor: colors.border, gap: 10 }, hrActions: { gap: 9 }, approve: { color: '#15803D', fontWeight: '800', fontSize: 11 }, reject: { color: '#B91C1C', fontWeight: '800', fontSize: 11 },
  footerCard: { backgroundColor: '#EFF6FF', padding: 15, borderRadius: 14, gap: 5 }, footerTitle: { color: '#1D4ED8', fontSize: 12, fontWeight: '800' }, footerText: { color: '#1E40AF', fontSize: 11, lineHeight: 17 }, footer: { color: colors.muted, fontSize: 10, textAlign: 'center' }, authWrap: { flex: 1, justifyContent: 'center', padding: 20 }, authCard: { width: '100%', maxWidth: 430, alignSelf: 'center', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 22, padding: 24, gap: 14 }, input: { backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: colors.border, borderRadius: 11, padding: 13, color: colors.text, fontSize: 14 }, textButton: { alignItems: 'center', padding: 8 },
});
