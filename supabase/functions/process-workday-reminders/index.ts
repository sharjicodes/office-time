import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

type Session = { punchInAt?: string; punchOutAt?: string | null; breakMinutes?: number };
type CustomReminder = { id?: string; title?: string; time?: string; days?: number[] };
type DeviceLocalTime = { date: string; weekday: number; hour: number; minute: number };

function localTime(date: Date, zone: string): DeviceLocalTime {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { date: `${value.year}-${value.month}-${value.day}`, weekday: weekdays[value.weekday] ?? 0, hour: Number(value.hour), minute: Number(value.minute) };
}

function parseClock(value: unknown, twelveHour = false): { hour: number; minute: number } | null {
  if (typeof value !== 'string') return null;
  const match = twelveHour
    ? value.trim().match(/^(0?[1-9]|1[0-2]):([0-5]\d)\s*(AM|PM)$/i)
    : value.trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  const hour = Number(match[1]);
  return { hour: twelveHour ? (hour % 12) + (match[3].toUpperCase() === 'PM' ? 12 : 0) : hour, minute: Number(match[2]) };
}

function atTime(local: DeviceLocalTime, time: unknown, twelveHour = false) {
  const parsed = parseClock(time, twelveHour);
  return !!parsed && local.hour === parsed.hour && local.minute === parsed.minute;
}

function workedSeconds(sessions: Session[], now: number) {
  return sessions.reduce((total, session) => {
    const start = Date.parse(session.punchInAt || '');
    const end = session.punchOutAt ? Date.parse(session.punchOutAt) : now;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return total;
    const duration = (end - start) / 1000;
    const deducted = Math.min(duration, Math.max(0, Number(session.breakMinutes) || 0) * 60);
    return total + duration - deducted;
  }, 0);
}

Deno.serve(async request => {
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });
  try {
    const expectedKey = Deno.env.get('MILO_REMINDER_CRON_KEY');
    const receivedKey = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
    if (!expectedKey || receivedKey !== expectedKey) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
    const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
    if (!url || !serviceKey || !publicKey || !privateKey) throw new Error('Reminder push configuration is incomplete.');
    const admin = createClient(url, serviceKey);
    webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') || 'mailto:support@milo.app', publicKey, privateKey);

    const now = new Date();
    const utcToday = now.toISOString().slice(0, 10);
    const dayBefore = new Date(`${utcToday}T00:00:00Z`); dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
    const dayAfter = new Date(`${utcToday}T00:00:00Z`); dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
    const { data: openDays, error: dayError } = await admin.from('attendance_days')
      .select('user_id,work_date,sessions,office_out_at')
      .is('office_out_at', null).gte('work_date', dayBefore.toISOString().slice(0, 10)).lte('work_date', dayAfter.toISOString().slice(0, 10));
    if (dayError) throw dayError;
    const workdays = (openDays ?? []).filter(row => Array.isArray(row.sessions) && row.sessions.length > 0);
    const [{ data: settingRows, error: settingError }, { data: subscriptions, error: pushError }] = await Promise.all([
      admin.from('milo_user_settings').select('user_id,settings'),
      admin.from('milo_push_subscriptions').select('id,user_id,subscription,time_zone'),
    ]);
    if (settingError) throw settingError;
    if (pushError) throw pushError;
    const settings = new Map((settingRows ?? []).map(row => [row.user_id, row.settings ?? {}]));
    let sent = 0;
    let checked = 0;

    async function deliver(subscription: any, occurrenceKey: string, title: string, body: string) {
      const claim = await admin.from('milo_reminder_deliveries').insert({ subscription_id: subscription.id, occurrence_key: occurrenceKey });
      if (claim.error?.code === '23505') return;
      if (claim.error) throw claim.error;
      try {
        await webpush.sendNotification(subscription.subscription, JSON.stringify({ title, body, url: '/', tag: occurrenceKey }));
        sent += 1;
      } catch (error: any) {
        await admin.from('milo_reminder_deliveries').delete().eq('subscription_id', subscription.id).eq('occurrence_key', occurrenceKey);
        if (error?.statusCode === 404 || error?.statusCode === 410)
          await admin.from('milo_push_subscriptions').delete().eq('id', subscription.id);
        else console.error('Milo reminder push failed', error?.statusCode ?? error?.message ?? error);
      }
    }

    for (const subscription of subscriptions ?? []) {
      const zone = typeof subscription.time_zone === 'string' ? subscription.time_zone : 'UTC';
      let local: DeviceLocalTime;
      try { local = localTime(now, zone); } catch { local = localTime(now, 'UTC'); }
      const record = workdays.find(row => row.user_id === subscription.user_id && row.work_date === local.date);
      checked += 1;
      const config = settings.get(subscription.user_id) as any ?? {};
      const preferences = config.preferences ?? {};
      const policy = config.policy ?? {};

      if (preferences.reminderEnabled !== false
        && (preferences.workDays ?? [1, 2, 3, 4, 5]).includes(local.weekday)
        && atTime(local, preferences.reminderTime ?? '08:50')) {
        await deliver(subscription, `punch-in:${local.date}`, 'Milo workday reminder', 'Your workday is about to begin. Remember to punch in.');
      }

      if (!record) continue;
      const sessions = record.sessions as Session[];
      const day = local.date;

      if (preferences.workTargetReminderEnabled !== false) {
        const targetMinutes = Math.max(1, Number(policy.recordedWorkTargetMinutes) || 480);
        if (workedSeconds(sessions, now.getTime()) >= targetMinutes * 60)
          await deliver(subscription, `work-target:${day}`, 'Daily work goal reached! 🎉', `You reached ${Math.floor(targetMinutes / 60)}h ${targetMinutes % 60 ? `${targetMinutes % 60}m` : ''} of recorded work. Congratulations!`);
      }

      const last = sessions[sessions.length - 1];
      if (preferences.breakEndReminderEnabled !== false && last?.punchOutAt && !sessions.some(item => !item.punchOutAt)) {
        const breakStart = Date.parse(last.punchOutAt);
        const breakMinutes = Math.max(15, Number(policy.defaultBreakMinutes) || 0);
        if (Number.isFinite(breakStart) && now.getTime() >= breakStart + breakMinutes * 60_000)
          await deliver(subscription, `break-end:${last.punchOutAt}`, 'Break time is up', `Your expected ${breakMinutes}-minute break has ended. Ready to punch back in?`);
      }

      if (preferences.punchOutReminderEnabled !== false) {
        const current = [...sessions].reverse().find(item => !item.punchOutAt);
        const punchIn = Date.parse(current?.punchInAt ?? '');
        if (Number.isFinite(punchIn) && now.getTime() >= punchIn + 9 * 60 * 60_000)
          await deliver(subscription, `punch-out:${current!.punchInAt}`, 'Don’t forget to punch out', 'Your attendance session has been open for 9 hours.');
      }

      for (const reminder of (preferences.customReminders ?? []) as CustomReminder[]) {
        if (!reminder.id || !reminder.title?.trim() || !Array.isArray(reminder.days)
          || !reminder.days.includes(local.weekday) || !atTime(local, reminder.time, true)) continue;
        await deliver(subscription, `custom:${reminder.id}:${day}`, reminder.title.slice(0, 100), `It’s time for ${reminder.title.toLowerCase().slice(0, 180)}.`);
      }
    }

    if (now.getUTCHours() === 3 && now.getUTCMinutes() === 0)
      await admin.from('milo_reminder_deliveries').delete().lt('delivered_at', new Date(now.getTime() - 45 * 86400_000).toISOString());
    return Response.json({ checked, sent });
  } catch (error: any) {
    console.error('process-workday-reminders failed', error);
    return Response.json({ error: 'Could not process reminders.' }, { status: 500 });
  }
});
