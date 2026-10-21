import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { AttendanceDay, DEFAULT_POLICY, getDaySessions, localDateKey } from './attendance';
import { supabase } from './supabase';

const DAYS_KEY = 'officetime.attendance.v1';
const LAST_ATTENDANCE_OWNER_KEY = 'officetime.attendance.last-owner.v1';
const POLICY_KEY = 'officetime.policy.v1';
const DELETED_DAYS_KEY = 'officetime.deleted-days.v1';
const PREFERENCES_KEY = 'officetime.preferences.v1';
const PROFILE_KEY = 'officetime.profile.v1';

export type MiloProfile = { displayName: string; username: string; jobRole: string; photoUrl: string };
export const DEFAULT_MILO_PROFILE: MiloProfile = { displayName: '', username: '', jobRole: 'Other', photoUrl: '' };

export type MiloPreferences = {
  reminderEnabled: boolean;
  reminderTime: string;
  workTargetReminderEnabled: boolean;
  breakEndReminderEnabled: boolean;
  punchOutReminderEnabled: boolean;
  workDays: number[];
  customReminders: CustomWorkReminder[];
  largerText: boolean;
  fontSizeScale: number;
  fontFamily: 'system' | 'serif' | 'rounded' | 'mono';
  animationsEnabled: boolean;
  reducedMotion: boolean;
  highContrast: boolean;
};

export type CustomWorkReminder = { id: string; title: string; scheduleType?: 'interval' | 'time'; intervalMinutes?: number; time?: string; days?: number[] };

export const DEFAULT_PREFERENCES: MiloPreferences = {
  reminderEnabled: true,
  reminderTime: '08:50',
  workTargetReminderEnabled: true,
  breakEndReminderEnabled: true,
  punchOutReminderEnabled: true,
  workDays: [1, 2, 3, 4, 5],
  customReminders: [],
  largerText: false,
  fontSizeScale: 1,
  fontFamily: 'system',
  animationsEnabled: false,
  reducedMotion: false,
  highContrast: false,
};
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
  const local = await readSettings();
  if (local.pendingSync && await writeCloudSettings(local)) { local.pendingSync = false; await writeLocalSettings(local); }
  const remote = await readCloudSettings();
  if (remote?.policy) {
    const merged = { ...DEFAULT_POLICY, ...local.policy, ...remote.policy };
    await writeLocalSettings({ ...local, policy: merged });
    return merged;
  }
  return { ...DEFAULT_POLICY, ...local.policy };
}
export async function savePolicy(config: typeof DEFAULT_POLICY) {
  const local = await readSettings();
  const next = { ...local, policy: config, pendingSync: true };
  await writeLocalSettings(next);
  if (await writeCloudSettings(next)) { next.pendingSync = false; await writeLocalSettings(next); }
}

export async function loadPreferences(): Promise<MiloPreferences> {
  const local = await readSettings();
  if (local.pendingSync && await writeCloudSettings(local)) { local.pendingSync = false; await writeLocalSettings(local); }
  const remote = await readCloudSettings();
  const preferences = { ...DEFAULT_PREFERENCES, ...local.preferences, ...remote?.preferences };
  const savedTextScale = remote?.preferences?.fontSizeScale ?? local.preferences?.fontSizeScale;
  preferences.fontSizeScale = typeof savedTextScale === 'number' ? savedTextScale : preferences.largerText ? 1.12 : 1;
  preferences.customReminders = (preferences.customReminders ?? []).map(reminder => ({
    ...reminder,
    scheduleType: reminder.scheduleType ?? 'interval',
    intervalMinutes: reminder.intervalMinutes || 60,
  }));
  if (remote?.preferences) await writeLocalSettings({ ...local, preferences });
  return preferences;
}

export async function savePreferences(preferences: MiloPreferences) {
  const local = await readSettings();
  const next = { ...local, preferences, pendingSync: true };
  await writeLocalSettings(next);
  if (await writeCloudSettings(next)) { next.pendingSync = false; await writeLocalSettings(next); }
}

export async function loadMiloProfile(): Promise<MiloProfile> {
  const userId = await accountId();
  let local: Partial<MiloProfile> = {};
  const key = `${PROFILE_KEY}.${userId ?? 'device'}`;
  try { local = JSON.parse(await AsyncStorage.getItem(key) || '{}'); } catch { /* use account defaults */ }
  if (userId && local.displayName && local.username && await AsyncStorage.getItem(`${key}.pending`) === 'true' && (await NetInfo.fetch()).isConnected) {
    try { await saveMiloProfile({ ...DEFAULT_MILO_PROFILE, ...local }); } catch { /* keep the local draft until the next sync attempt */ }
  }
  const cloud = await readCloudSettings();
  let account: { display_name?: string | null; username?: string | null; photo_url?: string | null } | null = null;
  let metadata: Record<string, unknown> = {};
  if (userId && supabase) {
    const [{ data }, { data: { user } }] = await Promise.all([
      supabase.from('profiles').select('display_name, username, photo_url').eq('id', userId).maybeSingle(),
      supabase.auth.getUser(),
    ]);
    account = data;
    metadata = user?.user_metadata ?? {};
  }
  const cloudProfile = cloud?.profile ?? {};
  // The per-account local profile is the newest saved copy on this device;
  // a stale settings snapshot must not erase a newly uploaded avatar URL.
  const saved = { ...DEFAULT_MILO_PROFILE, ...cloudProfile, ...local };
  return {
    ...saved,
    displayName: account?.display_name || local.displayName || cloudProfile.displayName || String(metadata.full_name ?? ''),
    username: account?.username || local.username || cloudProfile.username || String(metadata.username ?? ''),
    photoUrl: account?.photo_url || local.photoUrl || cloudProfile.photoUrl || String(metadata.avatar_url ?? ''),
    jobRole: local.jobRole || cloudProfile.jobRole || DEFAULT_MILO_PROFILE.jobRole,
  };
}

export async function saveMiloProfile(profile: MiloProfile): Promise<{ error: string | null; reflect: boolean }> {
  const userId = await accountId();
  const key = `${PROFILE_KEY}.${userId ?? 'device'}`;
  await AsyncStorage.setItem(key, JSON.stringify(profile));
  if (!userId || !supabase) return { error: null, reflect: true };
  await AsyncStorage.setItem(`${key}.pending`, 'true');
  if (!(await NetInfo.fetch()).isConnected) return { error: null, reflect: true };
  const { data, error } = await supabase.from('profiles').update({ display_name: profile.displayName, username: profile.username, photo_url: profile.photoUrl }).eq('id', userId).select('id').maybeSingle();
  if (error) return { error: error.message, reflect: false };
  if (!data) return { error: 'Your profile row was not found. Run the latest Supabase profile setup and try again.', reflect: false };
  const { error: metadataError } = await supabase.auth.updateUser({ data: { full_name: profile.displayName, username: profile.username, avatar_url: profile.photoUrl } });
  if (metadataError) return { error: metadataError.message, reflect: true };
  if (!(await writeCloudSettings({ profile }))) return { error: null, reflect: true };
  await AsyncStorage.setItem(`${key}.pending`, 'false');
  return { error: null, reflect: true };
}

export async function uploadMiloProfilePhoto(file: Blob): Promise<string> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user || user.is_anonymous) throw new Error('Sign in to upload a profile photo.');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 3 * 1024 * 1024) throw new Error('Choose a JPG, PNG, or WebP image under 3 MB.');
  const extension = file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1];
  const path = `${user.id}/avatar.${extension}`;
  const { error } = await supabase.storage.from('milo-profile-photos').upload(path, file, { contentType: file.type, cacheControl: '3600', upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from('milo-profile-photos').getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}

async function readSettings(): Promise<{ policy?: Partial<typeof DEFAULT_POLICY>; preferences?: Partial<MiloPreferences>; pendingSync?: boolean }> {
  try {
    const [policy, preferences] = await Promise.all([
      AsyncStorage.getItem(POLICY_KEY), AsyncStorage.getItem(PREFERENCES_KEY),
    ]);
    const pending = await AsyncStorage.getItem(`${PREFERENCES_KEY}.pending-sync`);
    return { policy: policy ? JSON.parse(policy) : undefined, preferences: preferences ? JSON.parse(preferences) : undefined, pendingSync: pending === 'true' };
  } catch { return {}; }
}

async function writeLocalSettings(settings: { policy?: object; preferences?: object; pendingSync?: boolean }) {
  if (settings.policy) await AsyncStorage.setItem(POLICY_KEY, JSON.stringify(settings.policy));
  if (settings.preferences) await AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify(settings.preferences));
  if (settings.pendingSync !== undefined) await AsyncStorage.setItem(`${PREFERENCES_KEY}.pending-sync`, String(settings.pendingSync));
}

async function accountId() {
  try {
    const { data } = await supabase?.auth.getUser() ?? { data: { user: null } };
    return data.user && !data.user.is_anonymous ? data.user.id : null;
  } catch { return null; }
}

async function readCloudSettings(): Promise<{ policy?: Partial<typeof DEFAULT_POLICY>; preferences?: Partial<MiloPreferences>; profile?: MiloProfile } | null> {
  const userId = await accountId();
  if (!userId || !supabase || !(await NetInfo.fetch()).isConnected) return null;
  const { data, error } = await supabase.from('milo_user_settings').select('settings').eq('user_id', userId).maybeSingle();
  return error ? null : (data?.settings as { policy?: Partial<typeof DEFAULT_POLICY>; preferences?: Partial<MiloPreferences>; profile?: MiloProfile } | null);
}

async function writeCloudSettings(settings: { policy?: object; preferences?: object; profile?: MiloProfile; pendingSync?: boolean }) {
  const userId = await accountId();
  if (!userId || !supabase || !(await NetInfo.fetch()).isConnected) return false;
  const current = await readCloudSettings();
  const { error } = await supabase.from('milo_user_settings').upsert({ user_id: userId, settings: { ...current, ...(settings.policy ? { policy: settings.policy } : {}), ...(settings.preferences ? { preferences: settings.preferences } : {}), ...(settings.profile ? { profile: settings.profile } : {}) }, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  return !error;
}
export async function getToday() {
  const days = await loadDays();
  return days.find(d => d.date === localDateKey()) ?? {
    date: localDateKey(), punchInAt: null, punchOutAt: null,
    breakMinutes: DEFAULT_POLICY.defaultBreakMinutes, managerApproval: false, synced: true,
  } satisfies AttendanceDay;
}
