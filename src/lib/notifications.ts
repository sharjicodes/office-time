import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export const LATE_ALERT_SOUND = 'late-warning.wav';
export const WORK_CHEER_SOUND = 'work-celebration.wav';
const LATE_CHANNEL = 'late-login-alerts-v1';
const CHEER_CHANNEL = 'work-hour-cheers-v1';
let webAudioContext: AudioContext | null = null;

export function prepareAttendanceNotificationAudio() {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.AudioContext) return;
  webAudioContext ??= new window.AudioContext();
  if (webAudioContext.state === 'suspended') void webAudioContext.resume();
}

export async function prepareAttendanceNotifications() {
  prepareAttendanceNotificationAudio();
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && 'Notification' in window && window.Notification.permission === 'default')
      await window.Notification.requestPermission();
    return;
  }
  await Notifications.requestPermissionsAsync();
  await configureSoundChannels();
}

function playWebNoticeTone(isLate: boolean) {
  if (Platform.OS !== 'web' || !webAudioContext || webAudioContext.state !== 'running') return;
  const context = webAudioContext;
  const notes = isLate ? [880, 660, 880] : [523, 659, 784, 1047, 784, 1047, 1319];
  const spacing = isLate ? 0.23 : 0.19;
  notes.forEach((frequency, index) => {
    const start = context.currentTime + index * spacing;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.24, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + (isLate ? 0.19 : 0.38));
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + (isLate ? 0.2 : 0.4));
  });
}

function playWebFireworksSound() {
  if (Platform.OS !== 'web' || !webAudioContext || webAudioContext.state !== 'running') return;
  const context = webAudioContext;
  // Twelve quick reports follow the staggered screen-wide bursts.
  for (let burst = 0; burst < 12; burst += 1) {
    const start = context.currentTime + burst * 0.34;
    const length = Math.floor(context.sampleRate * 0.14);
    const noise = context.createBuffer(1, length, context.sampleRate);
    const samples = noise.getChannelData(0);
    for (let sample = 0; sample < length; sample += 1) samples[sample] = Math.random() * 2 - 1;
    const crackle = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    crackle.buffer = noise;
    filter.type = 'highpass';
    filter.frequency.value = 950;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.18, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
    crackle.connect(filter).connect(gain).connect(context.destination);
    crackle.start(start);

    // Add sharp pops over each short noise burst for a cracker-like report.
    for (let pop = 0; pop < 3; pop += 1) {
      const popAt = start + 0.012 + pop * 0.031;
      const oscillator = context.createOscillator();
      const popGain = context.createGain();
      oscillator.type = pop % 2 ? 'square' : 'triangle';
      oscillator.frequency.value = 520 + ((burst * 179 + pop * 317) % 1200);
      popGain.gain.setValueAtTime(0.0001, popAt);
      popGain.gain.exponentialRampToValueAtTime(0.085, popAt + 0.005);
      popGain.gain.exponentialRampToValueAtTime(0.0001, popAt + 0.045);
      oscillator.connect(popGain).connect(context.destination);
      oscillator.start(popAt);
      oscillator.stop(popAt + 0.05);
    }
  }
}

async function configureSoundChannels() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(LATE_CHANNEL, {
    name: 'Late login alerts', description: 'Loud reminder for punch-ins after the flexible start limit.',
    importance: Notifications.AndroidImportance.HIGH, sound: LATE_ALERT_SOUND,
    vibrationPattern: [0, 350, 120, 350], lightColor: '#DC2626',
  });
  await Notifications.setNotificationChannelAsync(CHEER_CHANNEL, {
    name: 'Work hour achievements', description: 'Celebrations when the daily work target is reached.',
    importance: Notifications.AndroidImportance.HIGH, sound: WORK_CHEER_SOUND,
    vibrationPattern: [0, 180, 80, 180, 80, 400], lightColor: '#16A34A',
  });
}

export async function scheduleDailyReminder(): Promise<boolean> {
  // Expo local notifications are native-only. Browser notifications require a
  // foreground tab and an explicit user gesture, so don't prompt on page load.
  if (Platform.OS === 'web') return false;
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) return false;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('attendance-reminders', {
      name: 'Attendance reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#2563EB',
    });
    await configureSoundChannels();
  }

  // Avoid duplicate reminders when the app is opened repeatedly.
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const item of scheduled) {
    if (item.content.data?.kind === 'morning-attendance-reminder') {
      await Notifications.cancelScheduledNotificationAsync(item.identifier);
    }
  }

  // Policy workweek is Monday-Friday. Expo weekday values use Sunday=1.
  for (const weekday of [2, 3, 4, 5, 6]) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Milo reminder',
        body: 'Your standard start time is 9:00 AM. Remember to punch in.',
        data: { kind: 'morning-attendance-reminder' },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday, hour: 8, minute: 50 },
    });
  }
  return true;
}

const browserTimers = new Map<string, ReturnType<typeof setTimeout>>();

export async function scheduleTimedReminder(kind: string, title: string, body: string, milliseconds: number) {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    const permission = await window.Notification.requestPermission();
    if (permission !== 'granted') return;
    const old = browserTimers.get(kind);
    if (old) clearTimeout(old);
    const timer = setTimeout(() => {
      new window.Notification(title, { body });
      if (kind === 'work-target') playWebNoticeTone(false);
      browserTimers.delete(kind);
    }, Math.max(1000, milliseconds));
    browserTimers.set(kind, timer);
    return;
  }
  await Notifications.requestPermissionsAsync();
  await configureSoundChannels();
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const item of scheduled) {
    if (item.content.data?.kind === kind) await Notifications.cancelScheduledNotificationAsync(item.identifier);
  }
  const isWorkAchievement = kind === 'work-target';
  await Notifications.scheduleNotificationAsync({
    content: { title, body, data: { kind }, sound: isWorkAchievement ? WORK_CHEER_SOUND : 'default',
      priority: Notifications.AndroidNotificationPriority.HIGH,
      vibrate: isWorkAchievement ? [0, 180, 80, 180, 80, 400] : [0, 250, 180, 250] },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: Math.max(1, Math.ceil(milliseconds / 1000)),
      ...(Platform.OS === 'android' ? { channelId: isWorkAchievement ? CHEER_CHANNEL : 'attendance-reminders' } : {}) },
  });
}

export async function showLateLoginWarning(title: string, body: string): Promise<boolean> {
  playWebNoticeTone(true);
  return showAttendanceNotice('late-login', title, body);
}

export async function showWorkHourCongratulations(title: string, body: string): Promise<boolean> {
  playWebFireworksSound();
  return showAttendanceNotice('work-target', title, body);
}

async function showAttendanceNotice(kind: string, title: string, body: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined' || !('Notification' in window)) return false;
    if (window.Notification.permission !== 'granted') await window.Notification.requestPermission();
    if (window.Notification.permission !== 'granted') return false;
    new window.Notification(title, { body });
    return true;
  }
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) return false;
  await configureSoundChannels();
  const isLate = kind === 'late-login';
  await Notifications.scheduleNotificationAsync({
    content: { title, body, data: { kind }, sound: isLate ? LATE_ALERT_SOUND : WORK_CHEER_SOUND,
      priority: Notifications.AndroidNotificationPriority.HIGH,
      vibrate: isLate ? [0, 350, 120, 350] : [0, 180, 80, 180, 80, 400] },
    trigger: Platform.OS === 'android' ? { channelId: isLate ? LATE_CHANNEL : CHEER_CHANNEL } : null,
  });
  return true;
}

export async function cancelReminder(kind: string) {
  if (Platform.OS === 'web') {
    const timer = browserTimers.get(kind);
    if (timer) clearTimeout(timer);
    browserTimers.delete(kind);
    return;
  }
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const item of scheduled) {
    if (item.content.data?.kind === kind) await Notifications.cancelScheduledNotificationAsync(item.identifier);
  }
}
