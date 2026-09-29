import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

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
        title: 'OfficeTime reminder',
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
      browserTimers.delete(kind);
    }, Math.max(1000, milliseconds));
    browserTimers.set(kind, timer);
    return;
  }
  await Notifications.requestPermissionsAsync();
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const item of scheduled) {
    if (item.content.data?.kind === kind) await Notifications.cancelScheduledNotificationAsync(item.identifier);
  }
  await Notifications.scheduleNotificationAsync({
    content: { title, body, data: { kind } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: Math.max(1, Math.ceil(milliseconds / 1000)) },
  });
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
