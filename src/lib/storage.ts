import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { AttendanceDay, DEFAULT_POLICY, localDateKey } from './attendance';
import { supabase } from './supabase';

const DAYS_KEY = 'officetime.attendance.v1';
const POLICY_KEY = 'officetime.policy.v1';
async function daysKey() {
  try {
    const { data } = await supabase?.auth.getSession() ?? { data: { session: null } };
    return `${DAYS_KEY}.${data.session?.user.id ?? 'device'}`;
  } catch { return `${DAYS_KEY}.device`; }
}

export async function loadDays(): Promise<AttendanceDay[]> {
  try {
    const { data: { user } } = await supabase?.auth.getUser() ?? { data: { user: null } };
    const state = await NetInfo.fetch();
    if (supabase && user && state.isConnected) {
      const { data, error } = await supabase.from('attendance_days').select('*').order('work_date', { ascending: false }).limit(370);
      if (!error && data) {
        const remote = data.map(fromRemote);
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

function fromRemote(row: any): AttendanceDay {
  return { id: row.id, user_id: row.user_id, date: row.work_date,
    punchInAt: row.punch_in_at, punchOutAt: row.punch_out_at,
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
  if (!user) return;
  const pending = (days ?? await loadLocalDays()).filter(d => !d.synced);
  for (const day of pending) {
    const payload = { user_id: user.id, work_date: day.date, punch_in_at: day.punchInAt,
      punch_out_at: day.punchOutAt, break_minutes: day.breakMinutes,
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
