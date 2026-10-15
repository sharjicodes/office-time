const fields = {
  lines: document.querySelector('#lines'),
  interval: document.querySelector('#interval'),
  speak: document.querySelector('#speak'),
  enabled: document.querySelector('#enabled'),
  login: document.querySelector('#login'),
};
const status = document.querySelector('#status');
const reminderRows = document.querySelector('#reminderRows');
const reminderStatus = document.querySelector('#reminderStatus');
const workReminderRows = document.querySelector('#workReminderRows');
const accountForm = document.querySelector('#accountForm');
const accountConnected = document.querySelector('#accountConnected');
const accountStatus = document.querySelector('#accountStatus');
const accountSummary = document.querySelector('#accountSummary');
const syncBadge = document.querySelector('#syncBadge');

function makeWorkReminderRow(reminder = {}) {
  const totalMinutes = Math.max(1, Number(reminder.afterWorkMinutes) || 60);
  const row = document.createElement('div');
  row.className = 'reminder-row';
  row.dataset.id = reminder.id || `work-reminder-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
  const title = document.createElement('div');
  title.className = 'reminder-row-top';
  const label = document.createElement('span');
  label.textContent = 'At net worked time';
  const remove = document.createElement('button');
  remove.className = 'remove-reminder'; remove.type = 'button'; remove.textContent = 'Remove';
  remove.addEventListener('click', () => row.remove());
  title.append(label, remove);
  const time = document.createElement('div'); time.className = 'reminder-time';
  const hours = document.createElement('input');
  hours.type = 'number'; hours.min = '0'; hours.max = '24'; hours.value = Math.floor(totalMinutes / 60); hours.setAttribute('aria-label', 'Worked hours milestone');
  const hourLabel = document.createElement('span'); hourLabel.textContent = 'hours';
  const minutes = document.createElement('input');
  minutes.type = 'number'; minutes.min = '0'; minutes.max = '59'; minutes.value = totalMinutes % 60; minutes.setAttribute('aria-label', 'Worked minutes milestone');
  const minuteLabel = document.createElement('span'); minuteLabel.textContent = 'minutes';
  time.append(hours, hourLabel, minutes, minuteLabel);
  const message = document.createElement('textarea');
  message.className = 'reminder-message'; message.maxLength = 500;
  message.placeholder = 'What should Milo say at this work milestone?'; message.value = reminder.message || '';
  message.setAttribute('aria-label', 'Work milestone animation message');
  row.append(title, time, message);
  return row;
}

function makeReminderRow(reminder = {}) {
  const totalMinutes = Math.max(1, Number(reminder.afterMinutes) || 60);
  const row = document.createElement('div');
  row.className = 'reminder-row';
  row.dataset.id = reminder.id || `reminder-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
  const title = document.createElement('div');
  title.className = 'reminder-row-top';
  const label = document.createElement('span');
  label.textContent = 'Show after';
  const remove = document.createElement('button');
  remove.className = 'remove-reminder';
  remove.type = 'button';
  remove.textContent = 'Remove';
  remove.addEventListener('click', () => row.remove());
  title.append(label, remove);

  const time = document.createElement('div');
  time.className = 'reminder-time';
  const hours = document.createElement('input');
  hours.className = 'reminder-hours';
  hours.type = 'number'; hours.min = '0'; hours.max = '168'; hours.value = Math.floor(totalMinutes / 60); hours.setAttribute('aria-label', 'Reminder hours');
  const hourLabel = document.createElement('span'); hourLabel.textContent = 'hours';
  const minutes = document.createElement('input');
  minutes.className = 'reminder-minutes';
  minutes.type = 'number'; minutes.min = '0'; minutes.max = '59'; minutes.value = totalMinutes % 60; minutes.setAttribute('aria-label', 'Reminder minutes');
  const minuteLabel = document.createElement('span'); minuteLabel.textContent = 'minutes';
  time.append(hours, hourLabel, minutes, minuteLabel);

  const message = document.createElement('textarea');
  message.className = 'reminder-message';
  message.maxLength = 500;
  message.placeholder = 'Type the Malayalam message Milo should say';
  message.value = reminder.message || '';
  message.setAttribute('aria-label', 'Reminder message');
  row.append(title, time, message);
  return row;
}

function render(settings) {
  fields.lines.value = settings.dialogues.join('\n');
  fields.interval.value = settings.intervalMinutes;
  fields.speak.checked = settings.speak;
  fields.enabled.checked = settings.enabled;
  fields.login.checked = settings.launchAtLogin;
  reminderRows.replaceChildren(...(settings.reminders || []).map(makeReminderRow));
  workReminderRows.replaceChildren(...(settings.attendanceReminders || []).map(makeWorkReminderRow));
}

function read() {
  const intervalMinutes = Math.max(0, Math.min(180, Number.parseInt(fields.interval.value, 10) || 0));
  fields.interval.value = intervalMinutes;
  return {
    dialogues: fields.lines.value.split(/\r?\n/).map(line => line.trim()).filter(Boolean),
    reminders: [...reminderRows.querySelectorAll('.reminder-row')].map(row => {
      const hours = Math.max(0, Math.min(168, Number.parseInt(row.querySelector('.reminder-hours').value, 10) || 0));
      const minutes = Math.max(0, Math.min(59, Number.parseInt(row.querySelector('.reminder-minutes').value, 10) || 0));
      return {
        id: row.dataset.id,
        afterMinutes: Math.max(1, hours * 60 + minutes),
        message: row.querySelector('.reminder-message').value.trim(),
      };
    }).filter(reminder => reminder.message),
    attendanceReminders: [...workReminderRows.querySelectorAll('.reminder-row')].map(row => {
      const hours = Math.max(0, Math.min(24, Number.parseInt(row.querySelector('input[aria-label="Worked hours milestone"]').value, 10) || 0));
      const minutes = Math.max(0, Math.min(59, Number.parseInt(row.querySelector('input[aria-label="Worked minutes milestone"]').value, 10) || 0));
      return { id: row.dataset.id, afterWorkMinutes: Math.max(1, hours * 60 + minutes), message: row.querySelector('.reminder-message').value.trim() };
    }).filter(reminder => reminder.message),
    intervalMinutes,
    speak: fields.speak.checked,
    enabled: fields.enabled.checked,
    launchAtLogin: fields.login.checked,
  };
}

window.miloCompanion.onSettings(render);
window.miloCompanion.getSettings().then(render);
window.miloCompanion.getReminderStatus().then(updateReminderStatus);
window.miloCompanion.getCloudStatus().then(renderAttendance);
window.miloCompanion.onReminderStatus(updateReminderStatus);
window.miloCompanion.onAttendance(renderAttendance);
window.miloCompanion.onAttendanceError(message => { accountStatus.textContent = message; accountStatus.style.color = '#b42318'; });
window.miloCompanion.onSaved(() => {
  status.textContent = 'Settings saved.';
  setTimeout(() => { status.textContent = ''; }, 2500);
});

document.querySelector('#save').addEventListener('click', async () => {
  if (!fields.lines.value.trim()) {
    status.textContent = 'Add at least one dialogue line first.';
    status.style.color = '#b42318';
    return;
  }
  status.style.color = '';
  await window.miloCompanion.saveSettings(read());
});
document.querySelector('#preview').addEventListener('click', async () => {
  const dialogues = fields.lines.value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!dialogues.length) {
    status.textContent = 'Add a dialogue to preview it.';
    return;
  }
  await window.miloCompanion.saveSettings({ ...read(), enabled: true });
  window.miloCompanion.play();
  fields.enabled.checked = true;
  status.textContent = 'Milo is appearing on your desktop.';
});

function updateReminderStatus(state) {
  if (!state.startedAt) {
    reminderStatus.textContent = 'Reminder countdown is stopped.';
    return;
  }
  const done = Math.min(state.deliveredCount, state.enabledCount);
  reminderStatus.textContent = `Countdown running · ${done} of ${state.enabledCount} reminder${state.enabledCount === 1 ? '' : 's'} delivered`;
}

document.querySelector('#addReminder').addEventListener('click', () => {
  reminderRows.append(makeReminderRow({ afterMinutes: 60, message: '' }));
  reminderRows.lastElementChild.querySelector('.reminder-message').focus();
});
document.querySelector('#startReminders').addEventListener('click', async () => {
  const current = read();
  if (!current.reminders.length) {
    reminderStatus.textContent = 'Add a reminder with a message first.';
    return;
  }
  await window.miloCompanion.saveSettings({ ...current, enabled: true });
  fields.enabled.checked = true;
  await window.miloCompanion.startReminders();
  reminderStatus.textContent = 'Countdown started from now.';
});
document.querySelector('#stopReminders').addEventListener('click', async () => {
  await window.miloCompanion.stopReminders();
  reminderStatus.textContent = 'Reminder countdown stopped.';
});

function formatDuration(seconds) {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

function formatClock(value) {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function renderAttendance(state = {}) {
  const connected = Boolean(state.connected);
  accountForm.hidden = connected;
  accountConnected.hidden = !connected;
  syncBadge.textContent = connected ? 'Connected' : 'Not connected';
  syncBadge.classList.toggle('connected', connected);
  if (!connected) {
    accountStatus.textContent = 'Sign in to share attendance with this desktop.';
    accountStatus.style.color = '';
    accountSummary.textContent = '';
    return;
  }
  if (state.error) {
    accountStatus.textContent = state.error;
    accountStatus.style.color = '#b42318';
    return;
  }
  accountStatus.textContent = 'Attendance syncs automatically while Milo is running.';
  accountStatus.style.color = '';
  const day = state.day;
  accountSummary.textContent = `${state.email || ''}\n${day?.punch_in_at ? `Punch in ${formatClock(day.punch_in_at)}` : 'No punch-in recorded today'} · ${formatDuration(state.netSeconds || 0)} worked\n${day?.punch_out_at ? `Last punch out ${formatClock(day.punch_out_at)}` : day?.punch_in_at ? 'Work session is running' : 'Punch times sync from the web app'}\nTarget ${formatDuration((state.targetMinutes || 480) * 60)}`;
}

accountForm.addEventListener('submit', async event => {
  event.preventDefault();
  const button = document.querySelector('#signIn');
  button.disabled = true; button.textContent = 'Connecting…';
  accountStatus.textContent = 'Signing in securely…'; accountStatus.style.color = '';
  try {
    const state = await window.miloCompanion.signIn({ email: document.querySelector('#accountEmail').value, password: document.querySelector('#accountPassword').value });
    document.querySelector('#accountPassword').value = '';
    renderAttendance(state);
  } catch (error) {
    accountStatus.textContent = error.message || 'Could not connect this account.';
    accountStatus.style.color = '#b42318';
  } finally { button.disabled = false; button.textContent = 'Connect Milo account'; }
});

document.querySelector('#signOut').addEventListener('click', async () => {
  await window.miloCompanion.signOut();
  renderAttendance({ connected: false });
});
document.querySelector('#syncNow').addEventListener('click', async () => {
  accountStatus.textContent = 'Syncing attendance…';
  try { renderAttendance(await window.miloCompanion.syncAttendance()); }
  catch (error) { accountStatus.textContent = error.message; accountStatus.style.color = '#b42318'; }
});
document.querySelector('#addWorkReminder').addEventListener('click', () => {
  workReminderRows.append(makeWorkReminderRow({ afterWorkMinutes: 60, message: '' }));
  workReminderRows.lastElementChild.querySelector('.reminder-message').focus();
});
