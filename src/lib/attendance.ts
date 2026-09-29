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

export type AttendanceDay = {
  id?: string;
  user_id?: string;
  date: string;
  punchInAt: string | null;
  punchOutAt: string | null;
  breakMinutes: number;
  managerApproval: boolean;
  approvalStatus?: 'pending' | 'approved' | 'rejected' | 'not_required';
  synced?: boolean;
};

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
  const start = day.punchInAt ? new Date(day.punchInAt) : null;
  const end = day.punchOutAt ? new Date(day.punchOutAt) : start ? now : null;
  const elapsedMinutes = start && end ? Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60000)) : 0;
  const deducted = !start || policy.breakDeductionMode === 'none' ? 0 : policy.breakDeductionMode === 'actual' ? day.breakMinutes : policy.defaultBreakMinutes;
  const netWorkedMinutes = Math.max(0, elapsedMinutes - deducted);
  const remainingMinutes = Math.max(0, policy.recordedWorkTargetMinutes - netWorkedMinutes);
  const progressPercent = Math.min(100, Math.round(netWorkedMinutes / policy.recordedWorkTargetMinutes * 100));
  const loginMinute = start ? start.getHours() * 60 + start.getMinutes() : 0;
  const lateMinutes = start ? Math.max(0, loginMinute - mins(policy.standardStart)) : 0;
  const afterFlexLimit = !!start && loginMinute > mins(policy.flexibleLimit);
  const loginStatus = !start ? 'Not punched in' : afterFlexLimit ? 'After flexible limit — review' : lateMinutes ? `Late by ${lateMinutes} min` : 'On time';
  return {
    elapsedMinutes, deductedBreakMinutes: deducted, netWorkedMinutes, remainingMinutes, progressPercent,
    targetReached: netWorkedMinutes >= policy.recordedWorkTargetMinutes,
    targetStatus: netWorkedMinutes >= policy.recordedWorkTargetMinutes ? `${formatDuration(policy.recordedWorkTargetMinutes)} target reached` : `${formatDuration(remainingMinutes)} remaining`,
    loginStatus, lateMinutes, afterFlexLimit,
  };
}

export function monthLateCount(days: AttendanceDay[], month = localDateKey().slice(0, 7), policy = DEFAULT_POLICY) {
  return days.filter(day => day.date.startsWith(month) && day.punchInAt && getAttendanceSummary(day, new Date(day.punchInAt), policy).lateMinutes > 0).length;
}
