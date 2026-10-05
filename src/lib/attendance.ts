export type PolicyConfig = {
  standardStart: string;
  flexibleLimit: string;
  recordedWorkTargetMinutes: number;
  defaultBreakMinutes: number;
  lateAllowancePerMonth: number;
  breakDeductionMode: 'fixed' | 'actual' | 'none';
  halfDayRule: 'disabled' | 'after_flex';
};

export const DEFAULT_POLICY: PolicyConfig = {
  standardStart: '09:00', flexibleLimit: '10:00',
  recordedWorkTargetMinutes: 480, defaultBreakMinutes: 60,
  lateAllowancePerMonth: 4, breakDeductionMode: 'fixed', halfDayRule: 'disabled',
};
export const MONTHLY_LATE_LOGIN_LIMIT = 4;

export type AttendanceSession = { punchInAt: string; punchOutAt: string | null };

export type AttendanceDay = {
  id?: string;
  user_id?: string;
  date: string;
  punchInAt: string | null;
  punchOutAt: string | null;
  officeOutAt?: string | null;
  /** Individual work intervals. Optional to migrate existing single-session records. */
  sessions?: AttendanceSession[];
  breakMinutes: number;
  managerApproval: boolean;
  approvalStatus?: 'pending' | 'approved' | 'rejected' | 'not_required';
  synced?: boolean;
};

export function getDaySessions(day: AttendanceDay): AttendanceSession[] {
  if (day.sessions?.length) return day.sessions;
  return day.punchInAt ? [{ punchInAt: day.punchInAt, punchOutAt: day.punchOutAt }] : [];
}

const mins = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};
export function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function formatDuration(totalMinutes: number) {
  const n = Math.max(0, Math.floor(totalMinutes));
  return `${Math.floor(n / 60)}h ${String(n % 60).padStart(2, '0')}m`;
}
export function getAttendanceSummary(day: AttendanceDay, now = new Date(), policy = DEFAULT_POLICY) {
  const sessions = getDaySessions(day).slice().sort((a, b) => a.punchInAt.localeCompare(b.punchInAt));
  const start = sessions[0] ? new Date(sessions[0].punchInAt) : null;
  let elapsedSeconds = 0;
  let takenBreakSeconds = 0;
  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i];
    const sessionStart = new Date(session.punchInAt);
    const sessionEnd = session.punchOutAt ? new Date(session.punchOutAt) : now;
    elapsedSeconds += Math.max(0, Math.floor((sessionEnd.getTime() - sessionStart.getTime()) / 1000));
    const next = sessions[i + 1];
    if (session.punchOutAt && next) takenBreakSeconds += Math.max(0, Math.floor((new Date(next.punchInAt).getTime() - new Date(session.punchOutAt).getTime()) / 1000));
  }
  const lastSession = sessions[sessions.length - 1];
  const breakIsOpen = !!lastSession?.punchOutAt && !sessions.some(session => !session.punchOutAt);
  if (breakIsOpen) {
    const breakEnd = day.officeOutAt ? new Date(day.officeOutAt).getTime() : day.date === localDateKey(now) ? now.getTime() : new Date(lastSession!.punchOutAt!).getTime();
    takenBreakSeconds += Math.max(0, Math.floor((breakEnd - new Date(lastSession!.punchOutAt!).getTime()) / 1000));
  }
  // Punch intervals are the recorded work; time between sessions is tracked
  // separately as break time and must not be deducted a second time.
  const deducted = 0;
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  const netWorkedSeconds = elapsedSeconds;
  const netWorkedMinutes = Math.floor(netWorkedSeconds / 60);
  const takenBreakMinutes = Math.floor(takenBreakSeconds / 60);
  const remainingMinutes = Math.max(0, policy.recordedWorkTargetMinutes - netWorkedMinutes);
  const progressPercent = Math.min(100, Math.round(netWorkedMinutes / policy.recordedWorkTargetMinutes * 100));
  const loginMinute = start ? start.getHours() * 60 + start.getMinutes() : 0;
  const lateMinutes = start ? Math.max(0, loginMinute - mins(policy.standardStart)) : 0;
  const afterFlexLimit = !!start && loginMinute > mins(policy.flexibleLimit);
  const loginStatus = !start ? 'Not punched in' : afterFlexLimit ? 'After flexible limit — review' : lateMinutes ? `Late by ${lateMinutes} min` : 'On time';
  return {
    elapsedMinutes, deductedBreakMinutes: deducted, takenBreakSeconds, takenBreakMinutes,
    netWorkedSeconds, netWorkedMinutes, remainingMinutes, progressPercent,
    targetReached: netWorkedMinutes >= policy.recordedWorkTargetMinutes,
    targetStatus: netWorkedMinutes >= policy.recordedWorkTargetMinutes ? `${formatDuration(policy.recordedWorkTargetMinutes)} target reached` : `${formatDuration(remainingMinutes)} remaining`,
    loginStatus, lateMinutes, afterFlexLimit,
  };
}

export function monthLateCount(days: AttendanceDay[], month = localDateKey().slice(0, 7), policy = DEFAULT_POLICY) {
  return days.filter(day => day.date.startsWith(month) && day.punchInAt && getAttendanceSummary(day, new Date(day.punchInAt), policy).afterFlexLimit).length;
}

export function isHalfDayDate(days: AttendanceDay[], date: string, policy = DEFAULT_POLICY) {
  const lateDates = [...new Set(days.filter(day => day.date.startsWith(date.slice(0, 7)) && day.punchInAt
    && getAttendanceSummary(day, new Date(day.punchInAt), policy).afterFlexLimit).map(day => day.date))].sort();
  return lateDates.indexOf(date) >= MONTHLY_LATE_LOGIN_LIMIT - 1;
}
