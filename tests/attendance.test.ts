import test from 'node:test';
import assert from 'node:assert/strict';
import { AttendanceDay, DEFAULT_POLICY, getAttendanceSummary, formatDuration, monthLateCount } from '../src/lib/attendance';

function day(login: string, logout: string | null = null): AttendanceDay {
  return { date: '2026-09-29', punchInAt: `2026-09-29T${login}:00+05:30`, punchOutAt: logout ? `2026-09-29T${logout}:00+05:30` : null, breakMinutes: 60, managerApproval: false };
}

test('9 AM and earlier are on time; 9:01 is late by one minute', () => {
  assert.equal(getAttendanceSummary(day('08:59')).loginStatus, 'On time');
  assert.equal(getAttendanceSummary(day('09:00')).loginStatus, 'On time');
  assert.equal(getAttendanceSummary(day('09:01')).lateMinutes, 1);
});

test('10 AM is within flex limit while 10:01 is flagged for review', () => {
  assert.equal(getAttendanceSummary(day('10:00')).afterFlexLimit, false);
  assert.equal(getAttendanceSummary(day('10:01')).afterFlexLimit, true);
});

test('9 hours elapsed minus 60 minutes records 8 hours', () => {
  const summary = getAttendanceSummary(day('09:00', '18:00'), new Date('2026-09-29T18:00:00+05:30'));
  assert.equal(summary.elapsedMinutes, 540);
  assert.equal(summary.netWorkedMinutes, 480);
  assert.equal(summary.targetReached, true);
});

test('no punch-out shows elapsed time through now and never a negative total', () => {
  const summary = getAttendanceSummary(day('09:00'), new Date('2026-09-29T12:00:00+05:30'));
  assert.equal(summary.netWorkedMinutes, 120);
  assert.equal(summary.remainingMinutes, 360);
});

test('break handling can be configured to actual minutes or no deduction', () => {
  const actual = { ...DEFAULT_POLICY, breakDeductionMode: 'actual' as const };
  const none = { ...DEFAULT_POLICY, breakDeductionMode: 'none' as const };
  const record = day('09:00', '18:00');
  assert.equal(getAttendanceSummary(record, new Date('2026-09-29T18:00:00+05:30'), actual).netWorkedMinutes, 480);
  assert.equal(getAttendanceSummary(record, new Date('2026-09-29T18:00:00+05:30'), none).netWorkedMinutes, 540);
});

test('month late count is informational and uses local calendar dates', () => {
  assert.equal(monthLateCount([day('09:30'), day('09:00'), { ...day('09:10'), date: '2026-08-31' }], '2026-09'), 1);
});

test('duration formatting clamps negative minutes', () => assert.equal(formatDuration(-1), '0h 00m'));
