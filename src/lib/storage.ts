import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { AttendanceDay, DEFAULT_POLICY, getDaySessions, localDateKey } from './attendance';
import { supabase } from './supabase';

const DAYS_KEY = 'officetime.attendance.v1';
const LAST_ATTENDANCE_OWNER_KEY = 'officetime.attendance.last-owner.v1';
const POLICY_KEY = 'officetime.policy.v1';
const DELETED_DAYS_KEY = 'officetime.deleted-days.v1';
async function daysKey() {
  try {
    const { data } = await supabase?.auth.getSession() ?? { data: { session: null } };
    const user = data.session?.user;
    // Guest chat auth is not an employee account; keep attendance device-local.
    if (user?.is_anonymous) return `${DAYS_KEY}.device`;
    if (user) {
      await AsyncStorage.setItem(LAST_ATTENDANCE_OWNER_KEY, user.id);
      return `${DAYS_KEY}.${user.id}`;
    }
    // Signing out must not make the previous employee's local records look lost.
    // Keep the owner-scoped cache selected until another employee signs in.
    const lastOwner = await AsyncStorage.getItem(LAST_ATTENDANCE_OWNER_KEY);
    return `${DAYS_KEY}.${lastOwner || 'device'}`;
  } catch { return `${DAYS_KEY}.device`; }
}

export async function loadDays(): Promise<AttendanceDay[]> {
  try {
    const { data: { user } } = await supabase?.auth.getUser() ?? { data: { user: null } };
    const state = await NetInfo.fetch();
    if (supabase && user && !user.is_anonymous && state.isConnected) {
      const { data, error } = await supabase.from('attendance_days').select('*').order('work_date', { ascending: false }).limit(370);
      if (!error && data) {
        const deleted = await loadDeletedDays();
        const remote = data.map(fromRemote).filter(day => !deleted.includes(day.date));
        const local = JSON.parse(await AsyncStorage.getItem(await daysKey()) || '[]') as AttendanceDay[];
        const merged = [...remote];
        for (const item of local.filter(d => !d.synced)) {
          const index = merged.findIndex(d => d.date === item.date);
          if (index >= 0) merged[index] = item;
          else merged.push(item);
        }
        await AsyncStorage.setItem(await daysKey(), JSON.stringify(merged));
        return merged.sort((a, b) => b.date.localeCompare(a.date));
      }
    }
  } catch { /* retain local copy when offline/backend is unavailable */ }
  try { return JSON.parse(await AsyncStorage.getItem(await daysKey()) || '[]'); } catch { return []; }
}

/** Move attendance created in offline mode into the first real account used on this device. */
export async function migrateDeviceAttendanceToAccount(userId: string) {
  if (!userId) return;
  const deviceKey = `${DAYS_KEY}.device`;
  const accountKey = `${DAYS_KEY}.${userId}`;
  try {
    const [deviceValue, accountValue] = await Promise.all([
      AsyncStorage.getItem(deviceKey),
      AsyncStorage.getItem(accountKey),
    ]);
    const deviceDays = JSON.parse(deviceValue || '[]') as AttendanceDay[];
    if (!deviceDays.length) {
      await AsyncStorage.setItem(LAST_ATTENDANCE_OWNER_KEY, userId);
      return;
    }

    const accountDays = JSON.parse(accountValue || '[]') as AttendanceDay[];
    const merged = [...accountDays];
    for (const day of deviceDays) {
      const index = merged.findIndex(existing => existing.date === day.date);
      // Preserve the offline copy for matching dates; it may contain the latest punches.
      const transferred = { ...day, synced: false };
      if (index >= 0) merged[index] = transferred;
      else merged.push(transferred);
    }
    merged.sort((a, b) => b.date.localeCompare(a.date));

    // Save to the account cache before clearing the device cache, so interrupted
    // sign-ins can safely retry without losing the local attendance records.
    await AsyncStorage.setItem(accountKey, JSON.stringify(merged));
    await AsyncStorage.setItem(LAST_ATTENDANCE_OWNER_KEY, userId);
    await AsyncStorage.setItem(deviceKey, JSON.stringify([]));
    await syncPending(merged);
  } catch {
    // Keep the device copy if storage or sync is temporarily unavailable.
  }
}

async function loadDeletedDays(): Promise<string[]> {
  try { return JSON.parse(await AsyncStorage.getItem(`${DELETED_DAYS_KEY}.${(await daysKey()).split('.').pop()}`) || '[]'); }
  catch { return []; }
}

async function deletedDaysKey() {
  const key = await daysKey();
  return `${DELETED_DAYS_KEY}.${key.slice(DAYS_KEY.length + 1)}`;
}

export async function clearDay(date: string) {
  const key = await daysKey();
  const current = await loadLocalDays();
  await AsyncStorage.setItem(key, JSON.stringify(current.filter(day => day.date !== date)));
  const tombstones = new Set(await loadDeletedDays());
  tombstones.add(date);
  await AsyncStorage.setItem(await deletedDaysKey(), JSON.stringify([...tombstones]));
  await syncPending();
}

function fromRemote(row: any): AttendanceDay {
  return { id: row.id, user_id: row.user_id, date: row.work_date,
    punchInAt: row.punch_in_at, punchOutAt: row.punch_out_at,
    officeOutAt: row.office_out_at ?? null,
    sessions: Array.isArray(row.sessions) && row.sessions.length ? row.sessions : (row.punch_in_at ? [{ punchInAt: row.punch_in_at, punchOutAt: row.punch_out_at }] : []),
    breakMinutes: row.break_minutes ?? DEFAULT_POLICY.defaultBreakMinutes,
    managerApproval: row.manager_approved_late_login ?? false,
    approvalStatus: row.approval_status ?? 'not_required', synced: true };
}

export async function saveDay(day: AttendanceDay): Promise<AttendanceDay> {
  const current = await loadLocalDays();
  const updated = { ...day, synced: false };
  const next = [updated, ...current.filter(d => d.date !== day.date)].sort((a, b) => b.date.localeCompare(a.date));
  await AsyncStorage.setItem(await daysKey(), JSON.stringify(next));
  await syncPending(next);
  return (await loadLocalDays()).find(d => d.date === day.date) ?? updated;
}

async function loadLocalDays(): Promise<AttendanceDay[]> {
  try { return JSON.parse(await AsyncStorage.getItem(await daysKey()) || '[]'); } catch { return []; }
}

export async function syncPending(days?: AttendanceDay[]) {
  if (!supabase) return;
  const state = await NetInfo.fetch();
  if (!state.isConnected) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.is_anonymous) return;
  const deleted = await loadDeletedDays();
  for (const date of deleted) {
    const { error } = await supabase.from('attendance_days').delete().eq('user_id', user.id).eq('work_date', date);
    if (!error) {
      const left = (await loadDeletedDays()).filter(item => item !== date);
      await AsyncStorage.setItem(await deletedDaysKey(), JSON.stringify(left));
    }
  }
  const pending = (days ?? await loadLocalDays()).filter(d => !d.synced);
  for (const day of pending) {
    const payload = { user_id: user.id, work_date: day.date, punch_in_at: day.punchInAt,
      punch_out_at: day.punchOutAt, office_out_at: day.officeOutAt ?? null, sessions: getDaySessions(day), break_minutes: day.breakMinutes,
      manager_approved_late_login: day.managerApproval };
    const { error } = await supabase.from('attendance_days').upsert(payload, { onConflict: 'user_id,work_date' });
    if (!error) {
      const latest = await loadLocalDays();
      await AsyncStorage.setItem(await daysKey(), JSON.stringify(latest.map(d => d.date === day.date ? { ...d, synced: true } : d)));
    }
  }
}

export async function loadPolicy() {
  try { return { ...DEFAULT_POLICY, ...JSON.parse(await AsyncStorage.getItem(POLICY_KEY) || '{}') }; }
  catch { return DEFAULT_POLICY; }
}
export async function savePolicy(config: typeof DEFAULT_POLICY) {
  await AsyncStorage.setItem(POLICY_KEY, JSON.stringify(config));
}
export async function getToday() {
  const days = await loadDays();
  return days.find(d => d.date === localDateKey()) ?? {
    date: localDateKey(), punchInAt: null, punchOutAt: null,
    breakMinutes: DEFAULT_POLICY.defaultBreakMinutes, managerApproval: false, synced: true,
  } satisfies AttendanceDay;
}
